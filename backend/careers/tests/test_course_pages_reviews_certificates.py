"""Coursera-style course pages: syllabus, learner ratings & reviews, verifiable certificates and catalogue sorting."""
import re
from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from careers.models import CourseModule, Lesson, LessonKind, TrainingCategory, TrainingEnrollment, TrainingProgram
from careers.services import enroll_in_training
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
    provider = _user("rv_provider")
    program = TrainingProgram.objects.create(
        provider=provider, title="Tenant Law", description="Leases and deposits.",
        category=TrainingCategory.TENANT_LAW, issues_certification=True,
    )
    module = CourseModule.objects.create(program=program, title="Week 1")
    first = Lesson.objects.create(module=module, title="Leases", kind=LessonKind.TEXT, content_text="Secret lesson body", position=1)
    second = Lesson.objects.create(module=module, title="Deposits", kind=LessonKind.VIDEO, video_url="https://example.com/v.mp4", position=2)
    return program, first, second


def _complete(client, enrollment, lesson):
    return client.post(f"/api/my-enrollments/{enrollment.id}/lessons/{lesson.id}/complete/")


@pytest.mark.django_db
def test_the_course_page_shows_the_syllabus_but_never_lesson_content(course):
    program, _, _ = course
    data = APIClient().get(f"/api/trainings/{program.id}/").data

    assert data["syllabus"] == [{
        "id": str(program.modules.get().id), "title": "Week 1",
        "lessons": [
            {"id": str(program.modules.get().lessons.get(title="Leases").id), "title": "Leases", "kind": "TEXT"},
            {"id": str(program.modules.get().lessons.get(title="Deposits").id), "title": "Deposits", "kind": "VIDEO"},
        ],
    }]
    assert "Secret lesson body" not in str(data) and "example.com" not in str(data)
    assert data["lesson_count"] == 2 and data["learner_count"] == 0 and data["rating_average"] is None


@pytest.mark.django_db
def test_only_learners_who_started_the_course_can_review_it(course):
    program, first, _ = course
    learner, stranger = _user("rv_learner"), _user("rv_stranger")
    enrollment = enroll_in_training(program=program, student=learner)
    url = f"/api/trainings/{program.id}/reviews/"
    review = {"score": 4, "text": "Clear and practical."}

    assert APIClient().post(url, review, format="json").status_code == 401
    assert _client(stranger).post(url, review, format="json").status_code == 400
    assert _client(program.provider).post(url, review, format="json").status_code == 400
    not_started = _client(learner).get(url).data
    assert not_started["can_review"] is False and not_started["cannot_review_reason"] == "not_started"

    _complete(_client(learner), enrollment, first)
    created = _client(learner).post(url, review, format="json")
    assert created.status_code == 200, created.data
    assert created.data["average"] == 4.0 and created.data["count"] == 1
    assert created.data["my_review"]["text"] == "Clear and practical."

    updated = _client(learner).post(url, {"score": 2, "text": "Changed my mind."}, format="json").data
    assert updated["count"] == 1 and updated["average"] == 2.0 and updated["distribution"]["2"] == 1
    assert Notification.objects.filter(recipient=program.provider, notification_type="NEW_REVIEW").count() == 1

    public = APIClient().get(url).data
    assert public["results"][0]["author_name"] == "Rv_Learner" and public["results"][0]["is_mine"] is False
    assert _client(learner).post(url, {"score": 9}, format="json").status_code == 400

    assert _client(learner).delete(url).data["count"] == 0
    assert _client(learner).delete(url).status_code == 404


@pytest.mark.django_db
def test_completing_a_course_issues_a_verifiable_certificate_and_notifies_both_sides(course):
    program, first, second = course
    learner = _user("rv_graduate")
    enrollment = enroll_in_training(program=program, student=learner)
    client = _client(learner)
    _complete(client, enrollment, first)
    _complete(client, enrollment, second)

    enrollment.refresh_from_db()
    assert re.fullmatch(r"OZL-[A-HJ-NP-Z2-9]{10}", enrollment.certificate_code)
    mine = client.get("/api/my-enrollments/").data["results"][0]
    assert mine["certificate_code"] == enrollment.certificate_code

    certificate = APIClient().get(f"/api/certificates/{enrollment.certificate_code.lower()}/")
    assert certificate.status_code == 200
    assert certificate.data["learner_name"] == "Rv_Graduate"
    assert certificate.data["course_title"] == "Tenant Law" and certificate.data["lesson_count"] == 2
    assert APIClient().get("/api/certificates/OZL-NOTAREALONE/").status_code == 404

    assert Notification.objects.filter(recipient=learner, notification_type="TRAINING_COMPLETED", message__contains=enrollment.certificate_code).exists()
    assert Notification.objects.filter(recipient=program.provider, notification_type="TRAINING_COMPLETED").exists()


@pytest.mark.django_db
def test_a_course_without_a_certificate_completes_without_a_code(course):
    program, first, second = course
    TrainingProgram.objects.filter(pk=program.pk).update(issues_certification=False)
    program.refresh_from_db()
    learner = _user("rv_nocert")
    enrollment = enroll_in_training(program=program, student=learner)
    _complete(_client(learner), enrollment, first)
    _complete(_client(learner), enrollment, second)
    enrollment.refresh_from_db()
    assert enrollment.status == "COMPLETED" and enrollment.certificate_code is None


@pytest.mark.django_db
def test_the_catalogue_reports_ratings_and_learners_and_can_sort_by_them(course):
    program, first, _ = course
    other = TrainingProgram.objects.create(provider=program.provider, title="Another course", category=TrainingCategory.OTHER, price_xaf=Decimal("5000"))
    for name, score in (("rv_a", 5), ("rv_b", 3)):
        learner = _user(name)
        enrollment = enroll_in_training(program=program, student=learner)
        _complete(_client(learner), enrollment, first)
        _client(learner).post(f"/api/trainings/{program.id}/reviews/", {"score": score}, format="json")

    rows = {r["title"]: r for r in APIClient().get("/api/trainings/").data["results"]}
    assert rows["Tenant Law"]["rating_average"] == 4.0 and rows["Tenant Law"]["rating_count"] == 2
    assert rows["Tenant Law"]["learner_count"] == 2 and rows["Tenant Law"]["lesson_count"] == 2  # no row multiplication
    assert rows["Another course"]["rating_average"] is None and rows["Another course"]["learner_count"] == 0

    def titles(ordering):
        return [r["title"] for r in APIClient().get(f"/api/trainings/?ordering={ordering}").data["results"]]

    assert titles("rating") == ["Tenant Law", "Another course"]
    assert titles("popular") == ["Tenant Law", "Another course"]
    assert titles("price_desc") == ["Another course", "Tenant Law"]
    assert TrainingEnrollment.objects.filter(program=program).count() == 2
