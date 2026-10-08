import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, AgentProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Shop, Listing, ListingType, ListingStatus


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaounde I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def setup(quarter):
    landlord = User.objects.create(username="edit_landlord", phone="+237699222001")
    agent = User.objects.create(username="edit_agent", phone="+237699222002")
    AgentProfile.objects.create(user=agent, agent_commission_percent=Decimal("10"))
    stranger = User.objects.create(username="edit_stranger", phone="+237699222003")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", bedrooms=2, bathrooms=1)
    listing = Listing.objects.create(
        property_asset=house, listed_by=agent, listing_type=ListingType.RENT,
        status=ListingStatus.DRAFT, price_xaf=Decimal("100000"),
    )
    listing.publish()
    return landlord, agent, stranger, house, listing


@pytest.mark.django_db
def test_agent_lister_edits_price_and_property_details_without_review(setup):
    _, agent, _, house, listing = setup

    response = _client(agent).patch(f"/api/listings/{listing.id}/edit-details/", {
        "price_xaf": "120000", "bedrooms": 3, "living_rooms": 1,
        "description": "Newly painted three-bedroom house.", "amenities": ["PARKING"],
        "latitude": "3.8967", "longitude": "11.5167",
    }, format="json")

    assert response.status_code == 200
    listing.refresh_from_db()
    house.refresh_from_db()
    assert listing.status == ListingStatus.PUBLISHED  # a price change never goes back to review
    assert listing.price_xaf == Decimal("120000")
    assert (house.bedrooms, house.living_rooms) == (3, 1)
    assert house.amenities == ["PARKING"]
    assert house.latitude == Decimal("3.8967")
    assert response.data["property_asset"]["bedrooms"] == 3


@pytest.mark.django_db
def test_only_the_lister_can_edit(setup):
    landlord, _, stranger, _, listing = setup
    for user in (stranger, landlord):
        response = _client(user).patch(f"/api/listings/{listing.id}/edit-details/", {"price_xaf": "1"}, format="json")
        assert response.status_code == 403


@pytest.mark.django_db
def test_invalid_edits_are_rejected(setup, quarter):
    landlord, agent, _, _, listing = setup
    client = _client(agent)

    assert client.patch(f"/api/listings/{listing.id}/edit-details/", {"latitude": "3.8"}, format="json").status_code == 400
    assert client.patch(f"/api/listings/{listing.id}/edit-details/", {"amenities": ["NOPE"]}, format="json").status_code == 400

    shop = Shop.objects.create(owner=landlord, quarter=quarter, type="SHOP")
    shop_listing = Listing.objects.create(
        property_asset=shop, listed_by=agent, listing_type=ListingType.RENT,
        status=ListingStatus.DRAFT, price_xaf=Decimal("50000"),
    )
    assert client.patch(f"/api/listings/{shop_listing.id}/edit-details/", {"bedrooms": 2}, format="json").status_code == 400


@pytest.mark.django_db
def test_plain_patch_cannot_repoint_a_listing_at_another_property(setup, quarter):
    landlord, agent, stranger, house, listing = setup
    other = House.objects.create(owner=stranger, quarter=quarter, type="HOUSE")

    response = _client(agent).patch(f"/api/listings/{listing.id}/", {"property_asset_id": str(other.id), "price_xaf": "130000"}, format="json")

    assert response.status_code == 200
    listing.refresh_from_db()
    assert listing.property_asset_id == house.id
    assert listing.price_xaf == Decimal("130000")
