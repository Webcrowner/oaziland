"""
Tests for the availability engine (the actual real-time conflict
detection with buffer time, recurring blocks, and manual overrides),
the booking/quote/deposit flow, balance-due reminders, and guest QR
check-in.
"""
import pytest
from decimal import Decimal
from datetime import date, time

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from events.models import Venue, VenueSpace, EventType, EventBookingStatus, RecurringBlock, ManualUnavailability, Caterer
from events.services import (
    is_venue_space_available, create_event_booking, confirm_event_booking_deposit,
    send_due_balance_reminders, add_guest_to_list, check_in_guest_by_qr_token,
    book_caterer, compute_event_quote, VenueUnavailableError,
)
from payments.gateways import SandboxGateway
from monetization.models import PlatformFeePolicy, TransactionCategory
from notifications.models import Notification


class FakeLock:
    def __init__(self):
        self.locked = set()

    def acquire(self, key, ttl_seconds):
        if key in self.locked:
            return False
        self.locked.add(key)
        return True

    def release(self, key, permanent=False):
        self.locked.discard(key)


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Messassi District")
    return Quarter.objects.create(village_or_district=village, name="Messassi")


@pytest.fixture
def venue_space(db, quarter):
    owner = User.objects.create(username="venue_owner", phone="+237699333001")
    venue = Venue.objects.create(owner=owner, quarter=quarter, type="EVENT_CENTER" if False else "HOUSE")
    return VenueSpace.objects.create(venue=venue, space_name="Main Conference Hall", base_price_per_hour_xaf=Decimal("50000"), setup_buffer_hours=1)


@pytest.mark.django_db
def test_availability_allows_a_clear_slot(venue_space):
    assert is_venue_space_available(venue_space=venue_space, event_date=date(2026, 9, 1), start_time=time(9, 0), end_time=time(12, 0)) is True


@pytest.mark.django_db
def test_booking_conflict_correctly_detected_including_buffer_time(venue_space):
    """The literal spec requirement: buffer time before/after a
    confirmed booking must also block overlapping requests, not just
    the exact booked hours."""
    organiser = User.objects.create(username="conflict_organiser", phone="+237699333002")
    PlatformFeePolicy.objects.get_or_create(category=TransactionCategory.PROPERTY_BOOKING, defaults={"fee_percent": Decimal("5.0")})

    booking = create_event_booking(
        organiser=organiser, venue_space=venue_space, event_type=EventType.CONFERENCE,
        event_date=date(2026, 9, 1), start_time=time(9, 0), end_time=time(12, 0), guest_count=50,
    )
    lock, gateway = FakeLock(), SandboxGateway()
    confirm_event_booking_deposit(event_booking=booking, lock_client=lock, payment_gateway=gateway, phone_number="+237670002001")

    # 12:30-14:00 is AFTER the booked slot but within the 1-hour buffer — must be rejected.
    assert is_venue_space_available(venue_space=venue_space, event_date=date(2026, 9, 1), start_time=time(12, 30), end_time=time(14, 0)) is False
    # 14:00 onward is clear of the buffer entirely.
    assert is_venue_space_available(venue_space=venue_space, event_date=date(2026, 9, 1), start_time=time(14, 0), end_time=time(16, 0)) is True

    with pytest.raises(VenueUnavailableError):
        create_event_booking(
            organiser=organiser, venue_space=venue_space, event_type=EventType.BIRTHDAY_PARTY,
            event_date=date(2026, 9, 1), start_time=time(12, 30), end_time=time(14, 0), guest_count=20,
        )


@pytest.mark.django_db
def test_recurring_block_and_manual_unavailability_both_respected(venue_space):
    # A weekly Sunday church service, 8am-11am.
    RecurringBlock.objects.create(venue_space=venue_space, label="Sunday Service", day_of_week=6, start_time=time(8, 0), end_time=time(11, 0))
    sunday = date(2026, 9, 6)  # a real Sunday
    assert is_venue_space_available(venue_space=venue_space, event_date=sunday, start_time=time(9, 0), end_time=time(10, 0)) is False
    assert is_venue_space_available(venue_space=venue_space, event_date=sunday, start_time=time(13, 0), end_time=time(15, 0)) is True

    # A manager's manual override, no reason required.
    ManualUnavailability.objects.create(venue_space=venue_space, date=date(2026, 9, 10))
    assert is_venue_space_available(venue_space=venue_space, event_date=date(2026, 9, 10), start_time=time(9, 0), end_time=time(10, 0)) is False


