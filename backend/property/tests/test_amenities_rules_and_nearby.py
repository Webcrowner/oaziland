"""
Tests for real amenities, house rules, and nearby facilities on
property listings — closing a genuine gap found while reviewing the
platform: House/Land/Shop (the most-used listing types) had none of
this, despite Hotels already having a real (unvalidated) amenities
field.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter, PointOfInterest, PointOfInterestType
from property.models import House, PropertyAmenity, HouseRule


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
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def house(db, quarter):
    landlord = User.objects.create(username="amenity_landlord", phone="+237699999901")
    return landlord, House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")


@pytest.mark.django_db
def test_setting_real_amenities_on_a_house(house):
    landlord, target_house = house
    client = _auth_client(landlord)

    response = client.post(f"/api/houses/{target_house.id}/set-amenities/", {
        "amenities": [PropertyAmenity.PARKING, PropertyAmenity.BACKUP_GENERATOR, PropertyAmenity.SWIMMING_POOL],
    }, format="json")

    assert response.status_code == 200
    target_house.refresh_from_db()
    assert target_house.amenities == [PropertyAmenity.PARKING, PropertyAmenity.BACKUP_GENERATOR, PropertyAmenity.SWIMMING_POOL]


@pytest.mark.django_db
def test_an_invalid_amenity_is_rejected_with_a_clean_error(house):
    landlord, target_house = house
    client = _auth_client(landlord)

    response = client.post(f"/api/houses/{target_house.id}/set-amenities/", {"amenities": ["NOT_A_REAL_AMENITY"]}, format="json")

    assert response.status_code == 400
    target_house.refresh_from_db()
    assert target_house.amenities == []


@pytest.mark.django_db
def test_only_the_owner_can_set_amenities(house):
    _landlord, target_house = house
    stranger = User.objects.create(username="amenity_stranger", phone="+237699999902")

    response = _auth_client(stranger).post(f"/api/houses/{target_house.id}/set-amenities/", {"amenities": [PropertyAmenity.PARKING]}, format="json")

    assert response.status_code == 403


@pytest.mark.django_db
def test_setting_real_house_rules(house):
    landlord, target_house = house
    client = _auth_client(landlord)

    response = client.post(f"/api/houses/{target_house.id}/set-house-rules/", {
        "house_rules": [HouseRule.NO_PETS, HouseRule.NO_SMOKING_INDOORS],
    }, format="json")

    assert response.status_code == 200
    target_house.refresh_from_db()
    assert target_house.house_rules == [HouseRule.NO_PETS, HouseRule.NO_SMOKING_INDOORS]


@pytest.mark.django_db
def test_an_invalid_house_rule_is_rejected(house):
    landlord, target_house = house
    client = _auth_client(landlord)

    response = client.post(f"/api/houses/{target_house.id}/set-house-rules/", {"house_rules": ["NOT_A_REAL_RULE"]}, format="json")

    assert response.status_code == 400


@pytest.mark.django_db
def test_attaching_real_nearby_points_of_interest(house, quarter):
    landlord, target_house = house
    market = PointOfInterest.objects.create(name="Bastos Central Market", poi_type=PointOfInterestType.MARKET, quarter=quarter, latitude="3.8850", longitude="11.5100")
    hospital = PointOfInterest.objects.create(name="Yaoundé General Hospital", poi_type=PointOfInterestType.HOSPITAL, quarter=quarter, latitude="3.8700", longitude="11.5200")
    client = _auth_client(landlord)

    response = client.post(f"/api/houses/{target_house.id}/set-nearby-facilities/", {
        "point_of_interest_ids": [str(market.id), str(hospital.id)],
    }, format="json")

    assert response.status_code == 200
    target_house.refresh_from_db()
    assert target_house.nearby_facilities.count() == 2


@pytest.mark.django_db
def test_an_unknown_point_of_interest_id_is_silently_skipped_not_an_error(house):
    """A deliberate design choice, not an oversight — verified
    directly: a stray/unrelated ID is almost certainly a client-side
    mistake, not something worth hard-failing the whole request over."""
    landlord, target_house = house
    client = _auth_client(landlord)

    response = client.post(f"/api/houses/{target_house.id}/set-nearby-facilities/", {
        "point_of_interest_ids": ["11111111-1111-1111-1111-111111111111"],
    }, format="json")

    assert response.status_code == 200
    target_house.refresh_from_db()
    assert target_house.nearby_facilities.count() == 0


@pytest.mark.django_db
def test_amenities_and_rules_and_nearby_facilities_appear_in_the_real_listing_response(house, quarter):
    from property.models import Listing, ListingType, ListingStatus
    from decimal import Decimal
    landlord, target_house = house
    market = PointOfInterest.objects.create(name="Bastos Market", poi_type=PointOfInterestType.MARKET, quarter=quarter, latitude="3.8850", longitude="11.5100")
    target_house.amenities = [PropertyAmenity.PARKING]
    target_house.house_rules = [HouseRule.NO_PETS]
    target_house.save()
    target_house.nearby_facilities.add(market)
    listing = Listing.objects.create(property_asset=target_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))

    response = APIClient().get(f"/api/listings/{listing.id}/")

    assert response.data["property_asset"]["amenities"] == [PropertyAmenity.PARKING]
    assert response.data["property_asset"]["house_rules"] == [HouseRule.NO_PETS]
    assert "Bastos Market" in response.data["property_asset"]["nearby_facility_names"][0]
