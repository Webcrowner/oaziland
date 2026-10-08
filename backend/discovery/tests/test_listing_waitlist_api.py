"""Tests for the real listing-waitlist API and its wiring into booking
cancellation — Prompt 15's 'NEW — Waitlist' had a fully built,
unit-tested join_listing_waitlist()/notify_waitlist_on_availability(),
but nothing ever let a real user join one, and nothing ever called
notify_waitlist_on_availability() from a real flow."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, KYCProfile, VerificationStatus, MfaMethod
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from discovery.models import ListingWaitlistEntry
from notifications.models import Notification


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _verify(user):
    KYCProfile.objects.create(user=user, legal_full_name=user.username, date_of_birth="1990-01-01", national_id_number=f"CM-{user.id}", residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED)
    MfaMethod.objects.create(user=user, mfa_type="SMS_OTP", destination=user.phone, verified=True)
    return user


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_joining_a_listing_waitlist_via_api(quarter):
    landlord = User.objects.create(username="waitlist_api_landlord", phone="+237699996001")
    waiter = User.objects.create(username="waitlist_api_waiter", phone="+237699996002")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    response = _auth_client(waiter).post(f"/api/listings/{listing.id}/join-waitlist/")
    assert response.status_code == 201
    assert response.data["already_joined"] is False
    assert ListingWaitlistEntry.objects.filter(user=waiter, listing_id=listing.id).exists()

    second_response = _auth_client(waiter).post(f"/api/listings/{listing.id}/join-waitlist/")
    assert second_response.data["already_joined"] is True
    assert ListingWaitlistEntry.objects.filter(user=waiter, listing_id=listing.id).count() == 1


@pytest.mark.django_db
def test_cancelling_a_booking_on_a_waitlisted_listing_notifies_waiters(quarter):
    from transactions.services import reserve_booking, cancel_booking
    from transactions.models import BookingType

    class _FakeLock:
        def acquire(self, key, ttl_seconds):
            return True

        def release(self, key):
            return True

    landlord = User.objects.create(username="waitlist_notify_landlord", phone="+237699996003")
    requester = _verify(User.objects.create(username="waitlist_notify_requester", phone="+237699996004"))
    waiter = User.objects.create(username="waitlist_notify_waiter", phone="+237699996005")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    _auth_client(waiter).post(f"/api/listings/{listing.id}/join-waitlist/")

    lock = _FakeLock()
    booking = reserve_booking(
        lock_client=lock, requester=requester, booking_type=BookingType.GENERAL_RENTAL,
        target_content_type="property.Listing", target_id=listing.id, amount_xaf=Decimal("100000"),
    )
    cancel_booking(lock_client=lock, booking=booking)

    assert Notification.objects.filter(recipient=waiter, notification_type="WAITLIST_LISTING_AVAILABLE").exists()
