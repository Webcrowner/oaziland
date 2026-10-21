"""Address/landmark on a request, and what URGENT actually changes (alerts, board order, quote deadline)."""
import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus
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


def _post(user, **payload):
    return _client(user).post("/api/service-requests/", {"category": ServiceCategory.PLUMBING, "description": "Leak", **payload})


@pytest.mark.django_db
def test_a_request_without_a_map_location_must_name_the_town_or_neighbourhood():
    requester = _requester("ug_req1", "+237699211001")
    assert _post(requester, address_note="Behind Total station, Bastos").status_code == 400
    assert _post(requester, area_label="   ").status_code == 400
    assert _post(requester).status_code == 400
    ok = _post(requester, address_note="Behind Total station", area_label="Bastos, Yaounde")
    assert ok.status_code == 201, ok.data
    assert _post(requester, area_label="Bastos, Yaounde call 670123456").status_code == 400


@pytest.mark.django_db
def test_the_area_label_is_visible_on_the_board_but_the_address_is_not():
    requester = _requester("ug_req1b", "+237699211005")
    plumber = _technician("ug_plumber1b", "+237699211006")
    job_id = _post(requester, address_note="Blue gate", area_label="Bastos, Yaounde").data["id"]
    seen = _client(plumber).get(f"/api/service-requests/{job_id}/").data
    assert seen["area_label"] == "Bastos, Yaounde" and seen["address_note"] == ""


@pytest.mark.django_db
def test_jobs_without_a_map_location_alert_fewer_technicians():
    requester = _requester("ug_req1c", "+237699211007")
    for i in range(30):
        _technician(f"ug_t1c_{i}", f"+2376992120{i:02d}")
    _post(requester, area_label="Bastos, Yaounde")
    assert Notification.objects.filter(notification_type="SERVICE_REQUEST_NEW").count() == 20


@pytest.mark.django_db
def test_the_address_is_only_shown_to_the_two_parties():
    requester = _requester("ug_req2", "+237699211011")
    plumber = _technician("ug_plumber2", "+237699211012")
    other = _technician("ug_other2", "+237699211013")
    job_id = _post(requester, address_note="Blue gate near the pharmacy", **SITE).data["id"]

    assert _client(other).get(f"/api/service-requests/{job_id}/").data["address_note"] == ""
    assert _client(requester).get(f"/api/service-requests/{job_id}/").data["address_note"] == "Blue gate near the pharmacy"
    _client(plumber).post(f"/api/service-requests/{job_id}/accept/")
    assert _client(plumber).get(f"/api/service-requests/{job_id}/").data["address_note"] == "Blue gate near the pharmacy"
    assert _client(other).get(f"/api/service-requests/{job_id}/").status_code == 404


@pytest.mark.django_db
def test_an_urgent_request_cannot_be_scheduled_for_later():
    requester = _requester("ug_req3", "+237699211021")
    later = (timezone.now() + timedelta(days=2)).isoformat()
    assert _post(requester, priority="URGENT", scheduled_for=later, **SITE).status_code == 400
    assert _post(requester, priority="SCHEDULED", scheduled_for=later, **SITE).status_code == 201
    assert _post(requester, priority="URGENT", **SITE).status_code == 201


@pytest.mark.django_db
def test_urgent_jobs_alert_more_technicians_with_an_urgent_title():
    requester = _requester("ug_req4", "+237699211031")
    technicians = [_technician(f"ug_t4_{i}", f"+2376992111{i:02d}") for i in range(60)]

    _post(requester, priority="SCHEDULED", **SITE)
    normal = Notification.objects.filter(notification_type="SERVICE_REQUEST_NEW").count()
    Notification.objects.all().delete()
    _post(requester, priority="URGENT", **SITE)
    urgent = Notification.objects.filter(notification_type="SERVICE_REQUEST_NEW")

    assert normal == 50 and urgent.count() == 60
    assert set(urgent.values_list("title", flat=True)) == {"URGENT job nearby"}
    assert len(technicians) == 60


@pytest.mark.django_db
def test_urgent_jobs_come_first_on_the_board_even_when_older():
    requester = _requester("ug_req5", "+237699211041")
    plumber = _technician("ug_plumber5", "+237699211042")
    urgent = ServiceRequest.objects.create(requester=requester, category=ServiceCategory.PLUMBING, description="Burst pipe", priority="URGENT", **SITE)
    ServiceRequest.objects.filter(pk=urgent.pk).update(requested_at=timezone.now() - timedelta(hours=5))
    newer = ServiceRequest.objects.create(requester=requester, category=ServiceCategory.PLUMBING, description="Dripping tap", **SITE)

    board = [r["id"] for r in _client(plumber).get("/api/service-requests/?scope=board").data["results"]]
    assert board == [str(urgent.id), str(newer.id)]


@pytest.mark.django_db
def test_urgent_jobs_have_a_shorter_quote_deadline():
    requester = _requester("ug_req6", "+237699211051")
    plumber = _technician("ug_plumber6", "+237699211052")
    urgent = ServiceRequest.objects.create(requester=requester, category=ServiceCategory.PLUMBING, description="Burst", priority="URGENT", **SITE)
    normal = ServiceRequest.objects.create(requester=requester, category=ServiceCategory.PLUMBING, description="Tap", **SITE)
    for job in (urgent, normal):
        assert _client(plumber).post(f"/api/service-requests/{job.id}/accept/").status_code == 200
    accepted_at = timezone.now() - timedelta(hours=3)
    ServiceRequest.objects.filter(pk__in=[urgent.pk, normal.pk]).update(accepted_at=accepted_at)

    data = _client(requester).get(f"/api/service-requests/{urgent.id}/").data
    assert timezone.datetime.fromisoformat(data["quote_deadline"]) == accepted_at + timedelta(hours=2)

    released = release_unresponsive_technicians()
    assert [j.pk for j in released] == [urgent.pk]
    normal.refresh_from_db()
    assert normal.status == ServiceRequestStatus.ACCEPTED
