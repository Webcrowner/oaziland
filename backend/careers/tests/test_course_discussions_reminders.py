"""Course Q&A discussions and reminders for learners who've gone quiet."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from careers.course_reminders import send_course_reminders
from careers.models import (
    CourseModule, CourseStaff, CourseStaffRole, Lesson, LessonProgress, TrainingCategory, TrainingEnrollment, TrainingProgram,
)
from careers.services import drop_training, enroll_in_training
from identity.models import User
from notifications.models import Notification


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _user(name):
    return User.objects.create(username=name, phone=f"+2376{abs(hash(name)) % 10**8:08d}", first_name=name.title())


@pytest.fixture
def course(db):
    provider = _user("d_provider")
    program = TrainingProgram.objects.create(provider=provider, title="Lease Law", category=TrainingCategory.TENANT_LAW)
    module = CourseModule.objects.create(program=program, title="Week 1", position=1)
    first = Lesson.objects.create(module=module, title="Leases", position=1)
    second = Lesson.objects.create(module=module, title="Deposits", position=2)
    lecturer = _user("d_lecturer")
    CourseStaff.objects.create(program=program, user=lecturer, role=CourseStaffRole.LECTURER)
    return program, first, second, lecturer


@pytest.mark.django_db
def test_learners_ask_staff_answer_and_outsiders_are_kept_out(course):
    program, first, _, lecturer = course
    learner, classmate, outsider = _user("d_learner"), _user("d_classmate"), _user("d_outsider")
    enroll_in_training(program=program, student=learner)
    enroll_in_training(program=program, student=classmate)
    url = f"/api/trainings/{program.id}/discussions/"

    assert _client(outsider).get(url).status_code == 403
    assert _client(outsider).post(url, {"title": "Hi", "body": "?"}, format="json").status_code == 403
    assert _client(learner).post(url, {"title": "", "body": "?"}, format="json").status_code == 400

    created = _client(learner).post(url, {"title": "Notice period?", "body": "How long is it?", "lesson": str(first.id)}, format="json")
    assert created.status_code == 201, created.data
    thread_url = f"{url}{created.data['id']}/"
    assert created.data["lesson"]["title"] == "Leases"
    assert Notification.objects.filter(recipient=lecturer, notification_type="COURSE_DISCUSSION").count() == 1
    assert Notification.objects.filter(recipient=program.provider, notification_type="COURSE_DISCUSSION").count() == 1

    answered = _client(lecturer).post(thread_url, {"body": "Usually three months."}, format="json").data
    assert answered["replies"][0]["author_is_staff"] is True
    assert Notification.objects.filter(recipient=learner, notification_type="COURSE_DISCUSSION").count() == 1

    listing = _client(classmate).get(url).data["results"]
    assert listing[0]["reply_count"] == 1 and listing[0]["answered_by_staff"] is True
    assert _client(classmate).get(url, {"q": "three months"}).data["results"][0]["title"] == "Notice period?"
    assert _client(classmate).get(url, {"lesson": str(first.id)}).data["results"] != []


@pytest.mark.django_db
def test_only_authors_edit_and_authors_or_staff_delete(course):
    program, _, _, lecturer = course
    learner, classmate = _user("d_author"), _user("d_other")
    enroll_in_training(program=program, student=learner)
    enrollment = enroll_in_training(program=program, student=classmate)
    url = f"/api/trainings/{program.id}/discussions/"
    thread = _client(learner).post(url, {"title": "Q", "body": "first"}, format="json").data
    thread_url = f"{url}{thread['id']}/"
    reply = _client(classmate).post(thread_url, {"body": "my reply"}, format="json").data["replies"][0]

    assert _client(classmate).patch(thread_url, {"body": "hijack"}, format="json").status_code == 403
    edited = _client(learner).patch(thread_url, {"body": "edited", "title": "Q2"}, format="json").data
    assert edited["body"] == "edited" and edited["title"] == "Q2" and edited["edited_at"] is not None

    assert _client(learner).delete(f"{url}{reply['id']}/").status_code == 403
    assert _client(lecturer).delete(f"{url}{reply['id']}/").data["replies"] == []

    drop_training(enrollment)
    assert _client(classmate).get(url).status_code == 403  # dropping the course leaves its discussions

    assert _client(learner).delete(thread_url).status_code == 204
    assert _client(learner).get(url).data["results"] == []


@pytest.mark.django_db
def test_quiet_learners_are_reminded_once_a_week_until_they_give_up(course):
    program, first, _, _ = course
    learner = _user("d_quiet")
    enrollment = enroll_in_training(program=program, student=learner)
    now = timezone.now()

    assert send_course_reminders(now) == 0  # just enrolled
    TrainingEnrollment.objects.filter(pk=enrollment.pk).update(enrolled_at=now - timedelta(days=8))
    assert send_course_reminders(now) == 1
    reminder = Notification.objects.get(recipient=learner, notification_type="COURSE_REMINDER")
    assert "0%" in reminder.message and "Leases" in reminder.message
    assert send_course_reminders(now + timedelta(days=1)) == 0  # not again the next day

    progress = LessonProgress.objects.create(enrollment=enrollment, lesson=first)
    LessonProgress.objects.filter(pk=progress.pk).update(completed_at=now + timedelta(days=5))
    assert send_course_reminders(now + timedelta(days=8)) == 0  # active 3 days ago
    assert send_course_reminders(now + timedelta(days=16)) == 1
    assert "Deposits" in Notification.objects.filter(notification_type="COURSE_REMINDER").latest("created_at").message

    assert send_course_reminders(now + timedelta(days=90)) == 0  # gave up after 60 quiet days


@pytest.mark.django_db
def test_courses_without_lessons_are_not_reminded(db):
    provider, learner = _user("d_p2"), _user("d_l2")
    program = TrainingProgram.objects.create(provider=provider, title="Workshop", category=TrainingCategory.OTHER)
    enrollment = enroll_in_training(program=program, student=learner)
    TrainingEnrollment.objects.filter(pk=enrollment.pk).update(enrolled_at=timezone.now() - timedelta(days=10))
    assert send_course_reminders() == 0
