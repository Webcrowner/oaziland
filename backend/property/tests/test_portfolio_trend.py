"""Test proving the retrofitted bookings_trend on the landlord portfolio dashboard."""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from property.services import get_landlord_portfolio_summary
from transactions.models import Booking, BookingType, BookingStatus


@pytest.mark.django_db
def test_landlord_portfolio_includes_a_real_bookings_trend():
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")

    landlord = User.objects.create(username="trend_test_landlord", phone="+237699888300")
    guest = User.objects.create(username="trend_test_guest", phone="+237699888301")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id, requester=guest, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="trend-test-1")

    summary = get_landlord_portfolio_summary(landlord)
    assert "bookings_trend" in summary
    assert summary["bookings_trend"]["current_period_value"] == 1
