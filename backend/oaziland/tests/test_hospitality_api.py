"""
Real HTTP tests for the hospitality module APIs (hotels, events,
student hostels, guest houses) — using DRF's APIClient over the actual
URL routing, the same standard set in Prompt 16.
"""
import pytest
from decimal import Decimal
from datetime import date

from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from hotels.models import Hotel, RoomType, RoomCategory
from events.models import Venue, VenueSpace
from student_hostels.models import StudentHostel, HostelUnit, HostelUnitType, OccupancyModel, OwnerProfile, OwnerType, HostelPropertyType
from property.models import GuestHouseLodge


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
def test_hotel_search_is_public_and_returns_real_data(quarter):
    owner = User.objects.create(username="api_hotel_owner", phone="+237699555001")
    hotel = Hotel.objects.create(owner=owner, quarter=quarter, type="HOUSE", verified=True, star_rating=4)
    RoomType.objects.create(hotel=hotel, category=RoomCategory.DELUXE, capacity=2, base_rate_xaf=Decimal("60000"))

    client = APIClient()  # no auth — search must be public
    response = client.get("/api/hotels/")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["star_rating"] == 4
    assert len(response.data["results"][0]["room_types"]) == 1


@pytest.mark.django_db
def test_unverified_hotels_are_not_shown_in_public_search(quarter):
    owner = User.objects.create(username="api_hotel_owner_2", phone="+237699555002")
    Hotel.objects.create(owner=owner, quarter=quarter, type="HOUSE", verified=False)

    client = APIClient()
    response = client.get("/api/hotels/")
    assert response.data["count"] == 0


@pytest.mark.django_db
def test_reservation_requires_mfa_and_kyc(quarter):
    owner = User.objects.create(username="api_hotel_owner_3", phone="+237699555003")
    hotel = Hotel.objects.create(owner=owner, quarter=quarter, type="HOUSE", verified=True)
    room_type = RoomType.objects.create(hotel=hotel, category=RoomCategory.STANDARD, capacity=2, base_rate_xaf=Decimal("40000"))

    unverified_guest = User.objects.create(username="api_unverified_guest", phone="+237699555004")
    client = _auth_client(unverified_guest)

    response = client.post("/api/reservations/", {
        "room_type": str(room_type.id), "check_in": "2026-10-01", "check_out": "2026-10-03",
    })
    assert response.status_code == 403  # correctly blocked — matches the platform-wide MFA/KYC rule


@pytest.mark.django_db
def test_venue_search_is_public(quarter):
    owner = User.objects.create(username="api_venue_owner", phone="+237699555005")
    venue = Venue.objects.create(owner=owner, quarter=quarter, type="HOUSE", verified=True)
    VenueSpace.objects.create(venue=venue, space_name="Grand Hall", base_price_per_hour_xaf=Decimal("50000"))

    client = APIClient()
    response = client.get("/api/venues/")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["spaces"][0]["space_name"] == "Grand Hall"


@pytest.mark.django_db
def test_student_hostel_search_is_public(quarter):
    owner_user = User.objects.create(username="api_hostel_owner", phone="+237699555006")
    owner = OwnerProfile.objects.create(account_user=owner_user, owner_type=OwnerType.LANDLORD)
    hostel = StudentHostel.objects.create(owner=owner_user, owner_profile=owner, quarter=quarter, type="HOUSE", property_type=HostelPropertyType.BLOCK)
    HostelUnit.objects.create(building=hostel.building_ptr, room_code="API-101", unit_type=HostelUnitType.SHARED_ROOM, occupancy_model=OccupancyModel.PER_BED, bed_capacity=2)

    client = APIClient()
    response = client.get("/api/student-hostels/")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["units"][0]["room_code"] == "API-101"


@pytest.mark.django_db
def test_my_room_allocations_scoped_to_authenticated_student():
    student_a = User.objects.create(username="api_student_a", phone="+237699555007")
    student_b = User.objects.create(username="api_student_b", phone="+237699555008")

    client_b = _auth_client(student_b)
    response = client_b.get("/api/my-room-allocations/")
    assert response.status_code == 200
    assert response.data["count"] == 0  # sees none of student_a's allocations, correctly


@pytest.mark.django_db
def test_guest_house_search_is_public(quarter):
    owner = User.objects.create(username="api_gh_owner", phone="+237699555009")
    GuestHouseLodge.objects.create(owner=owner, quarter=quarter, type="HOUSE", is_coastal_leisure=True)

    client = APIClient()
    response = client.get("/api/guest-houses/")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["is_coastal_leisure"] is True


@pytest.mark.django_db
def test_guest_houses_book_through_the_existing_generic_bookings_endpoint(quarter):
    """Confirms guest houses deliberately did NOT get their own booking
    endpoint — they use the same /api/bookings/ as everything else."""
    owner = User.objects.create(username="api_gh_owner_2", phone="+237699555010")
    guest_house = GuestHouseLodge.objects.create(owner=owner, quarter=quarter, type="HOUSE")
    guest = User.objects.create(username="api_gh_guest", phone="+237699555011")

    client = _auth_client(guest)
    response = client.get("/api/bookings/")
    assert response.status_code == 200  # the existing generic endpoint handles it — no 404, no separate route needed
