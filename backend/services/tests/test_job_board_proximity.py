"""The open job board and new-job alerts are limited to jobs near the technician's last shared location."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus
from services.models import ServiceCategory, TechnicianLocationPing

YAOUNDE = {"latitude": "3.8481234", "longitude": "11.5021234"}
NEAR_YAOUNDE = (3.86, 11.51)
DOUALA = (4.05, 9.70)


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


def _technician(name, phone, ping=None):
    user = User.objects.create(username=name, phone=phone)
    TechnicianProfile.objects.create(user=user, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    if ping:
        TechnicianLocationPing.objects.create(technician=user, latitude=ping[0], longitude=ping[1])
    return user


def _post_job(requester):
    response = _client(requester).post("/api/service-requests/", {"category": ServiceCategory.PLUMBING, "description": "Leak", **YAOUNDE})
    assert response.status_code == 201, response.data
    return response.data["id"]


def _board(user, query=""):
    return {r["id"]: r for r in _client(user).get(f"/api/service-requests/{query}").data["results"]}


@pytest.mark.django_db
def test_board_only_shows_jobs_near_the_technicians_last_location_with_distance():
    requester = _requester("px_req1", "+237699999001")
    near = _technician("px_near", "+237699999002", NEAR_YAOUNDE)
    far = _technician("px_far", "+237699999003", DOUALA)
    job_id = _post_job(requester)

    assert job_id in _board(near)
    assert 0 < _board(near)[job_id]["distance_km"] < 5
    assert job_id not in _board(far)
    assert job_id in _board(far, "?radius_km=all")


@pytest.mark.django_db
def test_invalid_or_small_radius_falls_back_safely():
    requester = _requester("px_req2", "+237699999011")
    far = _technician("px_far2", "+237699999012", DOUALA)
    job_id = _post_job(requester)
    assert job_id not in _board(far, "?radius_km=50")
    assert job_id not in _board(far, "?radius_km=junk")


@pytest.mark.django_db
def test_technician_without_a_recent_location_still_sees_every_job():
    requester = _requester("px_req3", "+237699999021")
    unknown = _technician("px_unknown", "+237699999022")
    job_id = _post_job(requester)
    board = _board(unknown)
    assert job_id in board
    assert board[job_id]["distance_km"] is None


@pytest.mark.django_db
def test_requester_sees_no_distance_on_their_own_job():
    requester = _requester("px_req4", "+237699999031")
    job_id = _post_job(requester)
    assert _board(requester)[job_id]["distance_km"] is None


@pytest.mark.django_db
def test_new_job_alerts_skip_far_technicians_but_not_unlocated_ones():
    from notifications.models import Notification
    requester = _requester("px_req5", "+237699999041")
    near = _technician("px_near5", "+237699999042", NEAR_YAOUNDE)
    far = _technician("px_far5", "+237699999043", DOUALA)
    unknown = _technician("px_unknown5", "+237699999044")
    _post_job(requester)

    def alerted(user):
        return Notification.objects.filter(recipient=user, notification_type="SERVICE_REQUEST_NEW").exists()

    assert alerted(near)
    assert alerted(unknown)
    assert not alerted(far)
