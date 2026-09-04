"""
Tests proving 'modern vs. not modern' is a real, working search filter —
not just a stored field nothing reads. Covers both search entry points
(the quarter-based boosted search and the general filtered search).
"""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus, FinishLevel
from property.services import search_listings_by_quarter
from discovery.services import search_listings_with_filters
from land.models import Land, LandUseType, TitleType


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
    return User.objects.create(username="finish_level_landlord", phone="+237699997001")


@pytest.mark.django_db
def test_modern_house_correctly_tagged_and_filterable(quarter, landlord):
    modern_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", finish_level=FinishLevel.MODERN)
    standard_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", finish_level=FinishLevel.STANDARD)

    Listing.objects.create(property_asset=modern_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("150000"))
    Listing.objects.create(property_asset=standard_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("60000"))

    modern_results = search_listings_by_quarter(quarter, finish_level=FinishLevel.MODERN)
    modern_property_ids = [l.property_asset_id for l in modern_results]

    assert modern_house.id in modern_property_ids
    assert standard_house.id not in modern_property_ids


@pytest.mark.django_db
def test_land_has_no_finish_level_and_is_excluded_from_finish_filters(quarter, landlord):
    """Land has no meaningful 'modern' concept — a finish_level filter
    must correctly exclude it, not error or wrongly include it."""
    land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-950", title_type=TitleType.TITRE_FONCIER)
    Listing.objects.create(property_asset=land, listed_by=landlord, listing_type=ListingType.SALE, status=ListingStatus.PUBLISHED, price_xaf=Decimal("5000000"))

    assert land.finish_level == ""  # correctly blank, not defaulted to a misleading value

    modern_results = search_listings_by_quarter(quarter, finish_level=FinishLevel.MODERN)
    assert land.id not in [l.property_asset_id for l in modern_results]


@pytest.mark.django_db
def test_general_filtered_search_also_supports_finish_level(quarter, landlord):
    """Confirms the SAME filter works through discovery's general
    search path, not just the quarter-boosted one — one consistent
    filter behavior across both entry points."""
    modern_apartment = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", finish_level=FinishLevel.MODERN)
    standard_apartment = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", finish_level=FinishLevel.STANDARD)

    modern_listing = Listing.objects.create(property_asset=modern_apartment, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("200000"))
    standard_listing = Listing.objects.create(property_asset=standard_apartment, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("70000"))

    results = search_listings_with_filters({"finish_level": FinishLevel.MODERN})
    result_ids = [l.id for l in results]

    assert modern_listing.id in result_ids
    assert standard_listing.id not in result_ids