@pytest.mark.django_db
def test_package_tier_and_deposit_balance_computed_correctly(venue_space):
    organiser = User.objects.create(username="package_organiser", phone="+237699333003")
    booking = create_event_booking(
        organiser=organiser, venue_space=venue_space, event_type=EventType.CORPORATE_MEETING,
        event_date=date(2026, 9, 15), start_time=time(9, 0), end_time=time(11, 0), guest_count=15,  # 2 hours
    )
    assert booking.package_tier == "HOURLY_MEETING"
    assert booking.total_cost_xaf == Decimal("100000")  # 2 hours * 50,000
    assert booking.deposit_amount_xaf == Decimal("30000")  # 30% default
    assert booking.balance_amount_xaf == Decimal("70000")


@pytest.mark.django_db
def test_balance_due_reminders_fire_on_the_exact_schedule(venue_space):
    organiser = User.objects.create(username="reminder_organiser", phone="+237699333004")
    PlatformFeePolicy.objects.get_or_create(category=TransactionCategory.PROPERTY_BOOKING, defaults={"fee_percent": Decimal("5.0")})
    from django.utils import timezone
    from datetime import timedelta

    today = timezone.now().date()
    event_date = today + timedelta(days=7)  # exactly 7 days out — one of the 3 milestones
    booking = create_event_booking(
        organiser=organiser, venue_space=venue_space, event_type=EventType.WEDDING,
        event_date=event_date, start_time=time(10, 0), end_time=time(20, 0), guest_count=200,
    )
    lock, gateway = FakeLock(), SandboxGateway()
    confirm_event_booking_deposit(event_booking=booking, lock_client=lock, payment_gateway=gateway, phone_number="+237670002002")

    sent = send_due_balance_reminders(today=today)
    assert len(sent) == 1
    assert "7" in sent[0].title

    # Running it again the same day must not duplicate.
    sent_again = send_due_balance_reminders(today=today)
    assert len(sent_again) == 0


@pytest.mark.django_db
def test_guest_qr_check_in_flow(venue_space):
    organiser = User.objects.create(username="guest_list_organiser", phone="+237699333005")
    booking = create_event_booking(
        organiser=organiser, venue_space=venue_space, event_type=EventType.GRADUATION,
        event_date=date(2026, 10, 1), start_time=time(9, 0), end_time=time(13, 0), guest_count=100,
    )
    guest = add_guest_to_list(event_booking=booking, guest_name="Jane Doe", phone="+237670003001")
    assert guest.checked_in_at is None

    checked_in_guest = check_in_guest_by_qr_token(guest.qr_token)
    assert checked_in_guest.checked_in_at is not None

    with pytest.raises(ValueError):
        check_in_guest_by_qr_token(guest.qr_token)  # already used — must be rejected

    with pytest.raises(ValueError):
        check_in_guest_by_qr_token("a-token-that-does-not-exist")


@pytest.mark.django_db
def test_catering_booking_computed_from_caterer_price_range(venue_space):
    organiser = User.objects.create(username="catering_organiser", phone="+237699333006")
    booking = create_event_booking(
        organiser=organiser, venue_space=venue_space, event_type=EventType.WEDDING,
        event_date=date(2026, 10, 5), start_time=time(10, 0), end_time=time(18, 0), guest_count=150,
    )
    caterer = Caterer.objects.create(name="Chez Marie Catering", cuisine_type="Cameroonian", price_per_head_min_xaf=Decimal("5000"), price_per_head_max_xaf=Decimal("7000"))

    catering_booking = book_caterer(event_booking=booking, caterer=caterer, menu_selections={"starter": "Salad", "main": "Ndolé"}, guest_count=150)
    assert catering_booking.total_cost_xaf == Decimal("900000")  # midpoint 6000 * 150 guests


@pytest.mark.django_db
def test_caterer_rating_is_computed_not_stored(venue_space):
    from events.models import CatererReview
    caterer = Caterer.objects.create(name="Test Caterer", price_per_head_min_xaf=Decimal("3000"), price_per_head_max_xaf=Decimal("5000"))
    organiser_a = User.objects.create(username="rating_organiser_a", phone="+237699333007")
    organiser_b = User.objects.create(username="rating_organiser_b", phone="+237699333008")

    assert caterer.rating is None  # no reviews yet
    CatererReview.objects.create(caterer=caterer, organiser=organiser_a, score=4)
    CatererReview.objects.create(caterer=caterer, organiser=organiser_b, score=5)
    assert caterer.rating == 4.5
