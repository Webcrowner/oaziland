"""
Tests for real listing photos — closing the other half of the media-
upload gap: Listing had no photo field at all, and no way to attach
one even once a real file could be uploaded (uploads/tests/).
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus, ListingPhoto


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Bastos District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def listing(db, quarter):
    landlord = User.objects.create(username="photo_landlord", phone="+237699222201")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    return landlord, listing


@pytest.mark.django_db
def test_first_photo_added_is_automatically_primary(listing):
    landlord, target_listing = listing
    client = _auth_client(landlord)

    response = client.post(f"/api/listings/{target_listing.id}/add-photo/", {"url": "https://example.com/photo1.jpg"})

    assert response.status_code == 201
    assert response.data["is_primary"] is True


@pytest.mark.django_db
def test_second_photo_added_is_not_automatically_primary(listing):
    landlord, target_listing = listing
    client = _auth_client(landlord)
    client.post(f"/api/listings/{target_listing.id}/add-photo/", {"url": "https://example.com/photo1.jpg"})

    second_response = client.post(f"/api/listings/{target_listing.id}/add-photo/", {"url": "https://example.com/photo2.jpg"})

    assert second_response.data["is_primary"] is False
    assert ListingPhoto.objects.filter(listing=target_listing).count() == 2


@pytest.mark.django_db
def test_only_the_lister_can_add_a_photo(listing):
    _landlord, target_listing = listing
    stranger = User.objects.create(username="photo_stranger", phone="+237699222202")
    client = _auth_client(stranger)

    response = client.post(f"/api/listings/{target_listing.id}/add-photo/", {"url": "https://example.com/photo1.jpg"})

    assert response.status_code == 403
    assert ListingPhoto.objects.filter(listing=target_listing).count() == 0


@pytest.mark.django_db
def test_removing_a_photo(listing):
    landlord, target_listing = listing
    client = _auth_client(landlord)
    add_response = client.post(f"/api/listings/{target_listing.id}/add-photo/", {"url": "https://example.com/photo1.jpg"})
    photo_id = add_response.data["id"]

    remove_response = client.post(f"/api/listings/{target_listing.id}/remove-photo/", {"photo_id": photo_id})

    assert remove_response.status_code == 204
    assert ListingPhoto.objects.filter(id=photo_id).exists() is False


@pytest.mark.django_db
def test_photos_appear_in_the_real_listing_response(listing):
    landlord, target_listing = listing
    client = _auth_client(landlord)
    client.post(f"/api/listings/{target_listing.id}/add-photo/", {"url": "https://example.com/photo1.jpg"})

    detail_response = APIClient().get(f"/api/listings/{target_listing.id}/")

    assert len(detail_response.data["photos"]) == 1
    assert detail_response.data["photos"][0]["url"] == "https://example.com/photo1.jpg"


@pytest.mark.django_db
def test_add_photo_without_a_url_is_rejected(listing):
    landlord, target_listing = listing
    client = _auth_client(landlord)

    response = client.post(f"/api/listings/{target_listing.id}/add-photo/", {})

    assert response.status_code == 400
