"""
Tests for public agent/agency profiles (real aggregated data, no
login required) and the private agent dashboard.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, AgentProfile, AgencyProfile, KYCProfile, VerificationStatus
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from social.models import Rating
from agency.services import get_agent_public_profile, get_agency_public_profile, get_agent_private_dashboard


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
    subdivision = Subdivision.objects.create(division=division, name="Messassi District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Messassi")
    return Quarter.objects.create(village_or_district=village, name="Messassi")


@pytest.mark.django_db
def test_agent_public_profile_reflects_real_data(quarter):
    agent_user = User.objects.create(username="profile_agent", phone="+237699777001", first_name="Foncham")
    AgentProfile.objects.create(user=agent_user, agent_commission_percent=Decimal("10"))
    KYCProfile.objects.create(user=agent_user, legal_full_name="Foncham Sebastien Abe", date_of_birth="1990-01-01", national_id_number="CM-AGENT-001", residential_address="Messassi", kyc_status=VerificationStatus.VERIFIED)

    house = House.objects.create(owner=agent_user, quarter=quarter, type="HOUSE")
    Listing.objects.create(property_asset=house, listed_by=agent_user, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    reviewer = User.objects.create(username="profile_reviewer", phone="+237699777002")
    Rating.objects.create(author=reviewer, subject_user=agent_user, score=5)

    profile = get_agent_public_profile(agent_user)
    assert profile["is_kyc_verified"] is True
    assert profile["active_listing_count"] == 1
    assert profile["average_rating"] == 5.0
    assert profile["rating_count"] == 1


@pytest.mark.django_db
def test_agency_public_profile_aggregates_across_roster(quarter):
    agency_user = User.objects.create(username="profile_agency", phone="+237699777003", first_name="Glorentech")
    agency = AgencyProfile.objects.create(user=agency_user, registration_number="RC-PROFILE-001", agency_commission_percent=Decimal("20"))

    agent_a = User.objects.create(username="profile_agent_a", phone="+237699777004")
    agent_b = User.objects.create(username="profile_agent_b", phone="+237699777005")
    AgentProfile.objects.create(user=agent_a, agency=agency, agent_commission_percent=Decimal("10"))
    AgentProfile.objects.create(user=agent_b, agency=agency, agent_commission_percent=Decimal("10"))

    house = House.objects.create(owner=agent_a, quarter=quarter, type="HOUSE")
    Listing.objects.create(property_asset=house, listed_by=agent_a, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))

    profile = get_agency_public_profile(agency)
    assert profile["agent_count"] == 2
    assert profile["active_listing_count"] == 1


@pytest.mark.django_db
def test_agent_private_dashboard_shows_agency_roster_for_owners(quarter):
    owner_user = User.objects.create(username="dashboard_owner", phone="+237699777006")
    agency = AgencyProfile.objects.create(user=owner_user, registration_number="RC-DASH-001", agency_commission_percent=Decimal("15"))
    AgentProfile.objects.create(user=owner_user, agency=agency, agent_commission_percent=Decimal("10"))

    dashboard = get_agent_private_dashboard(owner_user)
    assert dashboard["is_agency_owner"] is True
    assert "agency_roster" in dashboard
    assert "agency_aggregated_commission_xaf" in dashboard


@pytest.mark.django_db
def test_dashboard_api_is_private_and_scoped(quarter):
    agent_user = User.objects.create(username="api_dashboard_agent", phone="+237699777007")
    AgentProfile.objects.create(user=agent_user, agent_commission_percent=Decimal("10"))
    non_agent_user = User.objects.create(username="api_dashboard_nonagent", phone="+237699777008")

    anon_client = APIClient()
    assert anon_client.get("/api/my-agent-dashboard/").status_code == 401

    non_agent_client = _auth_client(non_agent_user)
    assert non_agent_client.get("/api/my-agent-dashboard/").status_code == 403

    agent_client = _auth_client(agent_user)
    response = agent_client.get("/api/my-agent-dashboard/")
    assert response.status_code == 200
    assert response.data["is_agency_owner"] is False


@pytest.mark.django_db
def test_public_profile_api_requires_no_authentication(quarter):
    agent_user = User.objects.create(username="api_public_profile_agent", phone="+237699777009")
    AgentProfile.objects.create(user=agent_user, agent_commission_percent=Decimal("10"))

    client = APIClient()  # no auth
    response = client.get(f"/api/agents/{agent_user.id}/profile/")
    assert response.status_code == 200


@pytest.mark.django_db
def test_agent_directory_lists_every_agent_with_real_aggregated_data(quarter):
    from rest_framework.test import APIClient
    agent_a = User.objects.create(username="directory_agent_a", phone="+237699888001", first_name="Directory Agent A")
    agent_b = User.objects.create(username="directory_agent_b", phone="+237699888002", first_name="Directory Agent B")
    AgentProfile.objects.create(user=agent_a, agent_commission_percent=Decimal("10"))
    AgentProfile.objects.create(user=agent_b, agent_commission_percent=Decimal("10"))

    response = APIClient().get("/api/agents/")
    assert response.status_code == 200
    assert response.data["count"] == 2
    names = {r["full_name"] for r in response.data["results"]}
    assert names == {"Directory Agent A", "Directory Agent B"}


@pytest.mark.django_db
def test_agency_directory_lists_every_agency(quarter):
    from rest_framework.test import APIClient
    agency_user = User.objects.create(username="directory_agency_user", phone="+237699888003", first_name="Directory Agency")
    AgencyProfile.objects.create(user=agency_user, registration_number="RC-DIRECTORY-001", agency_commission_percent=Decimal("15"))

    response = APIClient().get("/api/agencies/")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["agency_name"] == "Directory Agency"
