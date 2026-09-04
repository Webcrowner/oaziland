"""
Tests for the generalized 'Looking For' reverse board — rooms, stores,
warehouses, businesses — covering both the service layer and the real
HTTP API.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from discovery.models import WantedCategory, WantedListingStatus
from discovery.services import post_wanted_listing, respond_to_wanted_listing, mark_wanted_listing_fulfilled, list_open_wanted_listings


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


@pytest.mark.django_db
def test_post_and_list_wanted_listings_by_category(quarter):
    student = User.objects.create(username="wanted_student", phone="+237699666001")
    trader = User.objects.create(username="wanted_trader", phone="+237699666002")

    post_wanted_listing(seeker=student, category=WantedCategory.ROOM_RENTAL, quarter=quarter, max_budget_xaf=Decimal("30000"), notes="Need a room near ICT University.")
    post_wanted_listing(seeker=trader, category=WantedCategory.WAREHOUSE, quarter=quarter, min_size_sqm=Decimal("500"), notes="Need warehouse space for imports.")

    rooms = list_open_wanted_listings(category=WantedCategory.ROOM_RENTAL)
    warehouses = list_open_wanted_listings(category=WantedCategory.WAREHOUSE)

    assert rooms.count() == 1
    assert warehouses.count() == 1
    assert rooms.first().seeker == student


@pytest.mark.django_db
def test_landlord_can_respond_and_seeker_can_mark_fulfilled(quarter):
    seeker = User.objects.create(username="wanted_seeker", phone="+237699666003")
    landlord = User.objects.create(username="wanted_landlord", phone="+237699666004")

    listing = post_wanted_listing(seeker=seeker, category=WantedCategory.STORE, quarter=quarter, notes="Need a small shop.")
    response = respond_to_wanted_listing(wanted_listing=listing, responder=landlord, message="I have exactly what you need in Bastos.")

    assert listing.responses.count() == 1
    assert response.responder == landlord

    mark_wanted_listing_fulfilled(listing)
    listing.refresh_from_db()
    assert listing.status == WantedListingStatus.FULFILLED

    # A fulfilled listing no longer shows in the open board.
    assert listing not in list_open_wanted_listings()


@pytest.mark.django_db
def test_api_board_is_public_but_responding_requires_login(quarter):
    seeker = User.objects.create(username="api_wanted_seeker", phone="+237699666005")
    agent = User.objects.create(username="api_wanted_agent", phone="+237699666006")

    from discovery.services import post_wanted_listing
    listing = post_wanted_listing(seeker=seeker, category=WantedCategory.BUSINESS, notes="Looking to buy an established bakery business.")

    anon_client = APIClient()
    list_response = anon_client.get("/api/wanted-listings/")
    assert list_response.status_code == 200
    assert list_response.data["count"] == 1

    denied_response = anon_client.post(f"/api/wanted-listings/{listing.id}/respond/", {"message": "I have one for sale."})
    assert denied_response.status_code == 401

    agent_client = _auth_client(agent)
    ok_response = agent_client.post(f"/api/wanted-listings/{listing.id}/respond/", {"message": "I have one for sale."})
    assert ok_response.status_code == 201


@pytest.mark.django_db
def test_only_the_original_seeker_can_mark_fulfilled_via_api(quarter):
    seeker = User.objects.create(username="api_fulfill_seeker", phone="+237699666007")
    impersonator = User.objects.create(username="api_fulfill_impersonator", phone="+237699666008")

    from discovery.services import post_wanted_listing
    listing = post_wanted_listing(seeker=seeker, category=WantedCategory.BUSINESS_AREA, notes="Need commercial space.")

    impersonator_client = _auth_client(impersonator)
    denied = impersonator_client.post(f"/api/wanted-listings/{listing.id}/mark_fulfilled/")
    assert denied.status_code == 403

    seeker_client = _auth_client(seeker)
    allowed = seeker_client.post(f"/api/wanted-listings/{listing.id}/mark_fulfilled/")
    assert allowed.status_code == 200
