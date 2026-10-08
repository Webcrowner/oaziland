import pytest
from decimal import Decimal
from rest_framework.test import APIClient

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingPhoto, ListingType, ListingStatus


@pytest.mark.django_db
def test_listing_detail_exposes_rooms_parlours_and_video():
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Bastos District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")
    owner = User.objects.create(username="detail_owner", phone="+237699444900")
    house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE", bedrooms=3, bathrooms=2, living_rooms=1)
    listing = Listing.objects.create(
        property_asset=house, listed_by=owner, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("90000"),
    )
    ListingPhoto.objects.create(listing=listing, url="https://example.com/a.jpg", media_type="PHOTO")
    ListingPhoto.objects.create(listing=listing, url="https://example.com/a.mp4", media_type="VIDEO")

    data = APIClient().get(f"/api/listings/{listing.id}/").data

    asset = data["property_asset"]
    assert (asset["bedrooms"], asset["bathrooms"], asset["living_rooms"]) == (3, 2, 1)
    assert {p["media_type"] for p in data["photos"]} == {"PHOTO", "VIDEO"}
    assert data["lister_role"] == "OWNER"
