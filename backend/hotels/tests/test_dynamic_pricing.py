"""
Tests for the dynamic pricing engine (B.1.2) — every rule applied
individually and in combination, so the pricing formula's actual
behavior is proven, not just that it runs without error.
"""
import pytest
from decimal import Decimal
from datetime import date

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from hotels.models import Hotel, RoomType, RoomCategory, SeasonalRate, EventPremiumPeriod
from hotels.services import compute_dynamic_rate


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
    owner = User.objects.create(username="pricing_hotel_owner", phone="+237699222001")
    return Hotel.objects.create(owner=owner, quarter=quarter, type="HOUSE")


@pytest.fixture
def room_type(hotel):
    return RoomType.objects.create(hotel=hotel, category=RoomCategory.STANDARD, capacity=2, base_rate_xaf=Decimal("50000"))


@pytest.mark.django_db
def test_base_rate_with_low_occupancy_and_no_weekend(room_type):
    """A Tuesday-Wednesday stay at low occupancy — no premiums should apply."""
    result = compute_dynamic_rate(
        room_type=room_type, check_in=date(2026, 6, 2), check_out=date(2026, 6, 3),  # Tuesday
        occupancy_rate=Decimal("0.5"),
    )
    assert result["nightly_breakdown"][0]["rate_xaf"] == Decimal("50000")
    assert result["nightly_breakdown"][0]["weekend_premium_applied"] is False


@pytest.mark.django_db
def test_occupancy_tiers_correctly_escalate(room_type):
    low = compute_dynamic_rate(room_type=room_type, check_in=date(2026, 6, 2), check_out=date(2026, 6, 3), occupancy_rate=Decimal("0.5"))
    tier_70 = compute_dynamic_rate(room_type=room_type, check_in=date(2026, 6, 2), check_out=date(2026, 6, 3), occupancy_rate=Decimal("0.72"))
    tier_85 = compute_dynamic_rate(room_type=room_type, check_in=date(2026, 6, 2), check_out=date(2026, 6, 3), occupancy_rate=Decimal("0.90"))
    tier_95 = compute_dynamic_rate(room_type=room_type, check_in=date(2026, 6, 2), check_out=date(2026, 6, 3), occupancy_rate=Decimal("0.97"))

    assert low["total_xaf"] < tier_70["total_xaf"] < tier_85["total_xaf"] < tier_95["total_xaf"]


@pytest.mark.django_db
def test_weekend_premium_applies_friday_through_sunday(room_type):
    # 2026-06-05 is a Friday, 2026-06-08 is a Monday — 3 weekend nights, 0 weekday.
    result = compute_dynamic_rate(
        room_type=room_type, check_in=date(2026, 6, 5), check_out=date(2026, 6, 8), occupancy_rate=Decimal("0.5"),
    )
    assert all(night["weekend_premium_applied"] for night in result["nightly_breakdown"])


@pytest.mark.django_db
def test_event_premium_applies_within_seven_days(room_type, hotel):
    EventPremiumPeriod.objects.create(hotel=hotel, event_name="ICT University Graduation", event_date=date(2026, 6, 10))

    within_window = compute_dynamic_rate(room_type=room_type, check_in=date(2026, 6, 8), check_out=date(2026, 6, 9), occupancy_rate=Decimal("0.5"))
    outside_window = compute_dynamic_rate(room_type=room_type, check_in=date(2026, 7, 1), check_out=date(2026, 7, 2), occupancy_rate=Decimal("0.5"))

    assert within_window["nightly_breakdown"][0]["event_premium_applied"] is True
    assert outside_window["nightly_breakdown"][0]["event_premium_applied"] is False
    assert within_window["total_xaf"] > outside_window["total_xaf"]


@pytest.mark.django_db
def test_seasonal_rate_applied_correctly(room_type, hotel):
    SeasonalRate.objects.create(hotel=hotel, season_name="Dry Season", start_month=11, start_day=15, end_month=3, end_day=15, multiplier=Decimal("1.20"))

    in_season = compute_dynamic_rate(room_type=room_type, check_in=date(2026, 12, 1), check_out=date(2026, 12, 2), occupancy_rate=Decimal("0.5"))
    out_of_season = compute_dynamic_rate(room_type=room_type, check_in=date(2026, 7, 1), check_out=date(2026, 7, 2), occupancy_rate=Decimal("0.5"))

    assert in_season["total_xaf"] > out_of_season["total_xaf"]


@pytest.mark.django_db
def test_length_of_stay_discount_tiers(room_type):
    from datetime import timedelta
    check_in = date(2026, 6, 1)

    short_stay = compute_dynamic_rate(room_type=room_type, check_in=check_in, check_out=check_in + timedelta(days=3), occupancy_rate=Decimal("0.5"))
    week_stay = compute_dynamic_rate(room_type=room_type, check_in=check_in, check_out=check_in + timedelta(days=7), occupancy_rate=Decimal("0.5"))
    two_week_stay = compute_dynamic_rate(room_type=room_type, check_in=check_in, check_out=check_in + timedelta(days=14), occupancy_rate=Decimal("0.5"))
    four_week_stay = compute_dynamic_rate(room_type=room_type, check_in=check_in, check_out=check_in + timedelta(days=28), occupancy_rate=Decimal("0.5"))

    assert short_stay["length_of_stay_discount_rate"] == Decimal("0.00")
    assert week_stay["length_of_stay_discount_rate"] == Decimal("0.10")
    assert two_week_stay["length_of_stay_discount_rate"] == Decimal("0.15")
    assert four_week_stay["length_of_stay_discount_rate"] == Decimal("0.20")


@pytest.mark.django_db
def test_last_minute_booking_adjustment(room_type):
    from django.utils import timezone
    from datetime import timedelta

    booking_time = timezone.now()
    last_minute = compute_dynamic_rate(
        room_type=room_type, check_in=(booking_time + timedelta(hours=24)).date(), check_out=(booking_time + timedelta(hours=48)).date(),
        occupancy_rate=Decimal("0.5"), booking_made_at=booking_time,
    )
    advance_booked = compute_dynamic_rate(
        room_type=room_type, check_in=(booking_time + timedelta(days=30)).date(), check_out=(booking_time + timedelta(days=31)).date(),
        occupancy_rate=Decimal("0.5"), booking_made_at=booking_time,
    )
    assert last_minute["last_minute_adjustment_applied"] is True
    assert advance_booked["last_minute_adjustment_applied"] is False


def test_invalid_date_range_rejected():
    from hotels.services import compute_dynamic_rate
    class FakeRoomType:
        base_rate_xaf = Decimal("50000")
        hotel = None
    with pytest.raises(ValueError):
        compute_dynamic_rate(room_type=FakeRoomType(), check_in=date(2026, 6, 5), check_out=date(2026, 6, 5), occupancy_rate=Decimal("0.5"))
