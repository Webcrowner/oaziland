"""Lesson videos and PDFs are private: only signed, access-checked links serve them, and videos can seek (Range)."""
from urllib.parse import urlparse

import pytest
from django.conf import settings
from django.core.files.base import ContentFile
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from careers import course_media
from careers.models import CourseModule, Lesson, LessonKind, TrainingCategory, TrainingProgram
from careers.services import drop_training, enroll_in_training
from identity.models import User

VIDEO = b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * 4


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def lesson(db):
    provider = User.objects.create(username="media_provider", phone="+237699930001")
    program = TrainingProgram.objects.create(provider=provider, title="Video course", category=TrainingCategory.OTHER)
    module = CourseModule.objects.create(program=program, title="M")
    lesson = Lesson.objects.create(module=module, title="Watch", kind=LessonKind.VIDEO)
    lesson.video_file.save("intro.mp4", ContentFile(VIDEO))
    yield lesson
    lesson.video_file.delete(save=False)


def _learner_link(lesson, user):
    enrollment = enroll_in_training(program=lesson.module.program, student=user)
    outline = _client(user).get(f"/api/my-enrollments/{enrollment.id}/course/").data
    return enrollment, urlparse(outline["modules"][0]["lessons"][0]["video_file_url"]).path


@pytest.mark.django_db
def test_uploaded_lesson_files_are_not_in_public_media(lesson):
    assert not str(lesson.video_file.path).startswith(str(settings.MEDIA_ROOT))
    assert "private_media" in str(lesson.video_file.path)


@pytest.mark.django_db
def test_an_enrolled_learner_streams_the_video_and_can_seek(lesson):
    learner = User.objects.create(username="media_learner", phone="+237699930002")
    _, path = _learner_link(lesson, learner)

    full = APIClient().get(path)  # a <video> tag sends no login token: the signed link is enough
    assert full.status_code == 200 and b"".join(full.streaming_content) == VIDEO
    assert full["Accept-Ranges"] == "bytes" and full["Content-Type"] == "video/mp4"
    assert "X-Frame-Options" not in full and full["Content-Security-Policy"].startswith("frame-ancestors ")

    part = APIClient().get(path, HTTP_RANGE="bytes=10-19")
    assert part.status_code == 206 and b"".join(part.streaming_content) == VIDEO[10:20]
    assert part["Content-Range"] == f"bytes 10-19/{len(VIDEO)}"
    tail = APIClient().get(path, HTTP_RANGE="bytes=-5")
    assert b"".join(tail.streaming_content) == VIDEO[-5:]
    assert APIClient().get(path, HTTP_RANGE=f"bytes={len(VIDEO)}-").status_code == 416


@pytest.mark.django_db
def test_links_stop_working_when_access_ends_expires_or_is_tampered_with(lesson, monkeypatch):
    learner = User.objects.create(username="media_dropper", phone="+237699930003")
    enrollment, path = _learner_link(lesson, learner)
    first = APIClient().get(path)
    assert first.status_code == 200
    first.close()

    assert APIClient().get(path[:-3] + "xx/").status_code == 404
    monkeypatch.setattr(course_media, "MAX_AGE_SECONDS", -1)
    assert APIClient().get(path).status_code == 404
    monkeypatch.setattr(course_media, "MAX_AGE_SECONDS", 3600)

    drop_training(enrollment)
    assert APIClient().get(path).status_code == 404


@pytest.mark.django_db
def test_course_staff_get_working_links_in_the_editor(lesson):
    admin = User.objects.create(username="media_admin", phone="+237699930004", is_staff=True)
    data = _client(admin).get(f"/api/manage/courses/{lesson.module.program_id}/").data
    url = data["modules"][0]["lessons"][0]["video_file_url"]
    response = APIClient().get(urlparse(url).path)
    assert response.status_code == 200
    response.close()
