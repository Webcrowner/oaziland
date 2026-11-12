"""Course cover images: uploaded by admins and the course's lecturers, shown on the public catalogue."""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from careers.models import CourseStaff, CourseStaffRole, TrainingCategory, TrainingProgram
from identity.models import User


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _png(name="cover.png", color=(200, 120, 40)):
    buffer = io.BytesIO()
    Image.new("RGB", (64, 36), color).save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


@pytest.fixture(autouse=True)
def media_in_tmp(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def course(db):
    admin = User.objects.create(username="cover_admin", phone="+237699920001", is_staff=True)
    program = TrainingProgram.objects.create(provider=admin, title="Front Desk", category=TrainingCategory.HOSPITALITY_OPERATIONS)
    lecturer = User.objects.create(username="cover_lecturer", phone="+237699920002")
    supervisor = User.objects.create(username="cover_supervisor", phone="+237699920003")
    CourseStaff.objects.create(program=program, user=lecturer, role=CourseStaffRole.LECTURER)
    CourseStaff.objects.create(program=program, user=supervisor, role=CourseStaffRole.SUPERVISOR)
    return program, admin, lecturer, supervisor


def _upload(user, program, file):
    return _client(user).patch(f"/api/manage/courses/{program.id}/", {"cover_image": file}, format="multipart")


@pytest.mark.django_db
def test_a_lecturer_uploads_a_cover_that_shows_on_the_public_catalogue(course):
    program, _, lecturer, _ = course

    response = _upload(lecturer, program, _png())
    assert response.status_code == 200, response.data
    assert "/media/course_covers/" in response.data["cover_image_url"]

    public = APIClient().get("/api/trainings/").data["results"][0]
    assert public["cover_image_url"] == response.data["cover_image_url"]
    assert public["cover_image_url"].startswith("http")


@pytest.mark.django_db
def test_admins_can_set_covers_but_supervisors_and_outsiders_cannot(course):
    program, admin, _, supervisor = course
    outsider = User.objects.create(username="cover_outsider", phone="+237699920004")

    assert _upload(admin, program, _png()).status_code == 200
    assert _upload(supervisor, program, _png()).status_code == 403
    assert _upload(outsider, program, _png()).status_code == 404


@pytest.mark.django_db
def test_only_real_images_are_accepted(course):
    program, admin, _, _ = course
    fake = SimpleUploadedFile("cover.png", b"not really an image", content_type="image/png")
    gif = SimpleUploadedFile("cover.gif", b"GIF89a" + b"\x00" * 20, content_type="image/gif")

    assert _upload(admin, program, fake).status_code == 400
    assert _upload(admin, program, gif).status_code == 400
    program.refresh_from_db()
    assert not program.cover_image


@pytest.mark.django_db
def test_replacing_or_removing_a_cover_deletes_the_old_file(course):
    program, admin, _, _ = course
    _upload(admin, program, _png("first.png"))
    program.refresh_from_db()
    first = program.cover_image.name
    storage = program.cover_image.storage

    _upload(admin, program, _png("second.png", color=(10, 10, 10)))
    program.refresh_from_db()
    second = program.cover_image.name
    assert second != first and not storage.exists(first) and storage.exists(second)

    removed = _client(admin).patch(f"/api/manage/courses/{program.id}/", {"remove_cover_image": True}, format="json")
    assert removed.status_code == 200 and removed.data["cover_image_url"] == ""
    assert not storage.exists(second)
