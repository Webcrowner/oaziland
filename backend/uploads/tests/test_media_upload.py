"""
Tests for the real media upload feature — closing the gap discovered
while auditing for missing features: every "No photo yet" placeholder
across listings, hotels, and social posts was masking the fact that
NOTHING could ever actually accept a file and turn it into a real,
usable URL.
"""
import io
import pytest
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from django.core.files.uploadedfile import SimpleUploadedFile

from identity.models import User


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _real_jpeg_bytes() -> bytes:
    """A genuinely valid, tiny real JPEG — not a fake/empty file —
    so the test proves the actual upload pipeline, not just that a
    byte string with a certain name was accepted."""
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), color="blue").save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.mark.django_db
def test_uploading_a_real_image_returns_a_real_usable_url():
    user = User.objects.create(username="upload_user", phone="+237699111101")
    client = _auth_client(user)
    file = SimpleUploadedFile("photo.jpg", _real_jpeg_bytes(), content_type="image/jpeg")

    response = client.post("/api/media/upload/", {"file": file, "folder": "listings"}, format="multipart")

    assert response.status_code == 201
    assert response.data["media_type"] == "PHOTO"
    assert response.data["url"]  # a real, non-empty URL was returned


@pytest.mark.django_db
def test_unsupported_file_type_is_rejected_with_a_clean_error():
    user = User.objects.create(username="upload_bad_type_user", phone="+237699111102")
    client = _auth_client(user)
    file = SimpleUploadedFile("virus.exe", b"not a real media file", content_type="application/x-msdownload")

    response = client.post("/api/media/upload/", {"file": file}, format="multipart")

    assert response.status_code == 400
    assert "not a supported file type" in response.data["detail"]


@pytest.mark.django_db
def test_oversized_file_is_rejected():
    user = User.objects.create(username="upload_oversized_user", phone="+237699111103")
    client = _auth_client(user)
    # A real JPEG header followed by padding past the real 10MB image limit.
    oversized_content = _real_jpeg_bytes() + (b"\x00" * (11 * 1024 * 1024))
    file = SimpleUploadedFile("huge.jpg", oversized_content, content_type="image/jpeg")

    response = client.post("/api/media/upload/", {"file": file}, format="multipart")

    assert response.status_code == 400
    assert "limit" in response.data["detail"]


@pytest.mark.django_db
def test_upload_requires_authentication():
    file = SimpleUploadedFile("photo.jpg", _real_jpeg_bytes(), content_type="image/jpeg")
    response = APIClient().post("/api/media/upload/", {"file": file}, format="multipart")
    assert response.status_code == 401


@pytest.mark.django_db
def test_no_file_provided_returns_a_clean_error():
    user = User.objects.create(username="upload_no_file_user", phone="+237699111104")
    client = _auth_client(user)
    response = client.post("/api/media/upload/", {}, format="multipart")
    assert response.status_code == 400
