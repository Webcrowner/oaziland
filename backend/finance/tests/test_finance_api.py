"""
Tests for the real finance API — closing a genuine gap:
estimate_property_value() and estimate_affordable_rent_range() had
real, working logic and even a real model to store results in, but
NO endpoint anywhere ever exposed either one to a real user.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient

from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from identity.models import User
from property.models import House, Listing, ListingType, ListingStatus


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Bastos District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_property_valuation_with_real_comparables(quarter):
    landlord = User.objects.create(username="finance_landlord", phone="+237699333301")
    for price in [Decimal("100000"), Decimal("120000"), Decimal("110000")]:
        house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
        Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=price)

    response = APIClient().post("/api/valuations/", {"quarter": str(quarter.id), "property_type": "HOUSE"})

    assert response.status_code == 201
    assert response.data["comparable_count"] == 3
    assert Decimal(response.data["estimated_low_xaf"]) < Decimal(response.data["estimated_high_xaf"])


@pytest.mark.django_db
def test_property_valuation_with_no_comparables_returns_zero_range(quarter):
    response = APIClient().post("/api/valuations/", {"quarter": str(quarter.id), "property_type": "SHOP"})

    assert response.status_code == 201
    assert response.data["comparable_count"] == 0
    assert Decimal(response.data["estimated_low_xaf"]) == 0


@pytest.mark.django_db
def test_valuation_requires_no_authentication(quarter):
    """Matches how every other browse/search surface on the platform
    works — no account required to use a public estimation tool."""
    response = APIClient().post("/api/valuations/", {"quarter": str(quarter.id), "property_type": "HOUSE"})
    assert response.status_code == 201


@pytest.mark.django_db
def test_valuation_rejects_an_unknown_quarter():
    response = APIClient().post("/api/valuations/", {"quarter": "11111111-1111-1111-1111-111111111111", "property_type": "HOUSE"})
    assert response.status_code == 400


@pytest.mark.django_db
def test_affordability_estimate_returns_real_comfortable_and_max_figures():
    response = APIClient().post("/api/affordability/", {"monthly_income_xaf": "300000"})

    assert response.status_code == 200
    assert Decimal(response.data["comfortable_rent_xaf"]) == Decimal("75000.00")
    assert Decimal(response.data["max_recommended_rent_xaf"]) == Decimal("99000.00")


@pytest.mark.django_db
def test_affordability_rejects_a_negative_income():
    response = APIClient().post("/api/affordability/", {"monthly_income_xaf": "-500"})
    assert response.status_code == 400
