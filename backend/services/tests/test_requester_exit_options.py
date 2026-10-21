"""A requester can reject a quote or replace the technician, and a silent technician is removed automatically."""
import pytest
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus
from monetization.models import PlatformFeePolicy, TransactionCategory
from notifications.models import Notification
from services.models import ServiceCategory, ServiceRequest, ServiceRequestStatus
from services.services import release_unresponsive_technicians

SITE = {"latitude": "3.8481234", "longitude": "11.5021234"}


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _requester(name, phone):
    user = User.objects.create(username=name, phone=phone)
    KYCProfile.objects.create(
        user=user, legal_full_name=name, date_of_birth="1990-01-01", national_id_number=f"CM-{user.id}",
        residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED,
    )
    return user


def _technician(name, phone):
    user = User.objects.create(username=name, phone=phone)
    TechnicianProfile.objects.create(user=user, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    return user


def _accepted_job(requester, technician):
    job = ServiceRequest.objects.create(requester=requester, category=ServiceCategory.PLUMBING, description="Leak", **SITE)
    response = _client(technician).post(f"/api/service-requests/{job.id}/accept/")
    assert response.status_code == 200, response.data
    return job


def _fee_policy():
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.SERVICE_PAYMENT, defaults={"fee_percent": Decimal("4.0")})


def _post(user, job, action, expected=200):
    response = _client(user).post(f"/api/service-requests/{job.id}/{action}/")
    assert response.status_code == expected, response.data
    return response


@pytest.mark.django_db
def test_requester_can_reject_a_quote_and_the_technician_must_requote():
    requester = _requester("dm_req1", "+237699555001")
    plumber = _technician("dm_plumber1", "+237699555002")
    job = _accepted_job(requester, plumber)
    _client(plumber).post(f"/api/service-requests/{job.id}/quote/", {"amount_xaf": "50000"})

    _post(requester, job, "reject-quote")
    job.refresh_from_db()
    assert job.quoted_amount_xaf is None and not job.quote_approved
    assert Notification.objects.filter(recipient=plumber, notification_type="SERVICE_REQUEST_QUOTE_REJECTED").exists()
    # Nothing left to reject, and strangers/technicians cannot do it.
    _post(requester, job, "reject-quote", 400)
    _client(plumber).post(f"/api/service-requests/{job.id}/quote/", {"amount_xaf": "30000"})
    _post(plumber, job, "reject-quote", 403)


@pytest.mark.django_db
def test_requester_can_replace_the_technician_and_the_job_returns_to_the_board():
    requester = _requester("dm_req2", "+237699555011")
    plumber = _technician("dm_plumber2", "+237699555012")
    other = _technician("dm_plumber2b", "+237699555013")
    job = _accepted_job(requester, plumber)

    _post(plumber, job, "dismiss-technician", 403)
    _post(requester, job, "dismiss-technician")
    job.refresh_from_db()
    assert job.status == ServiceRequestStatus.REQUESTED and job.technician is None
    assert Notification.objects.filter(recipient=plumber, notification_type="SERVICE_REQUEST_DISMISSED").exists()
    # Others are alerted, the dismissed technician is not alerted again.
    assert Notification.objects.filter(recipient=other, notification_type="SERVICE_REQUEST_NEW").exists()
    assert not Notification.objects.filter(recipient=plumber, notification_type="SERVICE_REQUEST_NEW").exists()
    _post(other, job, "accept")
    _post(requester, job, "dismiss-technician")  # works again for the next technician


@pytest.mark.django_db
def test_dismissing_after_funding_refunds_the_escrow():
    _fee_policy()
    requester = _requester("dm_req3", "+237699555021")
    plumber = _technician("dm_plumber3", "+237699555022")
    job = _accepted_job(requester, plumber)
    _client(plumber).post(f"/api/service-requests/{job.id}/quote/", {"amount_xaf": "40000"})
    _post(requester, job, "approve-quote")
    funded = _client(requester).post(f"/api/service-requests/{job.id}/fund/", {"phone_number": "670000000"})
    assert funded.status_code == 200, funded.data
    assert funded.data["escrow_funded"] is True

    # A rejected quote cannot be changed once paid.
    _post(requester, job, "reject-quote", 400)
    _post(requester, job, "dismiss-technician")
    job.refresh_from_db()
    assert job.booking_id is None and job.status == ServiceRequestStatus.REQUESTED
    assert Notification.objects.filter(recipient=requester, notification_type="SERVICE_REQUEST_REFUNDED").exists()


@pytest.mark.django_db
def test_a_funded_job_cannot_be_dismissed_once_the_technician_is_on_the_way():
    _fee_policy()
    requester = _requester("dm_req4", "+237699555031")
    plumber = _technician("dm_plumber4", "+237699555032")
    job = _accepted_job(requester, plumber)
    _client(plumber).post(f"/api/service-requests/{job.id}/quote/", {"amount_xaf": "40000"})
    _post(requester, job, "approve-quote")
    _client(requester).post(f"/api/service-requests/{job.id}/fund/", {"phone_number": "670000000"})
    _post(plumber, job, "en-route")
    _post(requester, job, "dismiss-technician", 400)


@pytest.mark.django_db
def test_technician_who_never_quotes_is_removed_after_the_deadline():
    requester = _requester("dm_req5", "+237699555041")
    silent = _technician("dm_silent5", "+237699555042")
    quoted = _technician("dm_quoted5", "+237699555043")
    fresh = _technician("dm_fresh5", "+237699555044")
    late = _accepted_job(requester, silent)
    with_quote = _accepted_job(requester, quoted)
    _client(quoted).post(f"/api/service-requests/{with_quote.id}/quote/", {"amount_xaf": "20000"})
    recent = _accepted_job(requester, fresh)
    ServiceRequest.objects.filter(pk__in=[late.pk, with_quote.pk]).update(accepted_at=timezone.now() - timedelta(hours=13))

    released = release_unresponsive_technicians()

    assert [j.pk for j in released] == [late.pk]
    late.refresh_from_db(); with_quote.refresh_from_db(); recent.refresh_from_db()
    assert late.status == ServiceRequestStatus.REQUESTED and late.technician is None
    assert with_quote.status == ServiceRequestStatus.ACCEPTED
    assert recent.status == ServiceRequestStatus.ACCEPTED
    assert Notification.objects.filter(recipient=silent, notification_type="SERVICE_REQUEST_TIMEOUT").exists()
    assert Notification.objects.filter(recipient=requester, notification_type="SERVICE_REQUEST_RELEASED").exists()


@pytest.mark.django_db
def test_quote_deadline_is_exposed_until_a_quote_is_sent_and_the_command_runs_the_sweep():
    requester = _requester("dm_req6", "+237699555051")
    plumber = _technician("dm_plumber6", "+237699555052")
    job = _accepted_job(requester, plumber)
    assert _client(requester).get(f"/api/service-requests/{job.id}/").data["quote_deadline"]
    _client(plumber).post(f"/api/service-requests/{job.id}/quote/", {"amount_xaf": "20000"})
    assert _client(requester).get(f"/api/service-requests/{job.id}/").data["quote_deadline"] is None

    other = _accepted_job(requester, _technician("dm_slow6", "+237699555053"))
    ServiceRequest.objects.filter(pk=other.pk).update(accepted_at=timezone.now() - timedelta(hours=20))
    out = StringIO()
    call_command("expire_stale_service_requests", stdout=out)
    assert "Released 1" in out.getvalue()
