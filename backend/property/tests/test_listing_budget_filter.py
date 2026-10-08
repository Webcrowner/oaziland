import pytest
from decimal import Decimal
from rest_framework.test import APIClient

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


def _listing(owner, quarter, price):
    house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE")
    return Listing.objects.create(
        property_asset=house, listed_by=owner, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal(price),
    )


@pytest.mark.django_db
def test_listing_search_respects_max_price_budget(quarter):
    owner = User.objects.create(username="budget_owner", phone="+237699995001")
    cheap = _listing(owner, quarter, "80000")
    _listing(owner, quarter, "500000")
    client = APIClient()

    response = client.get("/api/listings/", {"listing_type": "RENT", "max_price": "100000"})
    assert response.status_code == 200
    assert [r["id"] for r in response.data["results"]] == [str(cheap.id)]

    with_quarter = client.get("/api/listings/", {"quarter": str(quarter.id), "max_price": "100000"})
    assert [r["id"] for r in with_quarter.data["results"]] == [str(cheap.id)]

    malformed = client.get("/api/listings/", {"max_price": "not-a-number"})
    assert malformed.data["count"] == 2
