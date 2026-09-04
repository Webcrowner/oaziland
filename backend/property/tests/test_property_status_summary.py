"""
Tests proving get_property_status_summary correctly distinguishes
available, mid-reservation, currently taken, and scheduled-for-the-
future — not just a bare published/unpublished flag.
"""
import pytest
from decimal import Decimal
from datetime import date, timedelta

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from property.services import get_property_status_summary
from property_management.models import Lease
from transactions.models import Booking, BookingType, BookingStatus


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def landlord(db):
    return User.objects.create(username="status_landlord", phone="+237699960001")


@pytest.mark.django_db
def test_property_with_no_bookings_is_available(quarter, landlord):
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    summary = get_property_status_summary(house)
    assert summary["status"] == "AVAILABLE"


@pytest.mark.django_db
def test_property_with_pending_reservation_shows_in_progress(quarter, landlord):
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    guest = User.objects.create(username="status_guest_1", phone="+237699960002")
    Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.PENDING, amount_xaf=Decimal("100000"), idempotency_key="status-test-1",
    )

    summary = get_property_status_summary(house)
    assert summary["status"] == "RESERVATION_IN_PROGRESS"


@pytest.mark.django_db
def test_property_with_active_lease_shows_taken(quarter, landlord):
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    guest = User.objects.create(username="status_guest_2", phone="+237699960003")
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("100000"), idempotency_key="status-test-2",
    )
    Lease.objects.create(booking=booking, start_date=date.today() - timedelta(days=10), end_date=date.today() + timedelta(days=80))

    summary = get_property_status_summary(house)
    assert summary["status"] == "TAKEN"
    assert "lease_end_date" in summary["detail"]


@pytest.mark.django_db
def test_property_with_future_lease_shows_scheduled(quarter, landlord):
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    guest = User.objects.create(username="status_guest_3", phone="+237699960004")
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("100000"), idempotency_key="status-test-3",
    )
    future_start = date.today() + timedelta(days=30)
    Lease.objects.create(booking=booking, start_date=future_start, end_date=future_start + timedelta(days=90))

    summary = get_property_status_summary(house)
    assert summary["status"] == "SCHEDULED"
    assert summary["detail"]["scheduled_from"] == future_start


@pytest.mark.django_db
def test_confirmed_booking_with_no_lease_yet_defaults_to_taken(quarter, landlord):
    """A confirmed sale, or a rental awaiting its formal lease record —
    must not be misreported as AVAILABLE just because no Lease exists yet."""
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.SALE, status=ListingStatus.PUBLISHED, price_xaf=Decimal("50000000"))
    buyer = User.objects.create(username="status_buyer", phone="+237699960005")
    Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=buyer, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("50000000"), idempotency_key="status-test-4",
    )

    summary = get_property_status_summary(house)
    assert summary["status"] == "TAKEN"
