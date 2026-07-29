"""
Automated tests for the reservation flow — the platform's highest-risk
piece of logic, so it gets the most thorough test coverage.

WHY these tests exist: a booking system that occasionally lets two people
book the same house, or occasionally loses track of a payment, would be a
serious real-world problem (a landlord double-booked, or a guest charged
with nothing to show for it). These tests exist to catch that kind of bug
automatically, every time the code changes, rather than relying on someone
noticing it by hand.
"""
import uuid
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.services import (
    reserve_booking, confirm_payment, complete_booking, InventoryConflictError,
)
from transactions.models import BookingType, BookingStatus, EscrowStatus


class FakeLock:
    """A stand-in for Redis during tests — real code should never touch a
    real Redis server just to run a test."""
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
def sample_listing(db):
    """Builds one house, in one quarter, with one published listing —
    the minimum real data every test in this file needs."""
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")

    landlord = User.objects.create(username="test_landlord", phone="+237699000001")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", bedrooms=3, bathrooms=2)
    listing = Listing.objects.create(
        property_asset=house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("150000"),
    )
    return listing


@pytest.mark.django_db
def test_reservation_creates_a_pending_hold(sample_listing):
    """A brand-new reservation should start life as PENDING, not
    already-confirmed — confirmation only happens after real payment."""
    guest = User.objects.create(username="test_guest", phone="+237699000002")
    lock = FakeLock()

    booking = reserve_booking(
        lock_client=lock, requester=guest, booking_type=BookingType.GENERAL_RENTAL,
        target_content_type="property.Listing", target_id=sample_listing.id,
        amount_xaf=sample_listing.price_xaf,
    )

    assert booking.status == BookingStatus.PENDING
    assert booking.requester == guest
    assert booking.hold_expires_at is not None


@pytest.mark.django_db
def test_two_people_cannot_book_the_same_house_at_once(sample_listing):
    """This is the single most important test in the whole platform: the
    exact scenario that would embarrass the business the most (two paying
    guests both told 'you got it', for the same physical house) must be
    mechanically impossible, not just unlikely."""
    guest_one = User.objects.create(username="guest_one", phone="+237699000003")
    guest_two = User.objects.create(username="guest_two", phone="+237699000004")
    lock = FakeLock()

    # First guest reserves successfully.
    reserve_booking(
        lock_client=lock, requester=guest_one, booking_type=BookingType.GENERAL_RENTAL,
        target_content_type="property.Listing", target_id=sample_listing.id,
        amount_xaf=sample_listing.price_xaf,
    )

    # Second guest tries the SAME listing before the first one's hold expires.
    with pytest.raises(InventoryConflictError):
        reserve_booking(
            lock_client=lock, requester=guest_two, booking_type=BookingType.GENERAL_RENTAL,
            target_content_type="property.Listing", target_id=sample_listing.id,
            amount_xaf=sample_listing.price_xaf,
        )


@pytest.mark.django_db
def test_successful_payment_confirms_booking_and_holds_escrow(sample_listing):
    """After a successful payment, the booking must be CONFIRMED and the
    money must sit in escrow — not immediately handed to the landlord.
    Money only actually moves once the tenancy is confirmed complete."""
    guest = User.objects.create(username="paying_guest", phone="+237699000005")
    lock = FakeLock()

    booking = reserve_booking(
        lock_client=lock, requester=guest, booking_type=BookingType.GENERAL_RENTAL,
        target_content_type="property.Listing", target_id=sample_listing.id,
        amount_xaf=sample_listing.price_xaf,
    )

    escrow = confirm_payment(
        lock_client=lock, booking=booking, provider="MTN_MOMO",
        provider_reference=f"TEST-{uuid.uuid4()}", platform_fee_xaf=Decimal("7500"),
    )

    booking.refresh_from_db()
    assert booking.status == BookingStatus.CONFIRMED
    assert escrow.status == EscrowStatus.HELD
    assert escrow.payee_amount_xaf == Decimal("142500")


@pytest.mark.django_db
def test_completing_a_booking_releases_the_escrow(sample_listing):
    """Only once the booking is marked complete (e.g. move-in confirmed)
    should the escrow actually release to the landlord."""
    guest = User.objects.create(username="completing_guest", phone="+237699000006")
    lock = FakeLock()

    booking = reserve_booking(
        lock_client=lock, requester=guest, booking_type=BookingType.GENERAL_RENTAL,
        target_content_type="property.Listing", target_id=sample_listing.id,
        amount_xaf=sample_listing.price_xaf,
    )
    confirm_payment(
        lock_client=lock, booking=booking, provider="ORANGE_MONEY",
        provider_reference=f"TEST-{uuid.uuid4()}", platform_fee_xaf=Decimal("7500"),
    )

    escrow = complete_booking(booking=booking)

    booking.refresh_from_db()
    assert booking.status == BookingStatus.COMPLETED
    assert escrow.status == EscrowStatus.RELEASED
    assert escrow.released_at is not None
