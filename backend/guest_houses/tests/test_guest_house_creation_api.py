"""
Tests for real GuestHouseLodge creation and photos — closing a
genuine gap: GuestHouseLodgeViewSet was ReadOnlyModelViewSet, meaning
no real owner could ever list their own property.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, KYCProfile, VerificationStatus, MfaMethod
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import GuestHouseLodge


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _verify(user):
    """Listing creation now requires real KYC + MFA, same gate as
    property/hotel/venue listings."""
    KYCProfile.objects.create(user=user, legal_full_name=user.username, date_of_birth="1990-01-01", national_id_number=f"CM-{user.id}", residential_address="Kribi", kyc_status=VerificationStatus.VERIFIED)
    MfaMethod.objects.create(user=user, mfa_type="SMS_OTP", destination=user.phone, verified=True)
    return user


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Sud")
    division = Division.objects.create(region=region, name="Océan")
    subdivision = Subdivision.objects.create(division=division, name="Kribi I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Kribi Centre")
    return Quarter.objects.create(village_or_district=village, name="Kribi Beach")


@pytest.mark.django_db
def test_creating_a_real_guest_house(quarter):
    owner = _verify(User.objects.create(username="gh_create_owner", phone="+237699888801"))
    client = _auth_client(owner)

    response = client.post("/api/guest-houses/", {"quarter": str(quarter.id), "is_coastal_leisure": True, "finish_level": "MODERN"})

    assert response.status_code == 201
    assert response.data["is_coastal_leisure"] is True
    guest_house = GuestHouseLodge.objects.get(id=response.data["id"])
    assert guest_house.owner_id == owner.id


@pytest.mark.django_db
def test_a_new_guest_house_is_immediately_publicly_visible_no_verification_gate(quarter):
    """Unlike Hotel/Venue, GuestHouseLodge's real model never had a
    verified field at all — confirms the API genuinely matches that,
    not silently gated the same way as the other two by mistake."""
    owner = _verify(User.objects.create(username="gh_visibility_owner", phone="+237699888802"))
    _auth_client(owner).post("/api/guest-houses/", {"quarter": str(quarter.id)})

    response = APIClient().get("/api/guest-houses/")

    assert response.data["count"] == 1


@pytest.mark.django_db
def test_adding_a_real_photo_to_a_guest_house(quarter):
    owner = _verify(User.objects.create(username="gh_photo_owner", phone="+237699888803"))
    client = _auth_client(owner)
    create_response = client.post("/api/guest-houses/", {"quarter": str(quarter.id)})
    gh_id = create_response.data["id"]

    photo_response = client.post(f"/api/guest-houses/{gh_id}/add-photo/", {"url": "https://example.com/gh1.jpg"})

    assert photo_response.status_code == 201
    detail = client.get(f"/api/guest-houses/{gh_id}/")
    assert len(detail.data["photos"]) == 1


@pytest.mark.django_db
def test_only_the_guest_houses_own_owner_can_add_a_photo(quarter):
    owner = _verify(User.objects.create(username="gh_photo_perm_owner", phone="+237699888804"))
    stranger = User.objects.create(username="gh_photo_perm_stranger", phone="+237699888805")
    create_response = _auth_client(owner).post("/api/guest-houses/", {"quarter": str(quarter.id)})
    gh_id = create_response.data["id"]

    response = _auth_client(stranger).post(f"/api/guest-houses/{gh_id}/add-photo/", {"url": "https://example.com/hijack.jpg"})

    assert response.status_code == 403


@pytest.mark.django_db
def test_creating_a_guest_house_requires_authentication(quarter):
    response = APIClient().post("/api/guest-houses/", {"quarter": str(quarter.id)})
    assert response.status_code == 401
