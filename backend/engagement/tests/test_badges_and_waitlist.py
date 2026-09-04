"""Tests for gamified badges and the platform-wide listing waitlist."""
import pytest
from decimal import Decimal
from datetime import date

from identity.models import User, KYCProfile, VerificationStatus
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.models import Booking, BookingType, BookingStatus
from social.models import Review
from engagement.models import BadgeCode
from engagement.services import evaluate_badges_for_user
from discovery.models import ListingWaitlistEntry
from discovery.services import join_listing_waitlist, notify_waitlist_on_availability
from notifications.models import Notification


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_verified_renter_badge_awarded_correctly():
    user = User.objects.create(username="badge_verified_user", phone="+237699994001")
    unverified_user = User.objects.create(username="badge_unverified_user", phone="+237699994002")

    KYCProfile.objects.create(user=user, legal_full_name="Test User", date_of_birth="1990-01-01", national_id_number="CM-BADGE-001", residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED)
    KYCProfile.objects.create(user=unverified_user, legal_full_name="Unverified User", date_of_birth="1990-01-01", national_id_number="CM-BADGE-002", residential_address="Bastos", kyc_status=VerificationStatus.PENDING)

    awarded = evaluate_badges_for_user(user)
    assert BadgeCode.VERIFIED_RENTER in awarded
    assert user.badges.filter(badge_code=BadgeCode.VERIFIED_RENTER).exists()

    not_awarded = evaluate_badges_for_user(unverified_user)
    assert BadgeCode.VERIFIED_RENTER not in not_awarded


@pytest.mark.django_db
def test_badge_evaluation_is_idempotent():
    user = User.objects.create(username="badge_idempotent_user", phone="+237699994003")
    KYCProfile.objects.create(user=user, legal_full_name="Test User", date_of_birth="1990-01-01", national_id_number="CM-BADGE-003", residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED)

    first_run = evaluate_badges_for_user(user)
    second_run = evaluate_badges_for_user(user)
    assert BadgeCode.VERIFIED_RENTER in first_run
    assert BadgeCode.VERIFIED_RENTER not in second_run  # already awarded — not re-awarded
    assert user.badges.filter(badge_code=BadgeCode.VERIFIED_RENTER).count() == 1


@pytest.mark.django_db
def test_five_successful_deals_badge(quarter):
    buyer = User.objects.create(username="badge_deals_buyer", phone="+237699994004")
    landlord = User.objects.create(username="badge_deals_landlord", phone="+237699994005")

    for i in range(5):
        house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
        listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
        Booking.objects.create(
            booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
            requester=buyer, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key=f"badge-deal-{i}",
        )

    awarded = evaluate_badges_for_user(buyer)
    assert BadgeCode.FIVE_SUCCESSFUL_DEALS in awarded


@pytest.mark.django_db
def test_waitlist_join_and_notify(quarter):
    landlord = User.objects.create(username="waitlist_landlord", phone="+237699994006")
    waiter = User.objects.create(username="waitlist_waiter", phone="+237699994007")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    entry = join_listing_waitlist(user=waiter, listing_id=listing.id)
    assert entry.notified_at is None

    notified = notify_waitlist_on_availability(listing.id)
    assert len(notified) == 1
    entry.refresh_from_db()
    assert entry.notified_at is not None

    assert Notification.objects.filter(recipient=waiter, notification_type="WAITLIST_LISTING_AVAILABLE").exists()

    # A second availability notification shouldn't re-notify an already-notified entry.
    second_round = notify_waitlist_on_availability(listing.id)
    assert len(second_round) == 0


@pytest.mark.django_db
def test_joining_the_same_waitlist_twice_does_not_duplicate(quarter):
    landlord = User.objects.create(username="waitlist_landlord_2", phone="+237699994008")
    waiter = User.objects.create(username="waitlist_waiter_2", phone="+237699994009")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    join_listing_waitlist(user=waiter, listing_id=listing.id)
    join_listing_waitlist(user=waiter, listing_id=listing.id)
    assert ListingWaitlistEntry.objects.filter(user=waiter, listing_id=listing.id).count() == 1
