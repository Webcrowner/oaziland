"""Certificate PDF download, course analytics for staff, and public trainer pages."""
import json
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from careers.models import (
    CourseModule, CourseStaff, CourseStaffRole, Lesson, LessonKind, QuizAttempt, TrainingCategory, TrainingEnrollment, TrainingProgram,
)
from careers.services import enroll_in_training
from identity.models import User


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _user(name, **extra):
    return User.objects.create(username=name, phone=f"+2376{abs(hash(name)) % 10**8:08d}", first_name=name.title(), **extra)


@pytest.fixture
def course(db):
    provider = _user("an_provider", is_staff=True)  # courses are created by admins, who become their provider
    program = TrainingProgram.objects.create(provider=provider, title="Lease Law", category=TrainingCategory.TENANT_LAW, issues_certification=True)
    module = CourseModule.objects.create(program=program, title="Week 1")
    reading = Lesson.objects.create(module=module, title="Read", position=1)
    quiz = Lesson.objects.create(module=module, title="Quiz", kind=LessonKind.QUIZ, position=2, pass_mark_percent=70)
    from careers.models import QuizQuestion
    QuizQuestion.objects.create(lesson=quiz, text="Q")
    return program, reading, quiz


@pytest.mark.django_db
def test_a_certificate_downloads_as_a_pdf(course):
    program, _, _ = course
    learner = _user("an_graduate")
    TrainingEnrollment.objects.create(
        program=program, student=learner, status="COMPLETED", completed_at=timezone.now(),
        certificate_issued_at=timezone.now(), certificate_code="OZL-TESTPDF234",
    )
    response = APIClient().get("/api/certificates/ozl-testpdf234/pdf/?lang=fr")
    assert response.status_code == 200 and response["Content-Type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert 'filename="oaziland-certificate-OZL-TESTPDF234.pdf"' in response["Content-Disposition"]
    assert APIClient().get("/api/certificates/OZL-NOPE/pdf/").status_code == 404


@pytest.mark.django_db
def test_analytics_show_the_funnel_quiz_difficulty_and_earnings_to_the_right_people(course):
    program, reading, quiz = course
    supervisor, outsider = _user("an_sup"), _user("an_out")
    CourseStaff.objects.create(program=program, user=supervisor, role=CourseStaffRole.SUPERVISOR)
    learners = [enroll_in_training(program=program, student=_user(f"an_l{i}")) for i in range(4)]
    for enrollment in learners[:3]:
        _client(enrollment.student).post(f"/api/my-enrollments/{enrollment.id}/lessons/{reading.id}/complete/")
    # learner 0 passes first time; learner 1 fails then passes; learner 2 only fails.
    QuizAttempt.objects.create(enrollment=learners[0], lesson=quiz, score_percent=90, passed=True)
    QuizAttempt.objects.create(enrollment=learners[1], lesson=quiz, score_percent=40, passed=False)
    QuizAttempt.objects.create(enrollment=learners[1], lesson=quiz, score_percent=80, passed=True)
    QuizAttempt.objects.create(enrollment=learners[2], lesson=quiz, score_percent=50, passed=False)

    url = f"/api/manage/courses/{program.id}/analytics/"
    assert _client(outsider).get(url).status_code == 404
    data = _client(supervisor).get(url).data
    assert data["earnings"] is None  # only admins and the provider see money

    assert data["learners"]["total"] == 4 and data["learners"]["in_progress"] == 3
    assert [(step["title"], step["completed"], step["percent"]) for step in data["lesson_funnel"]] == [("Read", 3, 75), ("Quiz", 0, 0)]
    q = data["quizzes"][0]
    assert q["learners"] == 3 and q["attempts"] == 4
    assert q["first_try_pass_percent"] == 33 and q["pass_percent"] == 67 and q["average_best_score"] == 73

    earnings = _client(program.provider).get(url).data["earnings"]
    assert earnings == {
        "sales": 0, "paid_by_learners_xaf": "0.00", "held_in_escrow_xaf": "0.00", "released_to_trainer_xaf": "0.00",
        "platform_fees_xaf": "0.00", "refunded_xaf": "0.00",
    }


@pytest.mark.django_db
def test_paid_course_earnings_follow_the_escrow(course):
    from careers.services import confirm_training_payment, pay_for_training
    from payments.gateways import SandboxGateway
    from transactions.locks import InMemoryLockClient
    from transactions.services import confirm_payment
    program, reading, quiz = course
    TrainingProgram.objects.filter(pk=program.pk).update(price_xaf=Decimal("10000"))
    program.refresh_from_db()
    lock = InMemoryLockClient()
    enrollment = pay_for_training(program=program, student=_user("an_payer"), phone_number="+237670000009", lock_client=lock, payment_gateway=SandboxGateway())
    confirm_payment(lock_client=lock, booking=enrollment.booking, provider="MTN_MOMO", provider_reference="AN-1")
    confirm_training_payment(booking=enrollment.booking)

    earnings = _client(program.provider).get(f"/api/manage/courses/{program.id}/analytics/").data["earnings"]
    assert earnings["sales"] == 1 and earnings["paid_by_learners_xaf"] == "10000.00"
    assert earnings["held_in_escrow_xaf"] == "10000.00" and earnings["released_to_trainer_xaf"] == "0.00"


@pytest.mark.django_db
def test_trainers_have_a_public_page_they_can_edit(course):
    program, _, _ = course
    lecturer, nobody = _user("an_lecturer"), _user("an_nobody")
    CourseStaff.objects.create(program=program, user=lecturer, role=CourseStaffRole.LECTURER)
    TrainingProgram.objects.create(provider=program.provider, title="Draft", category=TrainingCategory.OTHER, is_published=False)

    assert APIClient().get(f"/api/trainers/{nobody.id}/").status_code == 404
    assert APIClient().get("/api/trainers/not-a-uuid/").status_code == 404
    assert APIClient().get(f"/api/trainers/{lecturer.id}/").data["courses"][0]["title"] == "Lease Law"

    client = _client(program.provider)
    assert client.get("/api/my-trainer-profile/").data["is_trainer"] is True
    assert client.put("/api/my-trainer-profile/save/", {"website": "not a url"}, format="json").status_code == 400
    saved = client.put("/api/my-trainer-profile/save/", {"headline": "Property lawyer", "bio": "12 years in Douala.", "website": "https://example.cm"}, format="json")
    assert saved.status_code == 200, saved.data

    page = APIClient().get(f"/api/trainers/{program.provider_id}/").data
    assert page["headline"] == "Property lawyer" and page["bio"] == "12 years in Douala."
    assert [c["title"] for c in page["courses"]] == ["Lease Law"]  # drafts stay hidden
    assert page["stats"] == {"courses": 1, "learners": 0, "rating_average": None, "rating_count": 0}
    assert json.loads(json.dumps(page["courses"][0], default=str))["provider_id"] == str(program.provider_id)
