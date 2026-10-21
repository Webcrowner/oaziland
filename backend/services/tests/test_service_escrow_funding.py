"""Pay-before-work: the approved quote is held in escrow before the technician starts."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus, AdminProfile
from monetization.models import PlatformFeePolicy, TransactionCategory, Wallet
from services.models import ServiceCategory, ServiceRequest, ServiceRequestStatus
from transactions.models import EscrowStatus, BookingStatus

LOC = {"latitude": "3.8481234", "longitude": "11.5021234"}
PHONE = "+237670000002"


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def approved_job(db):
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.SERVICE_PAYMENT, defaults={"fee_percent": Decimal("4.0")})
    requester = User.objects.create(username="ef_req", phone="+237699999001")
    KYCProfile.objects.create(
        user=requester, legal_full_name="Req", date_of_birth="1990-01-01", national_id_number="CM-EF-1",
        residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED,
    )
    technician = User.objects.create(username="ef_tech", phone="+237699999002")
    TechnicianProfile.objects.create(user=technician, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    job_id = _client(requester).post(
        "/api/service-requests/", {"category": ServiceCategory.PLUMBING, "description": "Leak", **LOC},
    ).data["id"]
    _client(technician).post(f"/api/service-requests/{job_id}/accept/")
    _client(technician).post(f"/api/service-requests/{job_id}/quote/", {"labor_xaf": "20000"}, format="json")
    _client(requester).post(f"/api/service-requests/{job_id}/approve-quote/")
    return job_id, requester, technician


@pytest.mark.django_db
def test_work_cannot_start_until_the_requester_has_paid_into_escrow(approved_job):
    job_id, requester, technician = approved_job
    blocked = _client(technician).post(f"/api/service-requests/{job_id}/start/")
    assert blocked.status_code == 400
    assert "escrow" in blocked.data["detail"]

    funded = _client(requester).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": PHONE}, format="json")
    assert funded.status_code == 200
    assert funded.data["escrow_funded"] is True
    assert _client(technician).post(f"/api/service-requests/{job_id}/start/").status_code == 200


@pytest.mark.django_db
def test_only_the_requester_can_fund_once_and_only_after_approval(approved_job):
    job_id, requester, technician = approved_job
    assert _client(technician).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": PHONE}, format="json").status_code == 403
    assert _client(requester).post(f"/api/service-requests/{job_id}/fund/", {}, format="json").status_code == 400
    assert _client(requester).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": PHONE}, format="json").status_code == 200
    assert _client(requester).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": PHONE}, format="json").status_code == 400


@pytest.mark.django_db
def test_funding_requires_an_approved_quote(db, approved_job):
    _, requester, technician = approved_job
    second = _client(requester).post(
        "/api/service-requests/", {"category": ServiceCategory.PLUMBING, "description": "Another", **LOC},
    ).data["id"]
    _client(technician).post(f"/api/service-requests/{second}/accept/")
    _client(technician).post(f"/api/service-requests/{second}/quote/", {"labor_xaf": "5000"}, format="json")
    assert _client(requester).post(f"/api/service-requests/{second}/fund/", {"phone_number": PHONE}, format="json").status_code == 400


@pytest.mark.django_db
def test_price_is_locked_once_funded_and_completion_pays_the_technician(approved_job):
    job_id, requester, technician = approved_job
    _client(requester).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": PHONE}, format="json")
    assert _client(technician).post(f"/api/service-requests/{job_id}/quote/", {"labor_xaf": "99999"}, format="json").status_code == 400

    _client(technician).post(f"/api/service-requests/{job_id}/start/")
    assert not Wallet.objects.filter(owner=technician, balance_xaf__gt=0).exists()  # nothing paid out while work is underway

    done = _client(requester).post(f"/api/service-requests/{job_id}/complete/", {}, format="json")
    assert done.status_code == 200
    assert done.data["status"] == "COMPLETED"
    assert Wallet.objects.get(owner=technician).balance_xaf == Decimal("19200.00")  # 20,000 minus the 4% fee


@pytest.mark.django_db
def test_technician_pulling_out_refunds_the_held_money(approved_job):
    job_id, requester, technician = approved_job
    _client(requester).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": PHONE}, format="json")
    booking = ServiceRequest.objects.get(id=job_id).booking

    assert _client(technician).post(f"/api/service-requests/{job_id}/release/").status_code == 200
    job = ServiceRequest.objects.get(id=job_id)
    assert job.status == ServiceRequestStatus.REQUESTED
    assert job.booking_id is None
    booking.refresh_from_db()
    assert booking.status == BookingStatus.CANCELLED
    assert booking.escrow.status == EscrowStatus.REFUNDED


@pytest.mark.django_db
def test_admin_cancelling_a_disputed_funded_job_refunds_but_resuming_keeps_the_hold(approved_job):
    job_id, requester, technician = approved_job
    _client(requester).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": PHONE}, format="json")
    _client(technician).post(f"/api/service-requests/{job_id}/start/")
    _client(requester).post(f"/api/service-requests/{job_id}/dispute/", {"reason": "Work was not done properly"}, format="json")
    admin = User.objects.create(username="ef_admin", phone="+237699999003", is_staff=True, is_superuser=True)
    AdminProfile.objects.get_or_create(user=admin)

    queue = _client(admin).get("/api/admin/service-disputes/").data
    assert queue[0]["escrow_funded"] is True

    booking = ServiceRequest.objects.get(id=job_id).booking
    assert _client(admin).post(f"/api/admin/service-disputes/{job_id}/resolve/", {"outcome": "RESUME"}, format="json").status_code == 200
    booking.refresh_from_db()
    assert booking.escrow.status == EscrowStatus.HELD

    _client(requester).post(f"/api/service-requests/{job_id}/dispute/", {"reason": "Still wrong"}, format="json")
    assert _client(admin).post(f"/api/admin/service-disputes/{job_id}/resolve/", {"outcome": "CANCEL"}, format="json").status_code == 200
    booking.refresh_from_db()
    assert booking.escrow.status == EscrowStatus.REFUNDED
    assert ServiceRequest.objects.get(id=job_id).booking_id is None
