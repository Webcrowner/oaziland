import pytest
from decimal import Decimal
from rest_framework.test import APIClient

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus


@pytest.mark.django_db
def test_home_stats_reflect_only_real_published_listings():
    empty = APIClient().get("/api/home-stats/")
    assert empty.status_code == 200
    assert empty.data["published_listings"] == 0
    assert empty.data["popular_quarters"] == []

    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaounde I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")
    owner = User.objects.create(username="stats_owner", phone="+237699111001")
    for price, status in ((100000, ListingStatus.PUBLISHED), (300000, ListingStatus.PUBLISHED), (999999, ListingStatus.DRAFT)):
        house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE")
        listing = Listing.objects.create(
            property_asset=house, listed_by=owner, listing_type=ListingType.RENT,
            status=ListingStatus.DRAFT, price_xaf=Decimal(price),
        )
        if status == ListingStatus.PUBLISHED:
            listing.publish()

    data = APIClient().get("/api/home-stats/").data

    assert data["published_listings"] == 2
    assert data["rent_listings"] == 2
    assert data["new_listings_24h"] == 2
    top = data["popular_quarters"][0]
    assert (top["name"], top["area"], top["listing_count"]) == ("Bastos", "Bastos District", 2)
    assert (top["min_rent_xaf"], top["max_rent_xaf"]) == (Decimal("100000"), Decimal("300000"))
