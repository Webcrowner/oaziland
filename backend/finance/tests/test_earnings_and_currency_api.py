"""Tests for the real finance API surfaces closed in this round: an
earnings report properly scoped to the requesting user (a real bug —
the underlying function accepted `user` but never filtered by it — was
fixed while wiring this endpoint), and display-only currency
conversion."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.models import Booking, BookingType, BookingStatus, Commission
from finance.models import ExchangeRateSnapshot


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
def test_earnings_report_only_includes_the_requesting_agents_own_commissions(quarter):
    """The real bug this proves fixed: previously `user` was accepted
    but never used to filter — every agent would have seen EVERY
    agent's commissions platform-wide."""
    agent_a = User.objects.create(username="finance_agent_a", phone="+237699830001")
    agent_b = User.objects.create(username="finance_agent_b", phone="+237699830002")
    buyer = User.objects.create(username="finance_buyer", phone="+237699830003")

    house_a = House.objects.create(owner=agent_a, quarter=quarter, type="HOUSE")
    listing_a = Listing.objects.create(property_asset=house_a, listed_by=agent_a, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    booking_a = Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing_a.id, requester=buyer, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="finance-a-1")
    Commission.objects.create(booking=booking_a, total_amount_xaf=Decimal("10000"), agent_share_xaf=Decimal("7000"))

    house_b = House.objects.create(owner=agent_b, quarter=quarter, type="HOUSE")
    listing_b = Listing.objects.create(property_asset=house_b, listed_by=agent_b, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("200000"))
    booking_b = Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing_b.id, requester=buyer, status=BookingStatus.COMPLETED, amount_xaf=Decimal("200000"), idempotency_key="finance-b-1")
    Commission.objects.create(booking=booking_b, total_amount_xaf=Decimal("20000"), agent_share_xaf=Decimal("14000"))

    response = _auth_client(agent_a).post("/api/my-earnings-report/", {"start_date": "2020-01-01", "end_date": "2030-01-01"})

    assert response.status_code == 200
    assert Decimal(response.data["total_commission_earned_xaf"]) == Decimal("7000")


@pytest.mark.django_db
def test_currency_conversion_endpoint():
    ExchangeRateSnapshot.objects.create(currency_code="USD", xaf_per_unit=Decimal("600"))
    response = APIClient().post("/api/currency-conversion/", {"amount_xaf": "60000", "currency_code": "USD"})
    assert response.status_code == 200
    assert Decimal(response.data["converted_amount"]) == Decimal("100.00")


@pytest.mark.django_db
def test_currency_conversion_endpoint_fails_clearly_without_a_rate():
    response = APIClient().post("/api/currency-conversion/", {"amount_xaf": "60000", "currency_code": "GBP"})
    assert response.status_code == 400
