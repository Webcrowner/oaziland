"""
Tests for the real Job Posting API — closing a genuine gap:
JobPosting/JobApplication had real models and real service functions
(apply_to_job, update_application_status) but nothing ever exposed
either one over HTTP.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from careers.models import JobPosting, JobRoleCategory


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_creating_a_job_posting_sets_the_real_poster():
    employer = User.objects.create(username="job_employer", phone="+237699555501")
    client = _auth_client(employer)

    response = client.post("/api/jobs/", {
        "title": "Property Manager — Bastos Portfolio", "role_category": JobRoleCategory.PROPERTY_MANAGER,
        "description": "Manage a 20-unit portfolio.", "salary_min_xaf": "250000", "salary_max_xaf": "400000",
    })

    assert response.status_code == 201
    assert str(response.data["posted_by"]) == str(employer.id)


@pytest.mark.django_db
def test_job_postings_are_publicly_browsable():
    employer = User.objects.create(username="job_public_employer", phone="+237699555502")
    JobPosting.objects.create(posted_by=employer, title="Driver Needed", role_category=JobRoleCategory.DRIVER, description="Full-time driver.")

    response = APIClient().get("/api/jobs/")

    assert response.status_code == 200
    assert response.data["count"] == 1


@pytest.mark.django_db
def test_applying_to_a_job_and_rejecting_a_duplicate():
    employer = User.objects.create(username="job_apply_employer", phone="+237699555503")
    applicant = User.objects.create(username="job_applicant", phone="+237699555504")
    posting = JobPosting.objects.create(posted_by=employer, title="Hostel Warden", role_category=JobRoleCategory.HOSTEL_WARDEN, description="Manage a hostel.")
    client = _auth_client(applicant)

    first_response = client.post(f"/api/jobs/{posting.id}/apply/", {"cover_message": "I have relevant experience."})
    assert first_response.status_code == 201

    second_response = client.post(f"/api/jobs/{posting.id}/apply/", {"cover_message": "Applying again"})
    assert second_response.status_code == 409


@pytest.mark.django_db
def test_only_the_poster_can_see_who_applied():
    employer = User.objects.create(username="job_privacy_employer", phone="+237699555505")
    applicant = User.objects.create(username="job_privacy_applicant", phone="+237699555506")
    stranger = User.objects.create(username="job_privacy_stranger", phone="+237699555507")
    posting = JobPosting.objects.create(posted_by=employer, title="Maintenance Staff", role_category=JobRoleCategory.MAINTENANCE_STAFF, description="General maintenance.")
    _auth_client(applicant).post(f"/api/jobs/{posting.id}/apply/", {})

    employer_view = _auth_client(employer).get(f"/api/jobs/{posting.id}/applications/")
    stranger_view = _auth_client(stranger).get(f"/api/jobs/{posting.id}/applications/")

    assert employer_view.status_code == 200
    assert len(employer_view.data) == 1
    assert stranger_view.status_code == 403


@pytest.mark.django_db
def test_only_the_poster_can_edit_their_job_posting():
    employer = User.objects.create(username="job_edit_employer", phone="+237699555508")
    stranger = User.objects.create(username="job_edit_stranger", phone="+237699555509")
    posting = JobPosting.objects.create(posted_by=employer, title="Agent Role", role_category=JobRoleCategory.AGENT, description="Real estate agent.")

    response = _auth_client(stranger).patch(f"/api/jobs/{posting.id}/", {"title": "Hijacked Title"})

    assert response.status_code == 403
    posting.refresh_from_db()
    assert posting.title == "Agent Role"


@pytest.mark.django_db
def test_my_job_applications_are_scoped_to_the_requester():
    employer = User.objects.create(username="job_myapps_employer", phone="+237699555510")
    applicant_a = User.objects.create(username="job_myapps_a", phone="+237699555511")
    applicant_b = User.objects.create(username="job_myapps_b", phone="+237699555512")
    posting = JobPosting.objects.create(posted_by=employer, title="Driver Role", role_category=JobRoleCategory.DRIVER, description="Driving.")
    _auth_client(applicant_a).post(f"/api/jobs/{posting.id}/apply/", {})

    a_apps = _auth_client(applicant_a).get("/api/my-job-applications/")
    b_apps = _auth_client(applicant_b).get("/api/my-job-applications/")

    assert a_apps.data["count"] == 1
    assert b_apps.data["count"] == 0


@pytest.mark.django_db
def test_creating_a_job_posting_requires_authentication():
    response = APIClient().post("/api/jobs/", {"title": "Test", "role_category": JobRoleCategory.OTHER, "description": "Test"})
    assert response.status_code == 401
