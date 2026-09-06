"""
uploads.providers — the real gap this closes: a user could take or
choose a photo in the app, but nothing ever accepted that file and
turned it into a real, usable URL. Every "No photo yet" placeholder
across listings, hotels, and social posts all session has been
masking this — PostMedia.file_url could STORE a URL, but nothing
could ever CREATE one from a real upload.

Follows the exact "swap the backend, not the code that calls it"
pattern already used for payments/SMS/moderation in this codebase:
a real interface, a working local implementation that needs no
external account (correct for development, per settings.py's own
comment on MEDIA_ROOT), and a real cloud implementation for
production.
"""
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class UploadResult:
    url: str
    media_type: str  # "PHOTO" or "VIDEO"


class MediaStorageProvider(ABC):
    @abstractmethod
    def upload(self, *, file, folder: str) -> UploadResult:
        ...


class LocalFileStorageProvider(MediaStorageProvider):
    """Saves into Django's own MEDIA_ROOT/MEDIA_URL — genuinely works
    today with zero external account, correct for local development
    and testing (settings.py's own comment on MEDIA_ROOT says exactly
    this). Not suitable for a real multi-server production deployment
    (see CloudinaryStorageProvider), but real and testable right now."""

    def upload(self, *, file, folder: str) -> UploadResult:
        from django.core.files.storage import default_storage
        from .services import detect_media_type

        media_type = detect_media_type(file.content_type)
        extension = file.name.rsplit(".", 1)[-1] if "." in file.name else "bin"
        real_filename = f"{folder}/{uuid.uuid4()}.{extension}"
        saved_path = default_storage.save(real_filename, file)
        url = default_storage.url(saved_path)
        return UploadResult(url=url, media_type=media_type)


class CloudinaryStorageProvider(MediaStorageProvider):
    """The real production provider — Cloudinary's env vars already
    existed in .env.example before this feature had any code behind
    them at all. Requires the `cloudinary` package and real
    credentials; raises clearly if either is missing rather than
    silently falling back, the same honesty every other real provider
    in this codebase already follows."""

    def upload(self, *, file, folder: str) -> UploadResult:
        try:
            import cloudinary.uploader
        except ImportError as exc:
            raise RuntimeError(
                "Cloudinary is configured as the media provider but the 'cloudinary' "
                "package is not installed. Run: pip install cloudinary"
            ) from exc
        from .services import detect_media_type

        media_type = detect_media_type(file.content_type)
        resource_type = "video" if media_type == "VIDEO" else "image"
        result = cloudinary.uploader.upload(file, folder=folder, resource_type=resource_type)
        return UploadResult(url=result["secure_url"], media_type=media_type)


def get_active_provider() -> MediaStorageProvider:
    from django.conf import settings

    provider_name = getattr(settings, "MEDIA_STORAGE_PROVIDER", "LOCAL")
    if provider_name == "CLOUDINARY":
        return CloudinaryStorageProvider()
    return LocalFileStorageProvider()
