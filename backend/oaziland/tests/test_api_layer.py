"""
Tests proving Prompt 16's exact acceptance criteria and RBAC rules —
using DRF's real APIClient, making genuine HTTP-style requests through
the URL routing, permission classes, and throttling, not just calling
service functions directly.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, AdminProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus, FinishLevel


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_swagger_schema_is_actually_reachable():
    """The literal acceptance criteria: open Swagger and confirm it works."""
    client = APIClient()
    response = client.get("/api/schema/")
    assert response.status_code == 200
    assert b"openapi" in response.content.lower()

    docs_response = client.get("/api/docs/")
    assert docs_response.status_code == 200


@pytest.mark.django_db
def test_registration_and_login_flow():
    client = APIClient()
    register_response = client.post("/api/auth/register/", {
        "username": "api_new_user", "phone": "+237699998001", "password": "a-strong-password-123",
    })
    assert register_response.status_code == 201
    assert "password" not in register_response.data  # never echoed back

    login_response = client.post("/api/auth/login/", {"username": "api_new_user", "password": "a-strong-password-123"})
    assert login_response.status_code == 200
    assert "access" in login_response.data


@pytest.mark.django_db
def test_property_search_endpoint_returns_real_results(quarter):
    """The literal acceptance criteria: test the property search
    endpoint and confirm real results come back — no login required."""
    landlord = User.objects.create(username="api_landlord", phone="+237699998002")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", finish_level=FinishLevel.MODERN)
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("120000"))

    client = APIClient()  # no authentication — search must be public
    response = client.get(f"/api/listings/?quarter={quarter.id}")

    assert response.status_code == 200
    result_ids = [item["id"] for item in response.data["results"]]
    assert str(listing.id) in result_ids
    assert response.data["results"][0]["price_xaf"] == "120000.00"


@pytest.mark.django_db
def test_finish_level_filter_works_through_the_real_api(quarter):
    landlord = User.objects.create(username="api_landlord_2", phone="+237699998003")
    modern = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", finish_level=FinishLevel.MODERN)
    standard = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", finish_level=FinishLevel.STANDARD)
    Listing.objects.create(property_asset=modern, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("150000"))
    Listing.objects.create(property_asset=standard, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("60000"))

    client = APIClient()
    response = client.get(f"/api/listings/?quarter={quarter.id}&finish_level=MODERN")

    property_ids = [item["property_asset"]["id"] for item in response.data["results"]]
    assert str(modern.id) in property_ids
    assert str(standard.id) not in property_ids


@pytest.mark.django_db
def test_only_admin_can_approve_a_listing(quarter):
    """The RBAC matrix's explicit rule: only Admin can approve a listing."""
    landlord = User.objects.create(username="api_landlord_3", phone="+237699998004")
    ordinary_user = User.objects.create(username="api_ordinary_user", phone="+237699998005")
    admin_user = User.objects.create(username="api_admin_user", phone="+237699998006")
    AdminProfile.objects.create(user=admin_user)

    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PENDING_REVIEW, price_xaf=Decimal("100000"))

    ordinary_client = _auth_client(ordinary_user)
    denied_response = ordinary_client.post(f"/api/listings/{listing.id}/approve/")
    assert denied_response.status_code == 403

    admin_client = _auth_client(admin_user)
    approved_response = admin_client.post(f"/api/listings/{listing.id}/approve/")
    assert approved_response.status_code == 200
    listing.refresh_from_db()
    assert listing.status == ListingStatus.PUBLISHED


@pytest.mark.django_db
def test_only_the_bookings_own_requester_can_see_it(quarter):
    """Confirms a user's booking list is scoped to their OWN bookings,
    not the whole platform's."""
    landlord = User.objects.create(username="api_landlord_4", phone="+237699998007")
    guest_a = User.objects.create(username="api_guest_a", phone="+237699998008")
    guest_b = User.objects.create(username="api_guest_b", phone="+237699998009")

    from transactions.models import Booking, BookingType, BookingStatus
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id, requester=guest_a, status=BookingStatus.PENDING, amount_xaf=Decimal("100000"), idempotency_key="api-scope-test")

    guest_b_client = _auth_client(guest_b)
    response = guest_b_client.get("/api/bookings/")
    assert response.data["count"] == 0  # guest_b sees none of guest_a's bookings


@pytest.mark.django_db
def test_creating_a_listing_requires_mfa_and_kyc():
    """The API-layer mirror of the service-layer enforcement from
    Prompt 2 — a request should never even reach the service layer if
    it would be rejected there anyway."""
    unverified_user = User.objects.create(username="api_unverified_user", phone="+237699998010")
    client = _auth_client(unverified_user)

    response = client.post("/api/listings/", {"listing_type": "RENT", "price_xaf": "100000"})
    assert response.status_code == 403


@pytest.mark.django_db
def test_anonymous_search_requests_are_rate_limited(settings, monkeypatch):
    """Confirms the throttling configuration actually applies — sets an
    artificially low limit for the test so it doesn't take 60 real
    requests to prove the behavior.

    WHY cache.clear() is required here: DRF's throttle history is
    stored in Django's cache, keyed by client IP — NOT reset between
    tests automatically the way the database is. Without clearing it,
    earlier tests in this same file that also hit /api/listings/
    anonymously would leave behind throttle history that makes THIS
    test's very first request already look throttled — exactly the
    failure this fix corrects."""
    from django.core.cache import cache
    cache.clear()

    # setitem so the low limit is undone after this test instead of leaking into every later one.
    monkeypatch.setitem(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "search", "2/hour")
    client = APIClient()

    first = client.get("/api/listings/")
    second = client.get("/api/listings/")
    third = client.get("/api/listings/")

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429  # correctly throttled on the 3rd request
