"""
Video size limit: videos may be up to 500 MB, anything bigger is refused, and
Cloudinary receives anything over its 100 MB single-request cap in chunks.
"""
import sys
import types
from unittest.mock import MagicMock

import pytest

from uploads.providers import CHUNK_SIZE_BYTES, CloudinaryStorageProvider
from uploads.services import MediaTooLargeError, validate_upload_size

MB = 1024 * 1024


def test_a_500mb_video_is_accepted():
    validate_upload_size(content_type="video/mp4", size_bytes=500 * MB)
    validate_upload_size(content_type="video/quicktime", size_bytes=250 * MB)


def test_a_video_over_500mb_is_refused_with_the_limit_in_the_message():
    with pytest.raises(MediaTooLargeError, match="500MB"):
        validate_upload_size(content_type="video/mp4", size_bytes=500 * MB + 1)


def test_the_image_limit_is_unchanged():
    validate_upload_size(content_type="image/jpeg", size_bytes=10 * MB)
    with pytest.raises(MediaTooLargeError):
        validate_upload_size(content_type="image/jpeg", size_bytes=10 * MB + 1)


@pytest.fixture
def fake_cloudinary(monkeypatch):
    uploader = types.SimpleNamespace(
        upload=MagicMock(return_value={"secure_url": "https://cdn.example.com/small.mp4"}),
        upload_large=MagicMock(return_value={"secure_url": "https://cdn.example.com/big.mp4"}),
    )
    package = types.ModuleType("cloudinary")
    package.uploader = uploader
    monkeypatch.setitem(sys.modules, "cloudinary", package)
    monkeypatch.setitem(sys.modules, "cloudinary.uploader", uploader)
    return uploader


def _video(size):
    return types.SimpleNamespace(content_type="video/mp4", size=size)


def test_cloudinary_gets_large_videos_in_chunks(fake_cloudinary):
    result = CloudinaryStorageProvider().upload(file=_video(300 * MB), folder="videos")

    assert result.url == "https://cdn.example.com/big.mp4"
    fake_cloudinary.upload.assert_not_called()
    assert fake_cloudinary.upload_large.call_args.kwargs["chunk_size"] == CHUNK_SIZE_BYTES


def test_cloudinary_keeps_the_normal_upload_for_videos_up_to_100mb(fake_cloudinary):
    result = CloudinaryStorageProvider().upload(file=_video(100 * MB), folder="videos")

    assert result.url == "https://cdn.example.com/small.mp4"
    fake_cloudinary.upload_large.assert_not_called()
