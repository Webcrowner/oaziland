"""
Tests for the real Training/Course API — enroll_in_training() and
mark_training_completed() already existed and were tested at the
service layer, but nothing exposed them over HTTP, and duplicate
enrollment raised a raw, uncaught IntegrityError instead of a clean
error.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from careers.models import TrainingProgram, TrainingCategory, TrainingEnrollmentStatus
from careers.services import enroll_in_training, AlreadyEnrolledError


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_duplicate_enrollment_raises_a_clean_catchable_error_not_a_raw_db_error():
    provider = User.objects.create(username="training_api_provider", phone="+237699900001")
    student = User.objects.create(username="training_api_student", phone="+237699900002")
    program = TrainingProgram.objects.create(provider=provider, title="Agency Licensing Prep", category=TrainingCategory.AGENCY_LICENSING_PREP)

    enroll_in_training(program=program, student=student)
    with pytest.raises(AlreadyEnrolledError):
        enroll_in_training(program=program, student=student)


@pytest.mark.django_db
def test_training_directory_is_public_and_enroll_requires_login():
    provider = User.objects.create(username="training_api_provider_2", phone="+237699900003")
    student = User.objects.create(username="training_api_student_2", phone="+237699900004")
    program = TrainingProgram.objects.create(provider=provider, title="Hospitality Operations 101", category=TrainingCategory.HOSPITALITY_OPERATIONS, price_xaf=Decimal("10000"))

    anon_response = APIClient().get("/api/trainings/")
    assert anon_response.status_code == 200
    assert anon_response.data["count"] == 1

    anon_enroll = APIClient().post(f"/api/trainings/{program.id}/enroll/")
    assert anon_enroll.status_code == 401

    enroll_response = _auth_client(student).post(f"/api/trainings/{program.id}/enroll/")
    assert enroll_response.status_code == 201
    assert enroll_response.data["status"] == TrainingEnrollmentStatus.ENROLLED


@pytest.mark.django_db
def test_enrolling_twice_via_the_api_returns_a_clean_conflict_not_a_500():
    provider = User.objects.create(username="training_api_provider_3", phone="+237699900005")
    student = User.objects.create(username="training_api_student_3", phone="+237699900006")
    program = TrainingProgram.objects.create(provider=provider, title="Tenant Law Refresher", category=TrainingCategory.TENANT_LAW)

    client = _auth_client(student)
    first = client.post(f"/api/trainings/{program.id}/enroll/")
    assert first.status_code == 201

    second = client.post(f"/api/trainings/{program.id}/enroll/")
    assert second.status_code == 409  # a clean, real HTTP error — not an unhandled 500


@pytest.mark.django_db
def test_my_enrollments_are_scoped_to_self_and_completion_works():
    provider = User.objects.create(username="training_api_provider_4", phone="+237699900007")
    student_a = User.objects.create(username="training_api_student_a", phone="+237699900008")
    student_b = User.objects.create(username="training_api_student_b", phone="+237699900009")
    program = TrainingProgram.objects.create(provider=provider, title="Property Management Basics", category=TrainingCategory.PROPERTY_MANAGEMENT_BASICS, issues_certification=True)

    enroll_in_training(program=program, student=student_a)

    a_client = _auth_client(student_a)
    b_client = _auth_client(student_b)

    a_enrollments = a_client.get("/api/my-enrollments/")
    b_enrollments = b_client.get("/api/my-enrollments/")
    assert a_enrollments.data["count"] == 1
    assert b_enrollments.data["count"] == 0  # never sees student_a's enrollment

    enrollment_id = a_enrollments.data["results"][0]["id"]
    complete_response = a_client.post(f"/api/my-enrollments/{enrollment_id}/complete/")
    assert complete_response.status_code == 200
    assert complete_response.data["status"] == TrainingEnrollmentStatus.COMPLETED
    assert complete_response.data["certificate_issued_at"] is not None
