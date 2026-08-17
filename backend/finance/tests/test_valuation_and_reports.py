"""Tests for AVM valuation, affordability, earnings reports, and currency display."""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from finance.models import ExchangeRateSnapshot
from finance.services import (
    estimate_property_value, estimate_affordable_rent_range,
    generate_earnings_report, convert_xaf_to_currency,
)


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_avm_estimates_a_range_from_real_comparables(quarter):
    landlord = User.objects.create(username="avm_landlord", phone="+237699400001")
    for price in [Decimal("100000"), Decimal("120000"), Decimal("110000")]:
        house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
        Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=price)

    estimate = estimate_property_value(quarter=quarter, property_type="HOUSE")
    assert estimate.comparable_count == 3
    assert estimate.estimated_low_xaf < estimate.estimated_high_xaf
    avg = Decimal("110000")
    assert estimate.estimated_low_xaf == avg * Decimal("0.85")


@pytest.mark.django_db
def test_avm_with_no_comparables_returns_zero_not_an_error(quarter):
    estimate = estimate_property_value(quarter=quarter, property_type="SHOP")
    assert estimate.comparable_count == 0
    assert estimate.estimated_low_xaf == Decimal("0")


def test_affordability_calculator():
    result = estimate_affordable_rent_range(monthly_income_xaf=Decimal("300000"))
    assert result["comfortable_rent_xaf"] == Decimal("75000")
    assert result["max_recommended_rent_xaf"] == Decimal("99000.00")


@pytest.mark.django_db
def test_currency_conversion_is_display_only():
    ExchangeRateSnapshot.objects.create(currency_code="USD", xaf_per_unit=Decimal("600"))
    converted = convert_xaf_to_currency(Decimal("60000"), "USD")
    assert converted == Decimal("100.00")


@pytest.mark.django_db
def test_currency_conversion_fails_clearly_without_a_rate():
    with pytest.raises(ValueError):
        convert_xaf_to_currency(Decimal("60000"), "GBP")
