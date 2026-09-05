"""
Tests for the real property-creation wizard endpoints — a genuine gap
this closes: Listing.create() could only ATTACH to an already-existing
PropertyAsset; nothing ever let a user actually create the House,
Shop, or Land itself.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, KYCProfile, VerificationStatus
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Shop
from land.models import Land


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
def verified_user(db):
    from identity.models import MfaMethod
    user = User.objects.create(username="wizard_verified_user", phone="+237699111001")
    KYCProfile.objects.create(user=user, legal_full_name="Wizard User", date_of_birth="1990-01-01", national_id_number="CM-WIZARD-001", residential_address="Yaoundé", kyc_status=VerificationStatus.VERIFIED)
    MfaMethod.objects.create(user=user, mfa_type="SMS_OTP", destination=user.phone, verified=True)
    return user


@pytest.mark.django_db
def test_create_a_house_via_the_real_api(quarter, verified_user):
    client = _auth_client(verified_user)
    response = client.post("/api/houses/", {
        "quarter": str(quarter.id), "bedrooms": 3, "bathrooms": 2, "size_sqm": "120.5",
        "description": "A real 3-bedroom house.", "finish_level": "MODERN",
    })
    assert response.status_code == 201
    house = House.objects.get(id=response.data["id"])
    assert house.owner == verified_user
    assert house.type == "HOUSE"  # server-set, never client-supplied
    assert house.bedrooms == 3


@pytest.mark.django_db
def test_create_a_shop_via_the_real_api(quarter, verified_user):
    client = _auth_client(verified_user)
    response = client.post("/api/shops/", {
        "quarter": str(quarter.id), "frontage_meters": "8.5", "description": "A storefront on the main road.",
    })
    assert response.status_code == 201
    shop = Shop.objects.get(id=response.data["id"])
    assert shop.owner == verified_user
    assert shop.type == "SHOP"


@pytest.mark.django_db
def test_create_land_via_the_real_api(quarter, verified_user):
    client = _auth_client(verified_user)
    response = client.post("/api/lands/", {
        "quarter": str(quarter.id), "land_use_type": "TITLED_RESIDENTIAL",
        "title_deed_number": "TF-99001", "title_type": "TITRE_FONCIER",
    })
    assert response.status_code == 201
    land = Land.objects.get(id=response.data["id"])
    assert land.owner == verified_user
    assert land.type == "LAND"


@pytest.mark.django_db
def test_property_creation_requires_mfa_and_kyc(quarter):
    unverified_user = User.objects.create(username="wizard_unverified_user", phone="+237699111002")
    client = _auth_client(unverified_user)
    response = client.post("/api/houses/", {"quarter": str(quarter.id), "bedrooms": 2})
    assert response.status_code == 403


@pytest.mark.django_db
def test_the_full_wizard_flow_create_property_then_create_listing(quarter, verified_user):
    """The literal end-to-end journey this wizard exists for: create
    the property, then attach a real listing to it — both through the
    real API, no direct model access."""
    client = _auth_client(verified_user)

    house_response = client.post("/api/houses/", {"quarter": str(quarter.id), "bedrooms": 2, "description": "A cozy 2-bedroom home."})
    assert house_response.status_code == 201
    house_id = house_response.data["id"]

    listing_response = client.post("/api/listings/", {
        "property_asset_id": house_id, "listing_type": "RENT", "price_xaf": "75000",
    })
    assert listing_response.status_code == 201
    assert listing_response.data["property_asset"]["id"] == house_id
    assert listing_response.data["lister_role"] == "OWNER"


@pytest.mark.django_db
def test_browsing_property_details_is_public(quarter, verified_user):
    house = House.objects.create(owner=verified_user, quarter=quarter, type="HOUSE", bedrooms=4)
    response = APIClient().get(f"/api/houses/{house.id}/")
    assert response.status_code == 200
    assert response.data["bedrooms"] == 4
