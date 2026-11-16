"""
uploads.services — real validation before a file ever reaches a
storage provider. A generous but real size limit, and a real,
explicit allow-list of content types — never trusting a file
extension alone, since that's trivial to fake.
"""
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/quicktime"}
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024  # 500 MB, for every video upload
# Tighter caps for particular upload folders (none at present: every video folder allows 500 MB).
FOLDER_VIDEO_LIMITS: dict[str, int] = {}
# Folders that accept only one kind of file.
FOLDER_MEDIA_TYPES = {"agent-intro": "VIDEO", "luggage": "PHOTO"}
# The first box of an MP4/MOV file (bytes 4-8); QuickTime files may start with any of these.
_VIDEO_ATOMS = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot"}


class UnsupportedMediaTypeError(Exception):
    pass


class MediaTooLargeError(Exception):
    pass


def detect_media_type(content_type: str) -> str:
    if content_type in ALLOWED_IMAGE_TYPES:
        return "PHOTO"
    if content_type in ALLOWED_VIDEO_TYPES:
        return "VIDEO"
    raise UnsupportedMediaTypeError(
        f"'{content_type}' is not a supported file type. "
        f"Allowed: {', '.join(sorted(ALLOWED_IMAGE_TYPES | ALLOWED_VIDEO_TYPES))}"
    )


def validate_upload_size(*, content_type: str, size_bytes: int, folder: str = ""):
    media_type = detect_media_type(content_type)
    expected = FOLDER_MEDIA_TYPES.get(folder)
    if expected and media_type != expected:
        raise UnsupportedMediaTypeError("Upload a video here." if expected == "VIDEO" else "Upload a photo here.")
    limit = MAX_IMAGE_SIZE_BYTES if media_type == "PHOTO" else FOLDER_VIDEO_LIMITS.get(folder, MAX_VIDEO_SIZE_BYTES)
    if size_bytes > limit:
        raise MediaTooLargeError(f"File is {size_bytes // 1024 // 1024}MB — the limit is {limit // 1024 // 1024}MB.")


def is_platform_media_url(url: str) -> bool:
    """True when url points at a file stored through upload_media_file (this server's /media/ or the Cloudinary
    account), so people can't attach pictures hosted elsewhere."""
    from urllib.parse import urlparse

    from django.conf import settings

    parsed = urlparse(url or "")
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return False
    backend = urlparse(settings.BACKEND_BASE_URL)
    media_prefix = "/" + settings.MEDIA_URL.strip("/") + "/"
    if parsed.netloc == backend.netloc and parsed.path.startswith(media_prefix):
        return True
    cloud = getattr(settings, "CLOUDINARY_CLOUD_NAME", "") or ""
    return bool(cloud) and parsed.netloc == "res.cloudinary.com" and parsed.path.startswith(f"/{cloud}/")


def inspect_and_clean(file):
    """Checks that the bytes really are what the client says (the content type is only a claim) and returns the
    file to store. Photos are decoded and re-saved, which drops hidden metadata such as the GPS position a phone
    camera embeds; videos must start like an MP4/MOV container. Raises UnsupportedMediaTypeError otherwise."""
    media_type = detect_media_type(file.content_type)
    if media_type == "VIDEO":
        file.seek(0)
        head = file.read(12)
        file.seek(0)
        if len(head) < 12 or head[4:8] not in _VIDEO_ATOMS:
            raise UnsupportedMediaTypeError("That file is not a valid MP4 or MOV video.")
        return file

    import io

    from django.core.files.uploadedfile import InMemoryUploadedFile
    from PIL import Image, ImageOps, UnidentifiedImageError

    formats = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
    file.seek(0)
    try:
        image = Image.open(file)
        if image.format != formats[file.content_type]:
            raise UnsupportedMediaTypeError("That file is not a valid image of the type it claims to be.")
        image = ImageOps.exif_transpose(image)
        image.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError):
        raise UnsupportedMediaTypeError("That file is not a valid image.")
    out = io.BytesIO()
    params = {"quality": 90, "optimize": True} if image.format != "PNG" else {"optimize": True}
    save_format = formats[file.content_type]
    if save_format == "JPEG" and image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.save(out, format=save_format, **params)
    out.seek(0)
    return InMemoryUploadedFile(out, "file", file.name, file.content_type, out.getbuffer().nbytes, None)


def upload_media_file(*, file, folder: str):
    """The one real entry point every caller (post creation, listing
    photos, etc.) should use — validates BEFORE handing the file to
    whichever storage provider is currently active, so validation
    rules apply identically regardless of which provider is configured."""
    from .providers import get_active_provider

    validate_upload_size(content_type=file.content_type, size_bytes=file.size, folder=folder)
    file = inspect_and_clean(file)
    provider = get_active_provider()
    return provider.upload(file=file, folder=folder)
