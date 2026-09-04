"""Tests for the landlord portfolio dashboard."""
import pytest
from decimal import Decimal

from identity.models import User, AgentProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Shop, Listing, ListingType, ListingStatus
from property.services import get_landlord_portfolio_summary
from transactions.models import Booking, BookingType, BookingStatus
from agency.services import create_commission_for_booking


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_portfolio_summary_aggregates_across_property_types(quarter):
    landlord = User.objects.create(username="portfolio_landlord", phone="+237699992001")
    agent_user = User.objects.create(username="portfolio_agent", phone="+237699992002")
    agent_profile = AgentProfile.objects.create(user=agent_user, agent_commission_percent=Decimal("10"))
    guest = User.objects.create(username="portfolio_guest", phone="+237699992003")

    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    house_listing = Listing.objects.create(property_asset=house, listed_by=agent_user, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    shop = Shop.objects.create(owner=landlord, quarter=quarter, type="SHOP")
    shop_listing = Listing.objects.create(property_asset=shop, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.DRAFT, price_xaf=Decimal("80000"))

    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=house_listing.id,
        requester=guest, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="portfolio-test-1",
    )
    create_commission_for_booking(booking=booking, agent=agent_user)

    summary = get_landlord_portfolio_summary(landlord)

    assert summary["total_properties"] == 2  # house AND shop, different types
    assert summary["total_listings"] == 2
    assert summary["published_listings"] == 1  # only the house listing is published
    assert summary["completed_bookings"] == 1
    assert summary["total_commission_paid_xaf"] == Decimal("10000")  # 10% of 100,000
