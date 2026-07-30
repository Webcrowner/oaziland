"""
Tests proving Prompt 6's exact acceptance criteria: a test agency with two
agents closing deals gets the commission split correctly in each case,
and a direct landlord deal produces ZERO commission — not a zero-value row.
"""
import pytest
from decimal import Decimal
from datetime import timedelta

from identity.models import User, AgencyProfile, AgentProfile
from agency.models import Enquiry
from agency.services import (
    calculate_commission_split, create_commission_for_booking,
    agent_performance_score, add_agent_to_agency, remove_agent_from_agency,
    agency_roster, agency_aggregated_commission,
)
from transactions.models import Booking, BookingType, BookingStatus
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus, VerificationBadge, BadgeType


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def agency_with_two_agents(db):
    agency_user = User.objects.create(username="test_agency", phone="+237699500001")
    agency = AgencyProfile.objects.create(user=agency_user, registration_number="RC-TEST-001", agency_commission_percent=Decimal("30"))

    agent_one_user = User.objects.create(username="agent_one", phone="+237699500002")
    agent_one = AgentProfile.objects.create(user=agent_one_user, agency=agency, agent_commission_percent=Decimal("10"))

    agent_two_user = User.objects.create(username="agent_two", phone="+237699500003")
    agent_two = AgentProfile.objects.create(user=agent_two_user, agency=agency, agent_commission_percent=Decimal("8"))

    return agency, agent_one_user, agent_two_user


@pytest.mark.django_db
def test_commission_splits_correctly_between_two_different_agents(agency_with_two_agents, quarter):
    """Prompt 6's literal acceptance criteria: two agents under one
    agency, each closing a deal, each split correctly — and DIFFERENTLY,
    since they have different commission rates."""
    agency, agent_one, agent_two = agency_with_two_agents
    landlord = User.objects.create(username="commission_landlord", phone="+237699500004")

    house_one = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing_one = Listing.objects.create(property_asset=house_one, listed_by=agent_one, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    booking_one = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing_one.id,
        requester=User.objects.create(username="guest_a", phone="+237699500005"),
        status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="idem-a",
    )

    house_two = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing_two = Listing.objects.create(property_asset=house_two, listed_by=agent_two, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("200000"))
    booking_two = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing_two.id,
        requester=User.objects.create(username="guest_b", phone="+237699500006"),
        status=BookingStatus.COMPLETED, amount_xaf=Decimal("200000"), idempotency_key="idem-b",
    )

    commission_one = create_commission_for_booking(booking=booking_one, agent=agent_one)
    commission_two = create_commission_for_booking(booking=booking_two, agent=agent_two)

    # Agent one: 10% of 100,000 = 10,000 total. Agency takes 30% of that = 3,000. Agent keeps 7,000.
    assert commission_one.total_amount_xaf == Decimal("10000")
    assert commission_one.agency_share_xaf == Decimal("3000.00")
    assert commission_one.agent_share_xaf == Decimal("7000.00")

    # Agent two: 8% of 200,000 = 16,000 total. Agency takes 30% of that = 4,800. Agent keeps 11,200.
    assert commission_two.total_amount_xaf == Decimal("16000")
    assert commission_two.agency_share_xaf == Decimal("4800.00")
    assert commission_two.agent_share_xaf == Decimal("11200.00")

    # The two splits are genuinely different, proving each agent's own rate was used.
    assert commission_one.agent_share_xaf != commission_two.agent_share_xaf


@pytest.mark.django_db
def test_direct_landlord_deal_produces_zero_commission_rows(quarter):
    """Prompt 6's other literal acceptance criteria: NO commission record
    at all for a direct landlord deal — not a Commission row with zeros."""
    landlord = User.objects.create(username="direct_landlord", phone="+237699500007")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("150000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=User.objects.create(username="guest_c", phone="+237699500008"),
        status=BookingStatus.COMPLETED, amount_xaf=Decimal("150000"), idempotency_key="idem-c",
    )

    result = create_commission_for_booking(booking=booking, agent=None)

    assert result is None
    from transactions.models import Commission
    assert Commission.objects.filter(booking=booking).exists() is False  # genuinely zero rows, not a zero-value row


@pytest.mark.django_db
def test_agent_performance_score_computes_real_metrics(agency_with_two_agents, quarter):
    agency, agent_one, agent_two = agency_with_two_agents
    landlord = User.objects.create(username="perf_landlord", phone="+237699500009")
    client = User.objects.create(username="perf_client", phone="+237699500010")

    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=agent_one, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("90000"))
    VerificationBadge.objects.create(property_asset=house, badge_type=BadgeType.VERIFIED_DOCUMENT).approve(landlord)

    enquiry = Enquiry.objects.create(client=client, agent=agent_one, listing_id=listing.id)
    # Simulate the agent responding 10 minutes later.
    from django.utils import timezone
    enquiry.first_response_at = enquiry.created_at + timedelta(minutes=10)
    enquiry.save()

    score = agent_performance_score(agent_one)

    assert score["avg_response_time_minutes"] == 10.0
    assert score["percent_listings_verified"] == 100.0  # 1 of 1 listings has a verified badge


@pytest.mark.django_db
def test_agency_roster_add_remove_and_aggregated_commission(agency_with_two_agents, quarter):
    agency, agent_one, agent_two = agency_with_two_agents

    assert agency_roster(agency).count() == 2

    remove_agent_from_agency(agent=agent_one)
    assert agency_roster(agency).count() == 1
    assert agent_one.agent_profile.agency is None  # independent now, not deleted

    add_agent_to_agency(agent=agent_one, agency=agency)
    assert agency_roster(agency).count() == 2  # back on the roster

    # Aggregated commission starts at zero with no completed deals yet.
    assert agency_aggregated_commission(agency) == Decimal("0")
