"""
Test proving a real gap is fixed: searching WITHOUT specifying a
quarter previously ignored every other filter entirely (property_type,
finish_level, listing_type) — returning every published listing
regardless of what was actually asked for.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from land.models import Land


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Bastos District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_listing_type_filter_works_without_a_quarter_specified(quarter):
    landlord = User.objects.create(username="filter_test_landlord", phone="+237699999101")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND")

    Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    Listing.objects.create(property_asset=land, listed_by=landlord, listing_type=ListingType.SALE, status=ListingStatus.PUBLISHED, price_xaf=Decimal("15000000"))

    client = APIClient()

    rent_only = client.get("/api/listings/?listing_type=RENT")
    assert rent_only.data["count"] == 1
    assert rent_only.data["results"][0]["listing_type"] == "RENT"

    sale_only = client.get("/api/listings/?listing_type=SALE")
    assert sale_only.data["count"] == 1
    assert sale_only.data["results"][0]["listing_type"] == "SALE"

    # No filter at all — both correctly returned.
    everything = client.get("/api/listings/")
    assert everything.data["count"] == 2


@pytest.mark.django_db
def test_property_type_filter_works_without_a_quarter_specified(quarter):
    """The exact bug: before this fix, property_type was silently
    ignored whenever no quarter was given."""
    landlord = User.objects.create(username="filter_test_landlord_2", phone="+237699999102")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND")
    Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    Listing.objects.create(property_asset=land, listed_by=landlord, listing_type=ListingType.SALE, status=ListingStatus.PUBLISHED, price_xaf=Decimal("15000000"))

    client = APIClient()
    houses_only = client.get("/api/listings/?property_type=HOUSE")
    assert houses_only.data["count"] == 1
    assert houses_only.data["results"][0]["property_asset"]["type"] == "HOUSE"
