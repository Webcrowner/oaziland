"""Admin resolution of disputed service jobs (disputes raised before any payment exists)."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus, AdminProfile
from notifications.models import Notification
from services.models import ServiceCategory, ServiceRequest, ServiceRequestStatus

LOC = {"latitude": "3.8481234", "longitude": "11.5021234"}


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _admin():
    admin = User.objects.create(username="sd_admin", phone="+237699888001", is_staff=True, is_superuser=True)
    AdminProfile.objects.get_or_create(user=admin)
    return admin


@pytest.fixture
def disputed_job(db):
    requester = User.objects.create(username="sd_req", phone="+237699888002")
    KYCProfile.objects.create(
        user=requester, legal_full_name="Req", date_of_birth="1990-01-01", national_id_number="CM-SD-1",
        residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED,
    )
    technician = User.objects.create(username="sd_tech", phone="+237699888003")
    TechnicianProfile.objects.create(user=technician, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    job_id = _client(requester).post(
        "/api/service-requests/", {"category": ServiceCategory.PLUMBING, "description": "Leak", **LOC},
    ).data["id"]
    assert _client(technician).post(f"/api/service-requests/{job_id}/accept/").status_code == 200
    _client(technician).post(f"/api/service-requests/{job_id}/quote/", {"labor_xaf": "20000"}, format="json")
    _client(requester).post(f"/api/service-requests/{job_id}/approve-quote/")
    _client(requester).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": "+237670000001"})
    assert _client(technician).post(f"/api/service-requests/{job_id}/start/").status_code == 200
    assert _client(requester).post(
        f"/api/service-requests/{job_id}/dispute/", {"reason": "Work was not done properly"}, format="json",
    ).status_code == 200
    return job_id, requester, technician


@pytest.mark.django_db
def test_disputed_jobs_queue_is_admin_only(disputed_job):
    job_id, requester, _ = disputed_job
    assert APIClient().get("/api/admin/service-disputes/").status_code == 401
    assert _client(requester).get("/api/admin/service-disputes/").status_code == 403

    listed = _client(_admin()).get("/api/admin/service-disputes/")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.data] == [job_id]
    assert listed.data[0]["dispute_reason"] == "Work was not done properly"


@pytest.mark.django_db
def test_admin_can_resume_a_disputed_job(disputed_job):
    job_id, requester, technician = disputed_job
    response = _client(_admin()).post(
        f"/api/admin/service-disputes/{job_id}/resolve/", {"outcome": "RESUME", "notes": "Finish the repair"}, format="json",
    )
    assert response.status_code == 200
    job = ServiceRequest.objects.get(id=job_id)
    assert job.status == ServiceRequestStatus.IN_PROGRESS
    assert job.technician_id == technician.id
    assert job.dispute_resolution == "RESUME"
    assert job.dispute_resolved_at is not None
    assert Notification.objects.filter(recipient=requester, notification_type="SERVICE_REQUEST_DISPUTE_RESOLVED").exists()
    assert Notification.objects.filter(recipient=technician, notification_type="SERVICE_REQUEST_DISPUTE_RESOLVED").exists()


@pytest.mark.django_db
def test_admin_can_put_a_disputed_job_back_on_the_board(disputed_job):
    job_id, _, _ = disputed_job
    assert _client(_admin()).post(
        f"/api/admin/service-disputes/{job_id}/resolve/", {"outcome": "REASSIGN"}, format="json",
    ).status_code == 200
    job = ServiceRequest.objects.get(id=job_id)
    assert job.status == ServiceRequestStatus.REQUESTED
    assert job.technician_id is None
    assert job.quote_approved is False
    assert job.quoted_amount_xaf is None


@pytest.mark.django_db
def test_admin_can_cancel_a_disputed_job_and_it_leaves_the_queue(disputed_job):
    job_id, _, _ = disputed_job
    admin_client = _client(_admin())
    assert admin_client.post(
        f"/api/admin/service-disputes/{job_id}/resolve/", {"outcome": "CANCEL", "notes": "Both parties agreed"}, format="json",
    ).status_code == 200
    assert ServiceRequest.objects.get(id=job_id).status == ServiceRequestStatus.CANCELLED
    assert admin_client.get("/api/admin/service-disputes/").data == []
    assert admin_client.post(
        f"/api/admin/service-disputes/{job_id}/resolve/", {"outcome": "CANCEL"}, format="json",
    ).status_code == 404


@pytest.mark.django_db
def test_resolve_rejects_unknown_outcomes_and_non_admins(disputed_job):
    job_id, requester, _ = disputed_job
    assert _client(_admin()).post(
        f"/api/admin/service-disputes/{job_id}/resolve/", {"outcome": "NONSENSE"}, format="json",
    ).status_code == 400
    assert _client(requester).post(
        f"/api/admin/service-disputes/{job_id}/resolve/", {"outcome": "CANCEL"}, format="json",
    ).status_code == 403
    assert ServiceRequest.objects.get(id=job_id).status == ServiceRequestStatus.DISPUTED
