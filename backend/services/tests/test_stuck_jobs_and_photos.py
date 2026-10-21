"""No-show technicians are released, a technician who left a job cannot retake it, and problem photos go with the request."""
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
from services.services import release_no_show_technicians

SITE = {"latitude": "3.8481234", "longitude": "11.5021234"}
PHONE = "670000000"


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


def _fee_policy():
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.SERVICE_PAYMENT, defaults={"fee_percent": Decimal("4.0")})


def _job(requester, **extra):
    return ServiceRequest.objects.create(requester=requester, category=ServiceCategory.PLUMBING, description="Leak", **SITE, **extra)


def _funded_en_route_job(requester, technician):
    job = _job(requester)
    assert _client(technician).post(f"/api/service-requests/{job.id}/accept/").status_code == 200
    _client(technician).post(f"/api/service-requests/{job.id}/quote/", {"amount_xaf": "40000"})
    _client(requester).post(f"/api/service-requests/{job.id}/approve-quote/")
    assert _client(requester).post(f"/api/service-requests/{job.id}/fund/", {"phone_number": PHONE}).status_code == 200
    assert _client(technician).post(f"/api/service-requests/{job.id}/en-route/").status_code == 200
    job.refresh_from_db()
    return job


def _board_ids(user):
    return [r["id"] for r in _client(user).get("/api/service-requests/?scope=board&radius_km=all").data["results"]]


@pytest.mark.django_db
def test_a_funded_job_can_be_dismissed_once_the_technician_is_overdue():
    _fee_policy()
    requester = _requester("sj_req1", "+237699122001")
    plumber = _technician("sj_plumber1", "+237699122002")
    job = _funded_en_route_job(requester, plumber)

    assert _client(requester).post(f"/api/service-requests/{job.id}/dismiss-technician/").status_code == 400
    ServiceRequest.objects.filter(pk=job.pk).update(en_route_at=timezone.now() - timedelta(hours=5))
    assert _client(requester).post(f"/api/service-requests/{job.id}/dismiss-technician/").status_code == 200
    job.refresh_from_db()
    assert job.booking_id is None and job.status == ServiceRequestStatus.REQUESTED


@pytest.mark.django_db
def test_no_show_sweep_releases_overdue_technicians_and_refunds_the_payment():
    _fee_policy()
    requester = _requester("sj_req2", "+237699122011")
    ghost = _technician("sj_ghost2", "+237699122012")
    prompt = _technician("sj_prompt2", "+237699122013")
    other = _technician("sj_other2", "+237699122014")
    ghosted = _funded_en_route_job(requester, ghost)
    on_time = _funded_en_route_job(requester, prompt)
    ServiceRequest.objects.filter(pk=ghosted.pk).update(en_route_at=timezone.now() - timedelta(hours=5))

    released = release_no_show_technicians()

    assert [j.pk for j in released] == [ghosted.pk]
    ghosted.refresh_from_db(); on_time.refresh_from_db()
    assert ghosted.status == ServiceRequestStatus.REQUESTED and ghosted.booking_id is None
    assert on_time.status == ServiceRequestStatus.EN_ROUTE and on_time.booking_id is not None
    assert Notification.objects.filter(recipient=ghost, notification_type="SERVICE_REQUEST_NO_SHOW").exists()
    assert Notification.objects.filter(recipient=requester, notification_type="SERVICE_REQUEST_REFUNDED").exists()
    assert str(ghosted.id) in _board_ids(other)


@pytest.mark.django_db
def test_a_missed_booked_time_counts_but_an_early_en_route_before_a_future_booking_does_not():
    requester = _requester("sj_req3", "+237699122021")
    missed_tech = _technician("sj_missed3", "+237699122022")
    early_tech = _technician("sj_early3", "+237699122023")
    missed = _job(requester, technician=missed_tech, status=ServiceRequestStatus.ACCEPTED, scheduled_for=timezone.now() - timedelta(hours=6))
    early = _job(
        requester, technician=early_tech, status=ServiceRequestStatus.EN_ROUTE,
        en_route_at=timezone.now() - timedelta(hours=10), scheduled_for=timezone.now() + timedelta(hours=20),
    )
    released = release_no_show_technicians()
    assert [j.pk for j in released] == [missed.pk]
    early.refresh_from_db()
    assert early.status == ServiceRequestStatus.EN_ROUTE


