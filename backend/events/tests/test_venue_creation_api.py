"""
Tests for real Venue creation and photos — closing a genuine gap:
VenueViewSet was ReadOnlyModelViewSet, meaning no real venue owner
could ever list their own property.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from events.models import Venue


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_creating_a_real_venue_with_a_real_space(quarter):
    owner = User.objects.create(username="venue_create_owner", phone="+237699777701")
    client = _auth_client(owner)

    response = client.post("/api/venues/", {
        "quarter": str(quarter.id),
        "spaces": [{"space_name": "Main Hall", "capacity_theatre": 200, "base_price_per_hour_xaf": "25000"}],
    }, format="json")

    assert response.status_code == 201
    assert response.data["verified"] is False
    assert len(response.data["spaces"]) == 1
    venue = Venue.objects.get(id=response.data["id"])
    assert venue.owner_id == owner.id


@pytest.mark.django_db
def test_an_unverified_venue_is_hidden_from_public_browsing_but_visible_to_its_owner(quarter):
    owner = User.objects.create(username="venue_visibility_owner", phone="+237699777702")
    client = _auth_client(owner)
    client.post("/api/venues/", {"quarter": str(quarter.id), "spaces": [{"space_name": "Hall A"}]}, format="json")

    public_view = APIClient().get("/api/venues/")
    owner_view = client.get("/api/venues/")

    assert public_view.data["count"] == 0
    assert owner_view.data["count"] == 1


@pytest.mark.django_db
def test_creating_a_venue_with_no_spaces_is_rejected(quarter):
    owner = User.objects.create(username="venue_no_spaces_owner", phone="+237699777703")
    response = _auth_client(owner).post("/api/venues/", {"quarter": str(quarter.id), "spaces": []}, format="json")
    assert response.status_code == 400


@pytest.mark.django_db
def test_adding_a_real_photo_to_a_venue(quarter):
    owner = User.objects.create(username="venue_photo_owner", phone="+237699777704")
    client = _auth_client(owner)
    create_response = client.post("/api/venues/", {"quarter": str(quarter.id), "spaces": [{"space_name": "Garden"}]}, format="json")
    venue_id = create_response.data["id"]

    photo_response = client.post(f"/api/venues/{venue_id}/add-photo/", {"url": "https://example.com/venue1.jpg"})

    assert photo_response.status_code == 201
    detail = client.get(f"/api/venues/{venue_id}/")
    assert len(detail.data["photos"]) == 1


@pytest.mark.django_db
def test_only_the_venues_own_owner_can_add_a_photo(quarter):
    owner = User.objects.create(username="venue_photo_perm_owner", phone="+237699777705")
    stranger = User.objects.create(username="venue_photo_perm_stranger", phone="+237699777706")
    create_response = _auth_client(owner).post("/api/venues/", {"quarter": str(quarter.id), "spaces": [{"space_name": "Hall B"}]}, format="json")
    venue_id = create_response.data["id"]

    response = _auth_client(stranger).post(f"/api/venues/{venue_id}/add-photo/", {"url": "https://example.com/hijack.jpg"})

    assert response.status_code == 403


# ---------------------------------------------------------------------
# Real venue verification — the same real gap found for Hotel.
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_an_admin_can_verify_a_real_venue(quarter):
    from identity.models import AdminProfile

    owner = User.objects.create(username="venue_verify_owner", phone="+237699777707")
    admin_user = User.objects.create(username="venue_verify_admin", phone="+237699777708")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    create_response = _auth_client(owner).post("/api/venues/", {"quarter": str(quarter.id), "spaces": [{"space_name": "Hall C"}]}, format="json")
    venue_id = create_response.data["id"]

    response = _auth_client(admin_user).post(f"/api/venues/{venue_id}/verify/")

    assert response.status_code == 200
    assert response.data["verified"] is True

    public_view = APIClient().get("/api/venues/")
    assert public_view.data["count"] == 1


@pytest.mark.django_db
def test_only_an_admin_can_verify_a_venue(quarter):
    owner = User.objects.create(username="venue_verify_perm_owner", phone="+237699777709")
    stranger = User.objects.create(username="venue_verify_perm_stranger", phone="+237699777710")
    create_response = _auth_client(owner).post("/api/venues/", {"quarter": str(quarter.id), "spaces": [{"space_name": "Hall D"}]}, format="json")
    venue_id = create_response.data["id"]

    response = _auth_client(stranger).post(f"/api/venues/{venue_id}/verify/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_an_admin_sees_pending_venues_in_the_real_list_endpoint(quarter):
    from identity.models import AdminProfile

    owner = User.objects.create(username="venue_admin_queue_owner", phone="+237699777711")
    admin_user = User.objects.create(username="venue_admin_queue_admin", phone="+237699777712")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    _auth_client(owner).post("/api/venues/", {"quarter": str(quarter.id), "spaces": [{"space_name": "Hall E"}]}, format="json")

    admin_view = _auth_client(admin_user).get("/api/venues/")
    stranger_view = APIClient().get("/api/venues/")

    assert admin_view.data["count"] == 1
    assert stranger_view.data["count"] == 0
