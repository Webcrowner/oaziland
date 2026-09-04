"""
Tests for reservations, check-in room-status enforcement, folio
charges, checkout, and group bookings.
"""
import pytest
from decimal import Decimal
from datetime import date

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from hotels.models import Hotel, RoomType, RoomCategory, Room, RoomStatus, FolioChargeType
from hotels.services import (
    create_reservation, check_in_guest, checkout_guest, post_folio_charge,
    run_end_of_day_room_charge_posting, create_group_booking, add_reservation_to_group,
    NoAvailableRoomError,
)


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def hotel(db, quarter):
    owner = User.objects.create(username="checkin_hotel_owner", phone="+237699222002")
    return Hotel.objects.create(owner=owner, quarter=quarter, type="HOUSE")


@pytest.fixture
def room_type(hotel):
    return RoomType.objects.create(hotel=hotel, category=RoomCategory.STANDARD, capacity=2, base_rate_xaf=Decimal("50000"))


@pytest.mark.django_db
def test_check_in_requires_an_inspected_room(hotel, room_type):
    """The spec's literal rule: a room must be Clean AND Inspected
    before assignment — every other status must be rejected."""
    guest = User.objects.create(username="checkin_guest_1", phone="+237699222003")
    front_desk = User.objects.create(username="front_desk_agent", phone="+237699222004")

    dirty_room = Room.objects.create(hotel=hotel, room_type=room_type, room_number="101", status=RoomStatus.DIRTY)
    reservation = create_reservation(hotel=hotel, guest=guest, room_type=room_type, check_in=date(2026, 6, 1), check_out=date(2026, 6, 3))

    with pytest.raises(NoAvailableRoomError):
        check_in_guest(reservation=reservation, assigned_by=front_desk)

    dirty_room.status = RoomStatus.INSPECTED
    dirty_room.save()

    folio = check_in_guest(reservation=reservation, assigned_by=front_desk)
    reservation.refresh_from_db()
    dirty_room.refresh_from_db()
    assert reservation.status == "CHECKED_IN"
    assert dirty_room.status == RoomStatus.OCCUPIED
    assert folio.status == "OPEN"


@pytest.mark.django_db
def test_end_of_day_posting_and_checkout_flow(hotel, room_type):
    guest = User.objects.create(username="checkin_guest_2", phone="+237699222005")
    front_desk = User.objects.create(username="front_desk_agent_2", phone="+237699222006")
    Room.objects.create(hotel=hotel, room_type=room_type, room_number="102", status=RoomStatus.INSPECTED)

    reservation = create_reservation(hotel=hotel, guest=guest, room_type=room_type, check_in=date(2026, 6, 1), check_out=date(2026, 6, 3))
    folio = check_in_guest(reservation=reservation, assigned_by=front_desk)

    # F&B charge posted mid-stay.
    post_folio_charge(folio=folio, charge_type=FolioChargeType.FNB, description="Dinner at hotel restaurant", amount_xaf=Decimal("8000"))

    # End-of-day room charge posting.
    posted = run_end_of_day_room_charge_posting(hotel, night_date=date(2026, 6, 1))
    assert len(posted) == 1

    folio.refresh_from_db()
    assert folio.balance_xaf > Decimal("0")  # real charges accumulated

    balance = checkout_guest(reservation)
    reservation.refresh_from_db()
    room = reservation.room_assignment.room
    room.refresh_from_db()

    assert reservation.status == "CHECKED_OUT"
    assert room.status == RoomStatus.DIRTY  # correctly triggers the housekeeping cycle
    assert balance == folio.balance_xaf


@pytest.mark.django_db
def test_adjustment_charge_requires_a_reason_code(hotel, room_type):
    guest = User.objects.create(username="checkin_guest_3", phone="+237699222007")
    front_desk = User.objects.create(username="front_desk_agent_3", phone="+237699222008")
    Room.objects.create(hotel=hotel, room_type=room_type, room_number="103", status=RoomStatus.INSPECTED)
    reservation = create_reservation(hotel=hotel, guest=guest, room_type=room_type, check_in=date(2026, 6, 1), check_out=date(2026, 6, 2))
    folio = check_in_guest(reservation=reservation, assigned_by=front_desk)

    with pytest.raises(ValueError):
        post_folio_charge(folio=folio, charge_type=FolioChargeType.ADJUSTMENT, description="Complimentary breakfast", amount_xaf=Decimal("-3000"))

    # Succeeds once a reason is given — the audit-trail requirement from the spec.
    charge = post_folio_charge(folio=folio, charge_type=FolioChargeType.ADJUSTMENT, description="Complimentary breakfast", amount_xaf=Decimal("-3000"), reason_code="Manager goodwill gesture", posted_by=front_desk)
    assert charge.reason_code == "Manager goodwill gesture"


@pytest.mark.django_db
def test_group_booking_links_individual_reservations(hotel, room_type):
    """The spec's B.5.1 flow: a master group booking with individual
    reservations from a rooming list, all linked back to it."""
    guest_a = User.objects.create(username="group_guest_a", phone="+237699222009")
    guest_b = User.objects.create(username="group_guest_b", phone="+237699222010")

    group = create_group_booking(hotel=hotel, group_name="ICT University Alumni Conference", arrival=date(2026, 9, 1), departure=date(2026, 9, 3), event_type="Conference")
    reservation_a = add_reservation_to_group(group_booking=group, guest=guest_a, room_type=room_type)
    reservation_b = add_reservation_to_group(group_booking=group, guest=guest_b, room_type=room_type)

    assert group.total_rooms == 2
    assert reservation_a.group_booking == group
    assert reservation_b.group_booking == group
    assert reservation_a.check_in == group.arrival
    assert reservation_a.check_out == group.departure
