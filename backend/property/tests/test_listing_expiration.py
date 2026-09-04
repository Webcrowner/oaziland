"""
Tests for listing expiration: reminders reaching every relevant party
(tenant, landlord, agent, agency), real auto-expiry, and self-service renewal.
"""
import pytest
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone

from identity.models import User, AgentProfile, AgencyProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from property.services import send_listing_expiration_reminders, expire_overdue_listings
from transactions.models import Booking, BookingType, BookingStatus
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
def test_publish_sets_a_real_expiration_date(quarter):
    landlord = User.objects.create(username="expiry_landlord", phone="+237699999001")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.DRAFT, price_xaf=Decimal("100000"))

    assert listing.expires_at is None
    listing.publish()
    assert listing.expires_at is not None
    assert (listing.expires_at - listing.published_at).days == 90


@pytest.mark.django_db
def test_reminder_reaches_tenant_landlord_agent_and_agency(quarter):
    """The literal requirement: a tenant, landlord, agent, or agency
    should all be notified — tested with all four roles distinctly involved."""
    property_owner = User.objects.create(username="expiry_owner", phone="+237699999002")
    agency_user = User.objects.create(username="expiry_agency", phone="+237699999003")
    agency = AgencyProfile.objects.create(user=agency_user, registration_number="RC-EXPIRY-001", agency_commission_percent=Decimal("15"))
    agent_user = User.objects.create(username="expiry_agent", phone="+237699999004")
    AgentProfile.objects.create(user=agent_user, agency=agency, agent_commission_percent=Decimal("10"))
    tenant = User.objects.create(username="expiry_tenant", phone="+237699999005")

    house = House.objects.create(owner=property_owner, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=agent_user, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    listing.expires_at = timezone.now() + timedelta(days=7)
    listing.save(update_fields=["expires_at"])

    Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id, requester=tenant, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("100000"), idempotency_key="expiry-test-1")

    sent = send_listing_expiration_reminders()
    assert len(sent) == 4  # owner, agency, agent, tenant — all four real roles

    for user in (property_owner, agency_user, agent_user, tenant):
        assert Notification.objects.filter(recipient=user, notification_type="LISTING_EXPIRING_7D", related_reference=str(listing.id)).exists()


@pytest.mark.django_db
def test_reminder_never_sent_twice_the_same_day(quarter):
    landlord = User.objects.create(username="expiry_dedup_landlord", phone="+237699999006")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    listing.expires_at = timezone.now() + timedelta(days=3)
    listing.save(update_fields=["expires_at"])

    first_run = send_listing_expiration_reminders()
    second_run = send_listing_expiration_reminders()
    assert len(first_run) == 1
    assert len(second_run) == 0


@pytest.mark.django_db
def test_expired_listing_is_actually_moved_out_of_public_search(quarter):
    """The real enforcement: an overdue listing genuinely stops
    appearing in search, not just carries a stale date."""
    landlord = User.objects.create(username="expiry_autoexpire_landlord", phone="+237699999007")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    listing.expires_at = timezone.now() - timedelta(days=1)  # already overdue
    listing.save(update_fields=["expires_at"])

    expired = expire_overdue_listings()
    assert len(expired) == 1

    listing.refresh_from_db()
    assert listing.status == ListingStatus.EXPIRED
    assert Notification.objects.filter(recipient=landlord, notification_type="LISTING_EXPIRED").exists()

    from property.services import search_listings_by_quarter
    results = search_listings_by_quarter(quarter)
    assert listing.id not in [l.id for l in results]  # genuinely gone from search


@pytest.mark.django_db
def test_renewing_an_expired_listing_republishes_it_with_a_fresh_period(quarter):
    landlord = User.objects.create(username="expiry_renew_landlord", phone="+237699999008")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.EXPIRED, price_xaf=Decimal("100000"))
    listing.expires_at = timezone.now() - timedelta(days=5)
    listing.save(update_fields=["expires_at"])

    listing.renew()
    listing.refresh_from_db()

    assert listing.status == ListingStatus.PUBLISHED  # brought back to life
    assert listing.expires_at > timezone.now() + timedelta(days=89)  # a fresh 90-day period from NOW, not compounded from the old stale date


@pytest.mark.django_db
def test_renew_api_endpoint_restricted_to_the_listings_own_lister(quarter):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    landlord = User.objects.create(username="expiry_api_landlord", phone="+237699999009")
    impersonator = User.objects.create(username="expiry_api_impersonator", phone="+237699999010")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.EXPIRED, price_xaf=Decimal("100000"))

    def auth_client(user):
        client = APIClient()
        token = RefreshToken.for_user(user)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        return client

    impersonator_response = auth_client(impersonator).post(f"/api/listings/{listing.id}/renew/")
    assert impersonator_response.status_code == 403

    owner_response = auth_client(landlord).post(f"/api/listings/{listing.id}/renew/")
    assert owner_response.status_code == 200
    assert owner_response.data["status"] == "PUBLISHED"
