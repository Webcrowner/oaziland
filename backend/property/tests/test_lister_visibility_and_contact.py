"""
Tests for the lister-role visibility (owner vs. agent vs. agency, per
the founder's explicit requirement that some people want to deal
directly with an owner and others prefer an agent/agency) and the
real WhatsApp contact endpoint.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, AgentProfile, AgencyProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from engagement.models import ActionLog


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


@pytest.mark.django_db
def test_owner_direct_listing_shows_owner_role(quarter):
    owner = User.objects.create(username="lister_owner", phone="+237699444001", first_name="Direct Owner")
    house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=owner, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))

    assert listing.lister_role == "OWNER"
    assert listing.lister_display_name == "Direct Owner"
    assert listing.lister_agency_name is None


@pytest.mark.django_db
def test_independent_agent_listing_shows_agent_role(quarter):
    property_owner = User.objects.create(username="lister_property_owner", phone="+237699444002")
    agent = User.objects.create(username="lister_independent_agent", phone="+237699444003", first_name="Independent Agent")
    AgentProfile.objects.create(user=agent, agent_commission_percent=Decimal("10"))  # no agency

    house = House.objects.create(owner=property_owner, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=agent, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))

    assert listing.lister_role == "AGENT"
    assert listing.lister_agency_name is None


@pytest.mark.django_db
def test_agency_agent_listing_shows_agency_role_and_name(quarter):
    property_owner = User.objects.create(username="lister_property_owner_2", phone="+237699444004")
    agency_user = User.objects.create(username="lister_agency_user", phone="+237699444005", first_name="Glorentech Realty")
    agency = AgencyProfile.objects.create(user=agency_user, registration_number="RC-LISTER-001", agency_commission_percent=Decimal("15"))
    agent = User.objects.create(username="lister_agency_agent", phone="+237699444006")
    AgentProfile.objects.create(user=agent, agency=agency, agent_commission_percent=Decimal("10"))

    house = House.objects.create(owner=property_owner, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=agent, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))

    assert listing.lister_role == "AGENCY"
    assert listing.lister_agency_name == "Glorentech Realty"


@pytest.mark.django_db
def test_api_exposes_lister_role_but_never_raw_phone_number(quarter):
    """Confirms the privacy-conscious design choice: role/name are
    public, but the raw phone number is NOT in the search response."""
    owner = User.objects.create(username="lister_api_owner", phone="+237699444007", first_name="API Owner")
    house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE")
    Listing.objects.create(property_asset=house, listed_by=owner, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))

    client = APIClient()
    response = client.get("/api/listings/")
    result = response.data["results"][0]
    assert result["lister_role"] == "OWNER"
    assert result["lister_display_name"] == "API Owner"
    assert "lister_phone" not in result
    assert "+237699444007" not in str(response.data)


@pytest.mark.django_db
def test_contact_endpoint_generates_a_real_whatsapp_link_and_requires_login(quarter):
    owner = User.objects.create(username="contact_owner", phone="+237699444008")
    house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=owner, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    interested_user = User.objects.create(username="contact_interested", phone="+237699444009")

    anon_response = APIClient().post(f"/api/listings/{listing.id}/contact/")
    assert anon_response.status_code == 401

    response = _auth_client(interested_user).post(f"/api/listings/{listing.id}/contact/")
    assert response.status_code == 200
    assert response.data["deep_link"].startswith("https://wa.me/237699444008")
    assert ActionLog.objects.filter(triggered_by=interested_user, target_id=listing.id).exists()


@pytest.mark.django_db
def test_property_description_is_the_short_text_shown_to_viewers(quarter):
    owner = User.objects.create(username="desc_owner", phone="+237699444010")
    house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE", description="Cozy 3-bedroom family home, quiet street, 5 min from the market.")
    Listing.objects.create(property_asset=house, listed_by=owner, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))

    client = APIClient()
    response = client.get("/api/listings/")
    assert response.data["results"][0]["property_asset"]["description"] == "Cozy 3-bedroom family home, quiet street, 5 min from the market."


@pytest.mark.django_db
def test_contact_uses_landlord_context_for_rent_but_seller_context_for_sale(quarter):
    """The terminology fix: a direct owner renting property out is
    correctly addressed as a landlord; the SAME kind of direct owner
    selling outright is correctly addressed as a seller, not a
    landlord — two different real-world relationships, two different
    contexts, not one blanket term."""
    from engagement.models import ActionLog, WhatsAppContext

    rent_owner = User.objects.create(username="terminology_rent_owner", phone="+237699444011")
    sale_owner = User.objects.create(username="terminology_sale_owner", phone="+237699444012")
    interested_user = User.objects.create(username="terminology_interested", phone="+237699444013")

    house_a = House.objects.create(owner=rent_owner, quarter=quarter, type="HOUSE")
    rent_listing = Listing.objects.create(property_asset=house_a, listed_by=rent_owner, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))

    house_b = House.objects.create(owner=sale_owner, quarter=quarter, type="HOUSE")
    sale_listing = Listing.objects.create(property_asset=house_b, listed_by=sale_owner, listing_type=ListingType.SALE, status=ListingStatus.PUBLISHED, price_xaf=Decimal("20000000"))

    client = _auth_client(interested_user)
    client.post(f"/api/listings/{rent_listing.id}/contact/")
    client.post(f"/api/listings/{sale_listing.id}/contact/")

    assert ActionLog.objects.filter(target_id=rent_listing.id, context=WhatsAppContext.CONTACT_LANDLORD).exists()
    assert ActionLog.objects.filter(target_id=sale_listing.id, context=WhatsAppContext.CONTACT_SELLER).exists()
    # And never the wrong way around.
    assert ActionLog.objects.filter(target_id=sale_listing.id, context=WhatsAppContext.CONTACT_LANDLORD).exists() is False
