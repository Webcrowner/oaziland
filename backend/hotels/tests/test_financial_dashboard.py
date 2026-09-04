"""Tests for the Hotel Financial Dashboard (B.4.2) — a real gap this closes."""
import pytest
from decimal import Decimal
from datetime import date

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from hotels.models import Hotel, RoomType, RoomCategory, Room, RoomStatus
from hotels.services import create_reservation, check_in_guest, get_hotel_financial_dashboard


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def hotel(db, quarter):
    owner = User.objects.create(username="fin_dash_hotel_owner", phone="+237699888100")
    return Hotel.objects.create(owner=owner, quarter=quarter, type="HOUSE")


@pytest.mark.django_db
def test_financial_dashboard_reflects_real_bookings_and_top_room_types(hotel):
    guest = User.objects.create(username="fin_dash_guest", phone="+237699888101")
    front_desk = User.objects.create(username="fin_dash_frontdesk", phone="+237699888102")

    deluxe = RoomType.objects.create(hotel=hotel, category=RoomCategory.DELUXE, capacity=2, base_rate_xaf=Decimal("80000"))
    standard = RoomType.objects.create(hotel=hotel, category=RoomCategory.STANDARD, capacity=2, base_rate_xaf=Decimal("40000"))
    Room.objects.create(hotel=hotel, room_type=deluxe, room_number="D1", status=RoomStatus.INSPECTED)

    reservation = create_reservation(hotel=hotel, guest=guest, room_type=deluxe, check_in=date(2026, 6, 1), check_out=date(2026, 6, 3))
    check_in_guest(reservation=reservation, assigned_by=front_desk)

    dashboard = get_hotel_financial_dashboard(hotel)

    assert dashboard["total_bookings"] == 1
    assert dashboard["bookings_trend"]["current_period_value"] == 1
    assert dashboard["revenue_trend_xaf"]["current_period_value"] == reservation.rate_xaf
    assert dashboard["top_room_types_by_revenue"][0]["room_type__category"] == RoomCategory.DELUXE
    assert dashboard["outstanding_balance_xaf"] >= Decimal("0")
