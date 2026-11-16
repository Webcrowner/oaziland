"""Room types: owners describe and price what students book; students see them with photos and free places,
and booking one is priced and capacity-checked on the server."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from marketplace.tests.test_marketplace_api import _verify
from student_hostels.models import HostelRoomType, RoomAllocation
from student_hostels.room_types import ROOM_TYPE_TARGET
from student_hostels.tests.test_hostel_rooms import board, client_for, hostel, make_user, owner, post, quarter  # noqa: F401
from transactions.models import Booking, BookingStatus
from transactions.services import confirm_payment, resolve_target_owner

SELF_CONTAIN = {
    "name": "Self-contain, private bathroom", "unit_type": "SELF_CONTAIN", "occupancy_model": "PER_UNIT",
    "price_xaf": "40000", "price_period": "MONTH", "size_sqm": "18", "private_bathroom": True, "furnished": True,
    "description": "Tiled, with a balcony.",
}


@pytest.fixture
def room_type(owner, hostel):
    """A self-contain room type with two rooms (A-1, A-2) and a photo."""
    assert post(owner, hostel, "details", {"name": "Résidence Les Palmiers"}).status_code == 200
    response = post(owner, hostel, "room-types", SELF_CONTAIN)
    assert response.status_code == 200, response.data
    room_type_id = response.data["room_types"][0]["id"]
    for code in ("A-1", "A-2"):
        assert post(owner, hostel, "rooms", {"room_code": code, "room_type": room_type_id}).status_code == 200
    assert post(owner, hostel, "room-type-photos", {"room_type": room_type_id, "url": "https://cdn.example.com/a.jpg"}).status_code == 200
    return HostelRoomType.objects.get(pk=room_type_id)


def student(name, phone):
    user = _verify(make_user(name, phone))
    client = APIClient()
    client.force_authenticate(user)
    return user, client


def book(client, room_type, **extra):
    return client.post("/api/bookings/", {
        "target_content_type": ROOM_TYPE_TARGET, "target_id": str(room_type.pk), "amount_xaf": "1", **extra,
    }, format="json")


@pytest.mark.django_db
def test_owner_sets_up_room_types_and_rooms_follow_them(owner, hostel, room_type):
    data = board(owner, hostel)
    assert data["hostel"]["name"] == "Résidence Les Palmiers"
    [row] = data["room_types"]
    assert (row["rooms"], row["total_places"], row["available_places"]) == (["A-1", "A-2"], 2, 2)
    assert row["photos"][0]["url"] == "https://cdn.example.com/a.jpg"
    assert {r["room_code"]: (r["unit_type"], r["room_type"]) for r in data["rooms"]} == {
        "A-1": ("SELF_CONTAIN", str(room_type.pk)), "A-2": ("SELF_CONTAIN", str(room_type.pk)),
    }

    bad = post(owner, hostel, "room-types", {**SELF_CONTAIN, "name": "Cheap", "price_xaf": "0"})
    assert bad.status_code == 400
    stranger = make_user("rt_stranger", "+237699930009")
    assert client_for(stranger).post(f"/api/hostel-rooms/{hostel.pk}/room-types/", SELF_CONTAIN, format="json").status_code == 404


@pytest.mark.django_db
def test_students_see_room_types_with_photos_price_and_free_places(hostel, room_type):
    data = APIClient().get(f"/api/student-hostels/{hostel.pk}/").data

    assert data["name"] == "Résidence Les Palmiers"
    [row] = data["room_types"]
    assert (row["name"], row["price_xaf"], row["price_period"], row["available_places"]) == (SELF_CONTAIN["name"], "40000.00", "MONTH", 2)
    assert row["photos"] == [{"id": room_type.photos.get().pk, "url": "https://cdn.example.com/a.jpg"}]
    assert data["from_price"] == {"price_xaf": "40000.00", "price_period": "MONTH"}

    post(hostel.owner, hostel, "room-type-visibility", {"room_type": str(room_type.pk), "is_active": False})
    assert APIClient().get(f"/api/student-hostels/{hostel.pk}/").data["room_types"] == []


@pytest.mark.django_db
def test_booking_a_room_type_charges_its_price_times_periods_never_the_sent_amount(room_type):
    _, client = student("rt_student", "+237699930001")

    response = book(client, room_type, quantity=3)

    assert response.status_code == 201, response.data
    assert Decimal(response.data["amount_xaf"]) == Decimal("120000")
    assert response.data["booking_type"] == "HOSTEL_SEMESTER"
    assert book(client, room_type, quantity=13).status_code == 400  # a monthly price allows up to 12 months at once


@pytest.mark.django_db
def test_a_room_type_is_never_booked_beyond_its_free_places(room_type):
    for n in range(2):
        _, client = student(f"rt_s{n}", f"+23769993010{n}")
        assert book(client, room_type).status_code == 201
    _, late = student("rt_late", "+237699930109")

    assert book(late, room_type).status_code == 409

    # A hold that ran out without payment frees its place again.
    Booking.objects.filter(target_id=room_type.pk).update(hold_expires_at=timezone.now() - timedelta(seconds=1))
    assert book(late, room_type).status_code == 201


@pytest.mark.django_db
def test_a_paid_room_type_booking_keeps_its_place_and_pays_the_hostel_owner(room_type):
    user, client = student("rt_payer", "+237699930201")
    booking = Booking.objects.get(pk=book(client, room_type).data["id"])

    confirm_payment(lock_client=_NoLock(), booking=booking, provider="MTN_MOMO", provider_reference="rt-ref-1")

    booking.refresh_from_db()
    assert booking.status == BookingStatus.CONFIRMED
    assert resolve_target_owner(booking) == room_type.hostel.owner
    assert APIClient().get(f"/api/student-hostels/{room_type.hostel.pk}/").data["room_types"][0]["available_places"] == 1


@pytest.mark.django_db
def test_owners_cannot_book_their_own_rooms_and_unknown_room_types_are_refused(owner, room_type):
    _verify(owner)
    mine = APIClient()
    mine.force_authenticate(owner)
    assert book(mine, room_type).status_code == 400

    _, client = student("rt_other", "+237699930301")
    missing = client.post("/api/bookings/", {"target_content_type": ROOM_TYPE_TARGET, "target_id": "not-a-uuid"}, format="json")
    assert missing.status_code == 400
    assert not RoomAllocation.objects.exists()


class _NoLock:
    def release_owned(self, key, owner_token):
        pass
