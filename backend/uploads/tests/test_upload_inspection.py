"""Uploads are checked by their bytes, not just the type the client claims, and photos lose hidden metadata."""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from uploads.services import UnsupportedMediaTypeError, inspect_and_clean


def _jpeg_with_gps():
    image = Image.new("RGB", (40, 30), "red")
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (4.0, 3.0, 0.0)}  # a GPS block, as a phone camera would add
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def test_photo_metadata_is_removed():
    original = _jpeg_with_gps()
    assert len(Image.open(io.BytesIO(original)).getexif().get_ifd(0x8825)) > 0

    cleaned = inspect_and_clean(SimpleUploadedFile("a.jpg", original, content_type="image/jpeg"))

    result = Image.open(io.BytesIO(cleaned.read()))
    assert result.size == (40, 30)
    assert len(result.getexif().get_ifd(0x8825)) == 0


def test_a_fake_image_is_refused():
    with pytest.raises(UnsupportedMediaTypeError):
        inspect_and_clean(SimpleUploadedFile("a.jpg", b"<html><script>alert(1)</script></html>", content_type="image/jpeg"))


def test_an_image_of_the_wrong_type_is_refused():
    buffer = io.BytesIO()
    Image.new("RGB", (5, 5)).save(buffer, format="PNG")
    with pytest.raises(UnsupportedMediaTypeError):
        inspect_and_clean(SimpleUploadedFile("a.jpg", buffer.getvalue(), content_type="image/jpeg"))


def test_videos_must_look_like_mp4_or_mov():
    with pytest.raises(UnsupportedMediaTypeError):
        inspect_and_clean(SimpleUploadedFile("a.mp4", b"MZ\x90\x00 this is an executable", content_type="video/mp4"))
    real = SimpleUploadedFile("a.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32, content_type="video/mp4")
    assert inspect_and_clean(real).read(8) == b"\x00\x00\x00\x18ftyp"
