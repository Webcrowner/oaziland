"""
uploads.services — real validation before a file ever reaches a
storage provider. A generous but real size limit, and a real,
explicit allow-list of content types — never trusting a file
extension alone, since that's trivial to fake.
"""
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/quicktime"}
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024  # 500 MB


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


def validate_upload_size(*, content_type: str, size_bytes: int):
    media_type = detect_media_type(content_type)
    limit = MAX_IMAGE_SIZE_BYTES if media_type == "PHOTO" else MAX_VIDEO_SIZE_BYTES
    if size_bytes > limit:
        raise MediaTooLargeError(f"File is {size_bytes // 1024 // 1024}MB — the limit is {limit // 1024 // 1024}MB.")


def upload_media_file(*, file, folder: str):
    """The one real entry point every caller (post creation, listing
    photos, etc.) should use — validates BEFORE handing the file to
    whichever storage provider is currently active, so validation
    rules apply identically regardless of which provider is configured."""
    from .providers import get_active_provider

    validate_upload_size(content_type=file.content_type, size_bytes=file.size)
    provider = get_active_provider()
    return provider.upload(file=file, folder=folder)
