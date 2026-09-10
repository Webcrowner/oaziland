"""
Tests for real Hotel creation and photos — closing a genuine gap:
HotelViewSet was ReadOnlyModelViewSet, meaning no real hotel owner
could ever list their own property; every hotel on the platform could
only have existed via Django admin or a seed script.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from hotels.models import Hotel


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
def test_creating_a_real_hotel_with_a_real_room_type(quarter):
    owner = User.objects.create(username="hotel_create_owner", phone="+237699666601")
    client = _auth_client(owner)

    response = client.post("/api/hotels/", {
        "quarter": str(quarter.id), "star_rating": 4,
        "room_types": [{"category": "DELUXE", "capacity": 2, "base_rate_xaf": "45000"}],
    }, format="json")

    assert response.status_code == 201
    assert response.data["verified"] is False
    assert len(response.data["room_types"]) == 1
    hotel = Hotel.objects.get(id=response.data["id"])
    assert hotel.owner_id == owner.id


@pytest.mark.django_db
def test_an_unverified_hotel_is_hidden_from_public_browsing_but_visible_to_its_owner(quarter):
    owner = User.objects.create(username="hotel_visibility_owner", phone="+237699666602")
    client = _auth_client(owner)
    client.post("/api/hotels/", {
        "quarter": str(quarter.id), "room_types": [{"category": "STANDARD", "capacity": 1, "base_rate_xaf": "20000"}],
    }, format="json")

    public_view = APIClient().get("/api/hotels/")
    owner_view = client.get("/api/hotels/")

    assert public_view.data["count"] == 0
    assert owner_view.data["count"] == 1


@pytest.mark.django_db
def test_creating_a_hotel_with_no_room_types_is_rejected(quarter):
    owner = User.objects.create(username="hotel_no_rooms_owner", phone="+237699666603")
    response = _auth_client(owner).post("/api/hotels/", {"quarter": str(quarter.id), "room_types": []}, format="json")
    assert response.status_code == 400


@pytest.mark.django_db
def test_adding_a_real_photo_to_a_hotel(quarter):
    owner = User.objects.create(username="hotel_photo_owner", phone="+237699666604")
    client = _auth_client(owner)
    create_response = client.post("/api/hotels/", {
        "quarter": str(quarter.id), "room_types": [{"category": "STANDARD", "capacity": 2, "base_rate_xaf": "30000"}],
    }, format="json")
    hotel_id = create_response.data["id"]

    photo_response = client.post(f"/api/hotels/{hotel_id}/add-photo/", {"url": "https://example.com/hotel1.jpg"})

    assert photo_response.status_code == 201
    detail = client.get(f"/api/hotels/{hotel_id}/")
    assert len(detail.data["photos"]) == 1


@pytest.mark.django_db
def test_only_the_hotels_own_owner_can_add_a_photo(quarter):
    owner = User.objects.create(username="hotel_photo_perm_owner", phone="+237699666605")
    stranger = User.objects.create(username="hotel_photo_perm_stranger", phone="+237699666606")
    create_response = _auth_client(owner).post("/api/hotels/", {
        "quarter": str(quarter.id), "room_types": [{"category": "STANDARD", "capacity": 2, "base_rate_xaf": "30000"}],
    }, format="json")
    hotel_id = create_response.data["id"]

    response = _auth_client(stranger).post(f"/api/hotels/{hotel_id}/add-photo/", {"url": "https://example.com/hijack.jpg"})

    assert response.status_code == 403


@pytest.mark.django_db
def test_creating_a_hotel_requires_authentication(quarter):
    response = APIClient().post("/api/hotels/", {"quarter": str(quarter.id), "room_types": [{"category": "STANDARD", "capacity": 1, "base_rate_xaf": "10000"}]}, format="json")
    assert response.status_code == 401


# ---------------------------------------------------------------------
# Real hotel verification — a genuine gap found after the fact: real
# hotel creation (above) correctly starts a hotel unverified, but
# nothing anywhere could ever flip that flag back — a real owner's
# listing would have stayed permanently invisible to the public.
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_an_admin_can_verify_a_real_hotel(quarter):
    from identity.models import AdminProfile

    owner = User.objects.create(username="hotel_verify_owner", phone="+237699666607")
    admin_user = User.objects.create(username="hotel_verify_admin", phone="+237699666608")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    create_response = _auth_client(owner).post("/api/hotels/", {
        "quarter": str(quarter.id), "room_types": [{"category": "STANDARD", "capacity": 2, "base_rate_xaf": "30000"}],
    }, format="json")
    hotel_id = create_response.data["id"]

    response = _auth_client(admin_user).post(f"/api/hotels/{hotel_id}/verify/")

    assert response.status_code == 200
    assert response.data["verified"] is True

    public_view = APIClient().get("/api/hotels/")
    assert public_view.data["count"] == 1


@pytest.mark.django_db
def test_only_an_admin_can_verify_a_hotel(quarter):
    owner = User.objects.create(username="hotel_verify_perm_owner", phone="+237699666609")
    stranger = User.objects.create(username="hotel_verify_perm_stranger", phone="+237699666610")
    create_response = _auth_client(owner).post("/api/hotels/", {
        "quarter": str(quarter.id), "room_types": [{"category": "STANDARD", "capacity": 2, "base_rate_xaf": "30000"}],
    }, format="json")
    hotel_id = create_response.data["id"]

    response = _auth_client(stranger).post(f"/api/hotels/{hotel_id}/verify/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_an_admin_sees_pending_hotels_in_the_real_list_endpoint(quarter):
    from identity.models import AdminProfile

    owner = User.objects.create(username="hotel_admin_queue_owner", phone="+237699666611")
    admin_user = User.objects.create(username="hotel_admin_queue_admin", phone="+237699666612")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    _auth_client(owner).post("/api/hotels/", {
        "quarter": str(quarter.id), "room_types": [{"category": "STANDARD", "capacity": 2, "base_rate_xaf": "30000"}],
    }, format="json")

    admin_view = _auth_client(admin_user).get("/api/hotels/")
    stranger_view = APIClient().get("/api/hotels/")

    assert admin_view.data["count"] == 1
    assert stranger_view.data["count"] == 0