@pytest.mark.django_db
def test_command_runs_the_no_show_sweep():
    requester = _requester("sj_req4", "+237699122031")
    ghost = _technician("sj_ghost4", "+237699122032")
    _job(requester, technician=ghost, status=ServiceRequestStatus.EN_ROUTE, en_route_at=timezone.now() - timedelta(hours=9))
    out = StringIO()
    call_command("expire_stale_service_requests", stdout=out)
    assert "Released 1 no-show" in out.getvalue()


@pytest.mark.django_db
def test_a_technician_who_released_the_job_cannot_take_it_again():
    requester = _requester("sj_req5", "+237699122041")
    quitter = _technician("sj_quitter5", "+237699122042")
    other = _technician("sj_other5", "+237699122043")
    job = _job(requester)
    _client(quitter).post(f"/api/service-requests/{job.id}/accept/")
    assert _client(quitter).post(f"/api/service-requests/{job.id}/release/").status_code == 200

    assert str(job.id) not in _board_ids(quitter)
    assert _client(quitter).get(f"/api/service-requests/{job.id}/").status_code == 404
    assert _client(quitter).post(f"/api/service-requests/{job.id}/accept/").status_code == 403
    assert not Notification.objects.filter(recipient=quitter, notification_type="SERVICE_REQUEST_NEW", related_reference=str(job.id)).exists()
    assert str(job.id) in _board_ids(other)
    assert _client(other).post(f"/api/service-requests/{job.id}/accept/").status_code == 200


@pytest.mark.django_db
def test_dismissed_declined_and_timed_out_technicians_are_also_excluded():
    requester = _requester("sj_req6", "+237699122051")
    dismissed = _technician("sj_dismissed6", "+237699122052")
    declined = _technician("sj_declined6", "+237699122053")
    silent = _technician("sj_silent6", "+237699122054")

    job = _job(requester)
    _client(dismissed).post(f"/api/service-requests/{job.id}/accept/")
    _client(requester).post(f"/api/service-requests/{job.id}/dismiss-technician/")
    assert _client(dismissed).post(f"/api/service-requests/{job.id}/accept/").status_code == 403

    directed = _client(requester).post("/api/service-requests/", {
        "category": ServiceCategory.PLUMBING, "description": "Tap", "requested_technician": str(declined.id), **SITE,
    }).data["id"]
    assert _client(declined).post(f"/api/service-requests/{directed}/decline/").status_code == 200
    assert _client(declined).post(f"/api/service-requests/{directed}/accept/").status_code == 403

    late = _job(requester)
    _client(silent).post(f"/api/service-requests/{late.id}/accept/")
    ServiceRequest.objects.filter(pk=late.pk).update(accepted_at=timezone.now() - timedelta(hours=30))
    from services.services import release_unresponsive_technicians
    assert len(release_unresponsive_technicians()) == 1
    assert _client(silent).post(f"/api/service-requests/{late.id}/accept/").status_code == 403


@pytest.mark.django_db
def test_problem_photos_can_be_attached_when_posting_and_technicians_see_them():
    requester = _requester("sj_req7", "+237699122061")
    plumber = _technician("sj_plumber7", "+237699122062")
    urls = ["https://example.com/a.jpg", "https://example.com/b.jpg"]
    response = _client(requester).post("/api/service-requests/", {
        "category": ServiceCategory.PLUMBING, "description": "Burst pipe", "photo_urls": urls, **SITE,
    }, format="json")
    assert response.status_code == 201, response.data
    assert [p["file_url"] for p in response.data["photos"]] == urls
    assert {p["photo_type"] for p in response.data["photos"]} == {"BEFORE"}

    board = _client(plumber).get(f"/api/service-requests/{response.data['id']}/").data
    assert len(board["photos"]) == 2


@pytest.mark.django_db
def test_photo_limits_and_url_validation():
    requester = _requester("sj_req8", "+237699122071")
    base = {"category": ServiceCategory.PLUMBING, "description": "Leak", **SITE}
    too_many = [f"https://example.com/{i}.jpg" for i in range(6)]
    assert _client(requester).post("/api/service-requests/", {**base, "photo_urls": too_many}, format="json").status_code == 400
    assert _client(requester).post("/api/service-requests/", {**base, "photo_urls": ["not a url"]}, format="json").status_code == 400
