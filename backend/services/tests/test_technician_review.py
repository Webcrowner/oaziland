"""Admin review of technicians: verify, reject, revoke, with notifications."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus, AdminProfile
from notifications.models import Notification
from services.models import ServiceCategory, ServiceRequest, ServiceRequestStatus

LOC = {"latitude": "3.8481234", "longitude": "11.5021234"}
DOC = ["https://example.com/cert.jpg"]


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def admin(db):
    user = User.objects.create(username="tr_admin", phone="+237699111001", is_staff=True, is_superuser=True)
    AdminProfile.objects.get_or_create(user=user)
    return user


def _technician(name, phone, verified=False, credentials=DOC):
    user = User.objects.create(username=name, phone=phone)
    profile = TechnicianProfile.objects.create(
        user=user, is_verified=verified, specialties=[ServiceCategory.PLUMBING], credential_urls=credentials,
    )
    return user, profile


@pytest.mark.django_db
def test_verifying_notifies_the_technician(admin):
    user, profile = _technician("tr_a", "+237699111002")
    assert _client(admin).post(f"/api/admin/technicians/{profile.id}/verify/").status_code == 200
    profile.refresh_from_db()
    assert profile.is_verified is True
    assert profile.reviewed_at is not None
    assert Notification.objects.filter(recipient=user, notification_type="TECHNICIAN_VERIFIED").exists()
    assert _client(admin).post(f"/api/admin/technicians/{profile.id}/verify/").status_code == 400


@pytest.mark.django_db
def test_rejecting_removes_it_from_pending_and_tells_the_technician_why(admin):
    user, profile = _technician("tr_b", "+237699111003")
    admin_client = _client(admin)
    assert admin_client.post(f"/api/admin/technicians/{profile.id}/reject/", {}, format="json").status_code == 400  # reason required
    assert admin_client.post(f"/api/admin/technicians/{profile.id}/reject/", {"reason": "Certificate is blurry"}, format="json").status_code == 200

    assert [t["id"] for t in admin_client.get("/api/admin/technicians/").data["results"]] == []
    rejected = admin_client.get("/api/admin/technicians/", {"status": "rejected"}).data["results"]
    assert [t["id"] for t in rejected] == [profile.id]
    assert rejected[0]["rejection_reason"] == "Certificate is blurry"
    note = Notification.objects.get(recipient=user, notification_type="TECHNICIAN_REJECTED")
    assert "Certificate is blurry" in note.message

    mine = _client(user).get("/api/my-technician-profile/").data
    assert mine["rejection_reason"] == "Certificate is blurry"


@pytest.mark.django_db
def test_resubmitting_documents_puts_a_rejected_application_back_in_the_queue(admin):
    user, profile = _technician("tr_c", "+237699111004")
    _client(admin).post(f"/api/admin/technicians/{profile.id}/reject/", {"reason": "Blurry"}, format="json")
    saved = _client(user).put(
        "/api/my-technician-documents/",
        {"credential_urls": ["https://example.com/new.jpg"], "portfolio_urls": []}, format="json",
    )
    assert saved.status_code == 200
    assert saved.data["rejection_reason"] == ""
    pending = _client(admin).get("/api/admin/technicians/").data["results"]
    assert [t["id"] for t in pending] == [profile.id]


@pytest.mark.django_db
def test_verified_technicians_cannot_be_rejected_only_revoked(admin):
    _, profile = _technician("tr_d", "+237699111005", verified=True)
    assert _client(admin).post(f"/api/admin/technicians/{profile.id}/reject/", {"reason": "Nope"}, format="json").status_code == 400
    assert [t["id"] for t in _client(admin).get("/api/admin/technicians/", {"status": "verified"}).data["results"]] == [profile.id]


@pytest.mark.django_db
def test_revoking_blocks_new_jobs_and_returns_unstarted_jobs_to_the_board(admin):
    user, profile = _technician("tr_e", "+237699111006", verified=True)
    requester = User.objects.create(username="tr_req", phone="+237699111007")
    KYCProfile.objects.create(
        user=requester, legal_full_name="Req", date_of_birth="1990-01-01", national_id_number="CM-TR-1",
        residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED,
    )
    job_id = _client(requester).post(
        "/api/service-requests/", {"category": ServiceCategory.PLUMBING, "description": "Leak", **LOC},
    ).data["id"]
    assert _client(user).post(f"/api/service-requests/{job_id}/accept/").status_code == 200

    response = _client(admin).post(f"/api/admin/technicians/{profile.id}/revoke/", {"reason": "Complaints from customers"}, format="json")
    assert response.status_code == 200
    assert response.data["released_jobs"] == 1
    job = ServiceRequest.objects.get(id=job_id)
    assert job.status == ServiceRequestStatus.REQUESTED
    assert job.technician_id is None
    profile.refresh_from_db()
    assert profile.is_verified is False
    assert Notification.objects.filter(recipient=user, notification_type="TECHNICIAN_REVOKED").exists()

    assert _client(user).post(f"/api/service-requests/{job_id}/accept/").status_code == 403
    assert _client(admin).post(f"/api/admin/technicians/{profile.id}/revoke/", {"reason": "Again"}, format="json").status_code == 400


@pytest.mark.django_db
def test_technician_review_actions_are_admin_only():
    _, profile = _technician("tr_f", "+237699111008")
    outsider = User.objects.create(username="tr_out", phone="+237699111009")
    for action in ("verify", "reject", "revoke"):
        assert _client(outsider).post(f"/api/admin/technicians/{profile.id}/{action}/", {"reason": "x" * 5}, format="json").status_code == 403
