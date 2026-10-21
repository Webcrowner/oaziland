"""A requester can pick a technician from the directory; only that technician sees and can accept the job."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus
from services.models import ServiceCategory, ServiceRequest

LOC = {"latitude": "3.8481234", "longitude": "11.5021234"}


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


def _technician(name, phone, specialties=(ServiceCategory.PLUMBING,), verified=True):
    user = User.objects.create(username=name, phone=phone)
    TechnicianProfile.objects.create(user=user, is_verified=verified, specialties=list(specialties))
    return user


def _post(requester, technician=None, category=ServiceCategory.PLUMBING):
    payload = {"category": category, "description": "Leak", **LOC}
    if technician is not None:
        payload["requested_technician"] = str(technician.id)
    return _client(requester).post("/api/service-requests/", payload)


def _listed(user):
    return [r["id"] for r in _client(user).get("/api/service-requests/").data["results"]]


@pytest.mark.django_db
def test_directed_request_is_only_visible_to_and_acceptable_by_the_chosen_technician():
    requester = _requester("dr_req1", "+237699888001")
    chosen = _technician("dr_chosen", "+237699888002")
    other = _technician("dr_other", "+237699888003")
    response = _post(requester, chosen)
    assert response.status_code == 201, response.data
    job_id = response.data["id"]

    assert job_id in _listed(chosen)
    assert job_id not in _listed(other)
    assert _client(other).get(f"/api/service-requests/{job_id}/").status_code == 404
    assert _client(other).post(f"/api/service-requests/{job_id}/accept/").status_code == 403
    assert _client(chosen).post(f"/api/service-requests/{job_id}/accept/").status_code == 200


@pytest.mark.django_db
def test_only_the_chosen_technician_is_notified_of_a_directed_request():
    from notifications.models import Notification
    requester = _requester("dr_req2", "+237699888011")
    chosen = _technician("dr_chosen2", "+237699888012")
    other = _technician("dr_other2", "+237699888013")
    _post(requester, chosen)
    assert Notification.objects.filter(recipient=chosen).exists()
    assert not Notification.objects.filter(recipient=other).exists()


@pytest.mark.django_db
def test_cannot_request_an_unverified_or_mismatched_or_self_technician():
    requester = _requester("dr_req3", "+237699888021")
    unverified = _technician("dr_unv", "+237699888022", verified=False)
    painter = _technician("dr_painter", "+237699888023", [ServiceCategory.PAINTING])
    assert _post(requester, unverified).status_code == 400
    assert _post(requester, painter).status_code == 400
    requester_tech = TechnicianProfile.objects.create(user=requester, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    assert requester_tech and _post(requester, requester).status_code == 400
    assert ServiceRequest.objects.count() == 0


@pytest.mark.django_db
def test_declining_opens_the_job_to_the_board_and_tells_the_requester():
    from notifications.models import Notification
    requester = _requester("dr_req4", "+237699888031")
    chosen = _technician("dr_chosen4", "+237699888032")
    other = _technician("dr_other4", "+237699888033")
    job_id = _post(requester, chosen).data["id"]

    assert _client(other).post(f"/api/service-requests/{job_id}/decline/").status_code == 403
    assert _client(chosen).post(f"/api/service-requests/{job_id}/decline/").status_code == 200

    assert job_id in _listed(other)
    assert Notification.objects.filter(recipient=requester, notification_type="SERVICE_REQUEST_DECLINED").exists()
    assert Notification.objects.filter(recipient=other, notification_type="SERVICE_REQUEST_NEW").exists()
    assert _client(other).post(f"/api/service-requests/{job_id}/accept/").status_code == 200


@pytest.mark.django_db
def test_requester_can_open_a_directed_request_to_everyone():
    requester = _requester("dr_req5", "+237699888041")
    chosen = _technician("dr_chosen5", "+237699888042")
    other = _technician("dr_other5", "+237699888043")
    job_id = _post(requester, chosen).data["id"]

    assert _client(chosen).post(f"/api/service-requests/{job_id}/open-to-all/").status_code == 403
    assert _client(requester).post(f"/api/service-requests/{job_id}/open-to-all/").status_code == 200
    assert job_id in _listed(other)
    # Already open: a second call is rejected.
    assert _client(requester).post(f"/api/service-requests/{job_id}/open-to-all/").status_code == 400


@pytest.mark.django_db
def test_releasing_a_directed_job_opens_it_to_everyone():
    requester = _requester("dr_req6", "+237699888051")
    chosen = _technician("dr_chosen6", "+237699888052")
    other = _technician("dr_other6", "+237699888053")
    job_id = _post(requester, chosen).data["id"]
    _client(chosen).post(f"/api/service-requests/{job_id}/accept/")
    assert _client(chosen).post(f"/api/service-requests/{job_id}/release/").status_code == 200
    assert job_id in _listed(other)


@pytest.mark.django_db
def test_directory_can_be_filtered_to_one_technician():
    chosen = _technician("dr_chosen7", "+237699888061")
    _technician("dr_other7", "+237699888062")
    client = APIClient()
    rows = client.get(f"/api/technicians/?user_id={chosen.id}").data
    assert [r["user_id"] for r in rows] == [str(chosen.id)]
    assert client.get("/api/technicians/?user_id=not-a-uuid").data == []
