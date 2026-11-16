"""Hotel room types as guests book them: owner set-up with real rooms, per-night availability, server pricing,
and the payment hold."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from hotels.models import Hotel, Reservation, ReservationStatus, Room, RoomType as RoomTypeModel
from hotels.room_types import RoomTypeError, save_room_type, set_room_count
from identity.models import User, KYCProfile, VerificationStatus, MfaMethod


def _client(user=None):
    client = APIClient()
    if user is not None:
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _guest(name):
    user = User.objects.create(username=name, phone=f"+2376{abs(hash(name)) % 10**8:08d}")
    KYCProfile.objects.create(user=user, legal_full_name=name, date_of_birth="1990-01-01", national_id_number=f"CM-{name}", residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED)
    MfaMethod.objects.create(user=user, mfa_type="SMS_OTP", destination=user.phone, verified=True)
    return user


@pytest.fixture
def hotel(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")
    owner = User.objects.create(username="rt_hotel_owner", phone="+237699777001")
    return Hotel.objects.create(owner=owner, quarter=quarter, type="HOTEL", name="Hôtel Bastos", verified=True)


@pytest.fixture
def deluxe(hotel):
    return save_room_type(hotel, {"name": "Deluxe double", "category": "DELUXE", "capacity": 2, "base_rate_xaf": "40000", "room_count": 1})


def _stay(days_ahead=10, nights=2):
    check_in = timezone.localdate() + timedelta(days=days_ahead)
    return check_in, check_in + timedelta(days=nights)


def _book(guest, room_type, check_in, check_out, **extra):
    return _client(guest).post("/api/reservations/", {
        "room_type": str(room_type.id), "check_in": check_in.isoformat(), "check_out": check_out.isoformat(), **extra,
    }, format="json")


@pytest.mark.django_db
def test_owner_sets_up_a_room_type_with_its_rooms_and_others_cannot(hotel):
    response = _client(hotel.owner).post(f"/api/hotels/{hotel.id}/room-types/", {
        "name": "Executive suite", "category": "SUITE", "capacity": 3, "base_rate_xaf": "85000",
        "bed_setup": "1 king bed + sofa bed", "size_sqm": "42", "room_count": 3, "amenities": ["Balcony", "Minibar"],
    }, format="json")
    assert response.status_code == 200
    suite = next(r for r in response.data["room_types"] if r["name"] == "Executive suite")
    assert suite["room_count"] == 3 and suite["is_active"] is True
    assert sorted(Room.objects.filter(room_type_id=suite["id"]).values_list("room_number", flat=True)) == ["101", "102", "103"]

    stranger = User.objects.create(username="rt_stranger", phone="+237699777002")
    denied = _client(stranger).post(f"/api/hotels/{hotel.id}/room-types/", {"name": "Fake", "capacity": 1, "base_rate_xaf": "1"}, format="json")
    assert denied.status_code == 403


@pytest.mark.django_db
def test_guests_only_see_room_types_on_offer_and_the_from_price(hotel, deluxe):
    save_room_type(hotel, {"name": "Standard single", "capacity": 1, "base_rate_xaf": "25000", "room_count": 2})
    hidden = save_room_type(hotel, {"name": "Presidential", "capacity": 4, "base_rate_xaf": "15000", "room_count": 1})
    hidden.is_active = False
    hidden.save()

    data = _client().get(f"/api/hotels/{hotel.id}/").data
    assert [r["name"] for r in data["room_types"]] == ["Standard single", "Deluxe double"]
    assert Decimal(data["from_price_xaf"]) == Decimal("25000")
    assert "is_active" not in data["room_types"][0]

    owner_view = _client(hotel.owner).get(f"/api/hotels/{hotel.id}/").data
    assert len(owner_view["room_types"]) == 3


@pytest.mark.django_db
def test_last_room_cannot_be_sold_twice_for_overlapping_nights(hotel, deluxe):
    check_in, check_out = _stay()
    first = _book(_guest("rt_guest_a"), deluxe, check_in, check_out)
    assert first.status_code == 201
    assert Decimal(first.data["rate_xaf"]) > 0

    overlapping = _book(_guest("rt_guest_b"), deluxe, check_in + timedelta(days=1), check_out + timedelta(days=1))
    assert overlapping.status_code == 409

    after = _book(_guest("rt_guest_c"), deluxe, check_out, check_out + timedelta(days=1))
    assert after.status_code == 201

    options = _client().get(f"/api/hotels/{hotel.id}/availability/", {"check_in": check_in.isoformat(), "check_out": check_out.isoformat()}).data
    assert options["room_types"][0]["rooms_free"] == 0


@pytest.mark.django_db
def test_an_unpaid_hold_lapses_and_paying_late_rechecks_the_room(hotel, deluxe):
    check_in, check_out = _stay()
    late_payer = _guest("rt_late_payer")
    held = _book(late_payer, deluxe, check_in, check_out)
    Reservation.objects.filter(pk=held.data["id"]).update(created_at=timezone.now() - timedelta(minutes=30))

    taken = _book(_guest("rt_quick_payer"), deluxe, check_in, check_out)
    assert taken.status_code == 201
    Reservation.objects.filter(pk=taken.data["id"]).update(status=ReservationStatus.CONFIRMED)

    paid_late = _client(late_payer).post(f"/api/reservations/{held.data['id']}/pay/", {"phone_number": "+237699777099"}, format="json")
    assert paid_late.status_code == 409
    assert Reservation.objects.get(pk=held.data["id"]).status == ReservationStatus.PENDING_PAYMENT


@pytest.mark.django_db
def test_reservation_refuses_bad_requests(hotel, deluxe):
    guest = _guest("rt_guest_bad")
    check_in, check_out = _stay()
    assert _book(guest, deluxe, check_in, check_out, adults=3).status_code == 400
    past = timezone.localdate() - timedelta(days=2)
    assert _book(guest, deluxe, past, past + timedelta(days=1)).status_code == 400
    assert _book(guest, deluxe, check_in, check_in).status_code == 400

    deluxe.is_active = False
    deluxe.save()
    assert _book(guest, deluxe, check_in, check_out).status_code == 409

    deluxe.is_active = True
    deluxe.save()
    reservation = _book(guest, deluxe, check_in, check_out).data
    assert _client(guest).patch(f"/api/reservations/{reservation['id']}/", {"check_out": (check_out + timedelta(days=9)).isoformat()}, format="json").status_code == 405


@pytest.mark.django_db
def test_room_count_cannot_drop_below_rooms_already_booked(hotel):
    room_type = save_room_type(hotel, {"name": "Twin", "capacity": 2, "base_rate_xaf": "30000", "room_count": 2})
    guest = User.objects.create(username="rt_booked_guest", phone="+237699777010")
    check_in, check_out = _stay()
    for _ in range(2):
        Reservation.objects.create(hotel=hotel, guest=guest, room_type=room_type, check_in=check_in, check_out=check_out, rate_xaf=1, status=ReservationStatus.CONFIRMED)
    with pytest.raises(RoomTypeError):
        set_room_count(room_type, 1)
    set_room_count(room_type, 4)
    assert room_type.rooms.count() == 4


@pytest.fixture
def guest_house(hotel):
    from property.models import GuestHouseLodge
    owner = User.objects.create(username="rt_gh_owner", phone="+237699777020")
    return GuestHouseLodge.objects.create(owner=owner, quarter=hotel.quarter, type="HOUSE", name="Auberge Bastos")


@pytest.mark.django_db
def test_guest_house_rooms_are_set_up_booked_and_paid_to_its_owner(guest_house):
    from transactions.models import Booking
    from transactions.services import resolve_target_owner

    setup = _client(guest_house.owner).post(f"/api/guest-houses/{guest_house.id}/room-types/", {
        "name": "Chambre jardin", "category": "STANDARD", "capacity": 2, "base_rate_xaf": "20000", "room_count": 1,
    }, format="json")
    assert setup.status_code == 200
    room_type_id = setup.data["room_types"][0]["id"]
    public = _client().get(f"/api/guest-houses/{guest_house.id}/").data
    assert public["name"] == "Auberge Bastos" and Decimal(public["from_price_xaf"]) == Decimal("20000")

    guest = _guest("rt_gh_guest")
    check_in, check_out = _stay()
    booked = _client(guest).post("/api/reservations/", {
        "room_type": room_type_id, "check_in": check_in.isoformat(), "check_out": check_out.isoformat(),
    }, format="json")
    assert booked.status_code == 201
    reservation = Reservation.objects.get(pk=booked.data["id"])
    assert reservation.guest_house_id == guest_house.id and reservation.hotel_id is None

    paid = _client(guest).post(f"/api/reservations/{reservation.id}/pay/", {"phone_number": "+237699777098"}, format="json")
    assert paid.status_code == 200
    booking = Booking.objects.get(target_content_type="hotels.Reservation", target_id=reservation.id)
    assert resolve_target_owner(booking) == guest_house.owner

    again = _client(_guest("rt_gh_guest_2")).post("/api/reservations/", {
        "room_type": room_type_id, "check_in": check_in.isoformat(), "check_out": check_out.isoformat(),
    }, format="json")
    assert again.status_code == 409


@pytest.mark.django_db
def test_a_night_blocked_by_another_channel_closes_the_guest_house(guest_house):
    from guest_houses.models import ChannelBlockedDate
    room_type = save_room_type(guest_house, {"name": "Chambre mer", "capacity": 2, "base_rate_xaf": "30000", "room_count": 3})
    check_in, check_out = _stay()
    ChannelBlockedDate.objects.create(guest_house=guest_house, date=check_in + timedelta(days=1), source_channel="AIRBNB")
    assert _book(_guest("rt_gh_blocked"), room_type, check_in, check_out).status_code == 409


@pytest.mark.django_db
def test_strangers_cannot_edit_or_delete_a_guest_house(guest_house):
    stranger = User.objects.create(username="rt_gh_stranger", phone="+237699777021")
    client = _client(stranger)
    assert client.patch(f"/api/guest-houses/{guest_house.id}/", {"description": "mine now"}, format="json").status_code == 405
    assert client.delete(f"/api/guest-houses/{guest_house.id}/").status_code == 405
    assert client.post(f"/api/guest-houses/{guest_house.id}/room-types/", {"name": "x", "capacity": 1, "base_rate_xaf": "1"}, format="json").status_code == 403


@pytest.mark.django_db
def test_owners_get_all_their_places_past_the_first_page(hotel, guest_house):
    from property.models import GuestHouseLodge
    owner = hotel.owner
    for n in range(24):
        Hotel.objects.create(owner=owner, quarter=hotel.quarter, type="HOTEL", name=f"Annexe {n}", verified=n % 2 == 0)
    GuestHouseLodge.objects.create(owner=owner, quarter=hotel.quarter, type="HOUSE", name="Owner's auberge")

    mine = _client(owner).get("/api/hotels/", {"mine": "1"}).data
    assert len(mine) == 25 and all(h["owner"] == owner.id for h in mine)
    houses = _client(owner).get("/api/guest-houses/", {"mine": "1"}).data
    assert [h["name"] for h in houses] == ["Owner's auberge"]
    assert _client().get("/api/hotels/", {"mine": "1"}).data == []


@pytest.mark.django_db
def test_hotels_listed_before_rooms_were_tracked_get_rooms_and_stay_bookable(hotel):
    import importlib
    from django.apps import apps
    migration = importlib.import_module("hotels.migrations.0008_rooms_for_existing_room_types")
    legacy = RoomTypeModel.objects.create(hotel=hotel, category="STANDARD", capacity=2, base_rate_xaf=Decimal("30000"))
    already_set_up = save_room_type(hotel, {"name": "Twin", "capacity": 2, "base_rate_xaf": "40000", "room_count": 3})
    assert legacy.rooms.count() == 0

    migration.give_existing_room_types_rooms(apps, None)
    assert legacy.rooms.count() == 1
    assert already_set_up.rooms.count() == 3  # untouched
    check_in, check_out = _stay()
    assert _book(_guest("legacy_guest"), legacy, check_in, check_out).status_code == 201
