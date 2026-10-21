"""The job list can be paged and split by ?scope= so active jobs never get buried under board jobs."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus
from services.models import ServiceCategory, ServiceRequest

SITE = {"latitude": "3.8481234", "longitude": "11.5021234"}


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _user(name, phone, technician=False):
    user = User.objects.create(username=name, phone=phone)
    KYCProfile.objects.create(
        user=user, legal_full_name=name, date_of_birth="1990-01-01", national_id_number=f"CM-{user.id}",
        residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED,
    )
    if technician:
        TechnicianProfile.objects.create(user=user, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    return user


def _job(requester, **extra):
    return ServiceRequest.objects.create(requester=requester, category=ServiceCategory.PLUMBING, description="Leak", **SITE, **extra)


def _ids(user, query):
    return [r["id"] for r in _client(user).get(f"/api/service-requests/{query}").data["results"]]


@pytest.mark.django_db
def test_my_requests_are_paged_and_report_a_next_page():
    requester = _user("sc_req1", "+237699666001")
    for _ in range(25):
        _job(requester)
    first = _client(requester).get("/api/service-requests/?scope=mine").data
    assert first["count"] == 25 and len(first["results"]) == 20 and first["next"]
    second = _client(requester).get("/api/service-requests/?scope=mine&page=2").data
    assert len(second["results"]) == 5 and second["next"] is None


@pytest.mark.django_db
def test_assigned_jobs_are_not_buried_under_board_jobs():
    requester = _user("sc_req2", "+237699666011")
    plumber = _user("sc_plumber2", "+237699666012", technician=True)
    mine = _job(requester, technician=plumber, status="ACCEPTED")
    board_jobs = [_job(requester) for _ in range(25)]

    assert _ids(plumber, "?scope=jobs") == [str(mine.id)]
    board = _ids(plumber, "?scope=board&radius_km=all")
    assert str(mine.id) not in board
    assert set(board) <= {str(j.id) for j in board_jobs} and len(board) == 20
    # Without a scope the combined list is unchanged.
    assert len(_ids(plumber, "")) == 20


@pytest.mark.django_db
def test_board_scope_is_empty_for_non_technicians_and_excludes_own_requests():
    customer = _user("sc_customer3", "+237699666021")
    _job(customer)
    assert _ids(customer, "?scope=board") == []
    assert _ids(customer, "?scope=jobs") == []

    both = _user("sc_both3", "+237699666022", technician=True)
    own = _job(both)
    assert str(own.id) in _ids(both, "?scope=mine")
    assert str(own.id) not in _ids(both, "?scope=board")
