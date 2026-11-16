"""Admins running Oaziland's own offers through the platform account (identity.platform_account)."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from geo.models import Country, Division, Quarter, Region, Subdivision, VillageOrDistrict
from identity.models import AdminProfile, User
from identity.platform_account import get_platform_account
from trust_safety.models import AuditLog


def _client(token=None, user=None):
    client = APIClient()
    if user is not None:
        token = str(RefreshToken.for_user(user).access_token)
    if token:
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


def _admin(username, permissions=None):
    user = User.objects.create(username=username, phone=f"+2376{abs(hash(username)) % 10**8:08d}")
    AdminProfile.objects.create(user=user, permissions=permissions or [])
    return user


def _platform_token(admin):
    response = _client(user=admin).post("/api/platform-session/")
    assert response.status_code == 201, response.data
    return response.data["access"]


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_an_admin_lists_a_hotel_as_oaziland_and_it_is_audited(quarter):
    admin = _admin("platform_boss")
    token = _platform_token(admin)

    created = _client(token).post("/api/hotels/", {
        "quarter": str(quarter.id), "name": "Oaziland Suites",
        "room_types": [{"name": "Double", "category": "STANDARD", "capacity": 2, "base_rate_xaf": "30000", "room_count": 2}],
    }, format="json")
    assert created.status_code == 201, created.data
    platform = get_platform_account()
    assert str(created.data["owner"]) == str(platform.pk)
    assert created.data["lister_role"] == "PLATFORM"
    assert AuditLog.objects.filter(actor=admin, target_type="platform_account", action__contains="POST hotels/").exists()

    me = _client(token).get("/api/auth/me/")
    assert me.status_code == 200 and me.data["username"] == "oaziland"


@pytest.mark.django_db
def test_only_admins_allowed_to_can_start_a_platform_session():
    member = User.objects.create(username="plain_member", phone="+237690000001")
    assert _client(user=member).post("/api/platform-session/").status_code == 403
    limited = _admin("limited_admin", permissions=["reports"])
    assert _client(user=limited).post("/api/platform-session/").status_code == 403
    granted = _admin("listings_admin", permissions=["reports", "platform_listings"])
    assert _client(user=granted).post("/api/platform-session/").status_code == 201


@pytest.mark.django_db
def test_a_platform_session_runs_the_business_but_cannot_buy_or_reach_the_console():
    limited = _admin("store_admin", permissions=["platform_listings"])
    client = _client(_platform_token(limited))
    assert client.get("/api/admin/withdrawals/").status_code == 403
    assert client.post("/api/bookings/", {}, format="json").status_code == 403
    assert client.post("/api/wallet/withdraw/", {"amount_xaf": 1000}, format="json").status_code == 403
    assert client.post("/api/auth/change-password/", {}, format="json").status_code == 403


@pytest.mark.django_db
def test_nobody_can_sign_in_as_the_platform_and_sessions_end_with_admin_rights():
    platform = get_platform_account()
    assert not platform.has_usable_password()
    assert _client(user=platform).get("/api/auth/me/").status_code == 401

    admin = _admin("leaving_admin")
    token = _platform_token(admin)
    AdminProfile.objects.filter(user=admin).delete()
    assert _client(token).get("/api/auth/me/").status_code == 401
    assert AccessToken(token)["act_platform_admin"] == str(admin.pk)
