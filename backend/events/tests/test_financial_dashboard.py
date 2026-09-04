"""Tests for the Event Venue Financial Dashboard (A.4.2) — a real gap this closes."""
import pytest
from decimal import Decimal
from datetime import date, time

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from events.models import Venue, VenueSpace, EventType
from events.services import create_event_booking, get_venue_financial_dashboard


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Messassi District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Messassi")
    return Quarter.objects.create(village_or_district=village, name="Messassi")


@pytest.mark.django_db
def test_venue_financial_dashboard_reflects_real_bookings(quarter):
    owner = User.objects.create(username="fin_dash_venue_owner", phone="+237699888200")
    venue = Venue.objects.create(owner=owner, quarter=quarter, type="HOUSE")
    conference_space = VenueSpace.objects.create(venue=venue, space_name="Conference Hall", base_price_per_hour_xaf=Decimal("50000"))

    organiser = User.objects.create(username="fin_dash_organiser", phone="+237699888201")
    create_event_booking(
        organiser=organiser, venue_space=conference_space, event_type=EventType.CONFERENCE,
        event_date=date(2026, 9, 1), start_time=time(9, 0), end_time=time(12, 0), guest_count=50,
    )

    dashboard = get_venue_financial_dashboard(venue)

    assert dashboard["total_bookings"] == 1
    assert dashboard["bookings_trend"]["current_period_value"] == 1
    assert dashboard["revenue_trend_xaf"]["current_period_value"] == Decimal("150000")  # 3 hours * 50,000
