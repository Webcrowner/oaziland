"""The technician reports the work done; a silent requester's held payment is released automatically."""
import pytest
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus
from monetization.models import PlatformFeePolicy, TransactionCategory, Wallet
from notifications.models import Notification
from services.models import ServiceCategory, ServiceRequest, ServiceRequestStatus
from services.services import auto_release_completed_jobs
from transactions.models import EscrowStatus

LOC = {"latitude": "3.8481234", "longitude": "11.5021234"}
PHONE = "+237670000002"


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def in_progress_job(db):
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.SERVICE_PAYMENT, defaults={"fee_percent": Decimal("4.0")})
    requester = User.objects.create(username="wd_req", phone="+237699444001")
    KYCProfile.objects.create(
        user=requester, legal_full_name="Req", date_of_birth="1990-01-01", national_id_number="CM-WD-1",
        residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED,
    )
    technician = User.objects.create(username="wd_tech", phone="+237699444002")
    TechnicianProfile.objects.create(user=technician, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    job_id = _client(requester).post(
        "/api/service-requests/", {"category": ServiceCategory.PLUMBING, "description": "Leak", **LOC},
    ).data["id"]
    _client(technician).post(f"/api/service-requests/{job_id}/accept/")
    _client(technician).post(f"/api/service-requests/{job_id}/quote/", {"labor_xaf": "20000"}, format="json")
    _client(requester).post(f"/api/service-requests/{job_id}/approve-quote/")
    _client(requester).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": PHONE}, format="json")
    assert _client(technician).post(f"/api/service-requests/{job_id}/start/").status_code == 200
    return ServiceRequest.objects.get(pk=job_id), requester, technician


def _age_work_done(job, hours):
    ServiceRequest.objects.filter(pk=job.pk).update(work_completed_at=timezone.now() - timedelta(hours=hours))


@pytest.mark.django_db
def test_only_the_assigned_technician_can_report_work_done_once(in_progress_job):
    job, requester, technician = in_progress_job
    url = f"/api/service-requests/{job.id}/work-done/"
    assert _client(requester).post(url).status_code == 403

    response = _client(technician).post(url)
    assert response.status_code == 200
    assert response.data["work_completed_at"] and response.data["auto_release_at"]
    assert Notification.objects.filter(recipient=requester, notification_type="SERVICE_REQUEST_WORK_DONE").exists()
    assert _client(technician).post(url).status_code == 400


@pytest.mark.django_db
def test_work_cannot_be_reported_done_before_it_starts():
    requester = User.objects.create(username="wd_req2", phone="+237699444011")
    technician = User.objects.create(username="wd_tech2", phone="+237699444012")
    job = ServiceRequest.objects.create(
        requester=requester, technician=technician, category=ServiceCategory.PLUMBING, description="x",
        status=ServiceRequestStatus.ACCEPTED, **LOC,
    )
    assert _client(technician).post(f"/api/service-requests/{job.id}/work-done/").status_code == 400


@pytest.mark.django_db
def test_payment_is_released_automatically_after_the_window(in_progress_job):
    job, requester, technician = in_progress_job
    _client(technician).post(f"/api/service-requests/{job.id}/work-done/")

    _age_work_done(job, 71)
    assert auto_release_completed_jobs() == []

    _age_work_done(job, 73)
    released = auto_release_completed_jobs()
    assert [j.pk for j in released] == [job.pk]
    job.refresh_from_db()
    assert job.status == ServiceRequestStatus.COMPLETED
    assert job.booking.escrow.status == EscrowStatus.RELEASED
    assert Wallet.objects.get(owner=technician).balance_xaf > 0
    assert Notification.objects.filter(recipient=requester, notification_type="SERVICE_REQUEST_AUTO_RELEASED").exists()


@pytest.mark.django_db
def test_jobs_never_reported_done_or_disputed_are_not_auto_released(in_progress_job):
    job, requester, technician = in_progress_job
    # Technician never signalled: nothing happens however long it has been.
    ServiceRequest.objects.filter(pk=job.pk).update(started_at=timezone.now() - timedelta(days=30))
    assert auto_release_completed_jobs() == []

    _client(technician).post(f"/api/service-requests/{job.id}/work-done/")
    assert _client(requester).post(f"/api/service-requests/{job.id}/dispute/", {"reason": "Still leaking"}, format="json").status_code == 200
    job.refresh_from_db()
    assert job.work_completed_at is None
    assert auto_release_completed_jobs() == []


@pytest.mark.django_db
def test_command_runs_the_auto_release(in_progress_job):
    job, requester, technician = in_progress_job
    _client(technician).post(f"/api/service-requests/{job.id}/work-done/")
    _age_work_done(job, 100)
    out = StringIO()
    call_command("expire_stale_service_requests", stdout=out)
    assert "Auto-released payment on 1" in out.getvalue()
