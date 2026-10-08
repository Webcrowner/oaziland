"""Tests for the real careers API surfaces closed in this round: a job
poster shortlisting/rejecting applicants, sharing a posting via
WhatsApp, and a student starting/dropping a training enrollment — all
fully built and unit-tested at the service layer, but with zero
reachable endpoint until now."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from careers.models import JobRoleCategory, JobApplicationStatus, TrainingCategory, TrainingEnrollmentStatus


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_poster_can_shortlist_an_applicant_via_api():
    employer = User.objects.create(username="careers_employer", phone="+237699810001")
    applicant = User.objects.create(username="careers_applicant", phone="+237699810002")
    outsider = User.objects.create(username="careers_outsider", phone="+237699810003")

    create_response = _auth_client(employer).post("/api/jobs/", {
        "title": "Property Manager", "role_category": JobRoleCategory.PROPERTY_MANAGER, "description": "Manage listings.",
    })
    posting_id = create_response.data["id"]
    apply_response = _auth_client(applicant).post(f"/api/jobs/{posting_id}/apply/", {"cover_message": "I'm interested."})
    application_id = apply_response.data["id"]

    forbidden = _auth_client(outsider).post(f"/api/jobs/{posting_id}/update-application/", {
        "application_id": application_id, "new_status": JobApplicationStatus.SHORTLISTED,
    })
    assert forbidden.status_code == 403

    response = _auth_client(employer).post(f"/api/jobs/{posting_id}/update-application/", {
        "application_id": application_id, "new_status": JobApplicationStatus.SHORTLISTED,
    })
    assert response.status_code == 200
    assert response.data["status"] == JobApplicationStatus.SHORTLISTED


@pytest.mark.django_db
def test_poster_can_share_job_posting_via_whatsapp_api():
    employer = User.objects.create(username="careers_share_employer", phone="+237699810004")
    create_response = _auth_client(employer).post("/api/jobs/", {
        "title": "Hostel Warden", "role_category": JobRoleCategory.HOSTEL_WARDEN, "description": "Run the hostel.",
    })
    posting_id = create_response.data["id"]

    response = _auth_client(employer).post(f"/api/jobs/{posting_id}/share/", {"recipient_phone": "+237670000999"})
    assert response.status_code == 200
    assert "wa.me" in response.data["deep_link"]
    assert "Hostel Warden" in response.data["message"] or "oaziland.com" in response.data["message"]


@pytest.mark.django_db
def test_student_can_start_and_drop_training_via_api():
    provider = User.objects.create(username="careers_training_provider", phone="+237699810005")
    student = User.objects.create(username="careers_training_student", phone="+237699810006")
    from careers.models import TrainingProgram
    program = TrainingProgram.objects.create(provider=provider, title="Tenant Law Basics", category=TrainingCategory.TENANT_LAW)

    client = _auth_client(student)
    enroll_response = client.post(f"/api/trainings/{program.id}/enroll/")
    enrollment_id = enroll_response.data["id"]

    start_response = client.post(f"/api/my-enrollments/{enrollment_id}/start/")
    assert start_response.status_code == 200
    assert start_response.data["status"] == TrainingEnrollmentStatus.IN_PROGRESS

    drop_response = client.post(f"/api/my-enrollments/{enrollment_id}/drop/")
    assert drop_response.status_code == 200
    assert drop_response.data["status"] == TrainingEnrollmentStatus.DROPPED
