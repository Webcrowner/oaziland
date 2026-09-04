"""
Tests for the shared analytics utility (compute_period_over_period,
top_n_by_aggregate) — the foundation every dashboard's trend data
relies on.
"""
import pytest
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from oaziland.analytics import compute_period_over_period, top_n_by_aggregate


@pytest.mark.django_db
def test_period_over_period_counts_correctly():
    now = timezone.now()
    # Create 3 users "this period" and 1 "last period" using date_joined.
    for i in range(3):
        u = User.objects.create(username=f"trend_recent_{i}", phone=f"+23769988800{i}")
        u.date_joined = now - timedelta(days=5)
        u.save()
    old_user = User.objects.create(username="trend_old_user", phone="+237699888004")
    old_user.date_joined = now - timedelta(days=45)
    old_user.save()

    result = compute_period_over_period(queryset=User.objects.filter(username__startswith="trend_"), date_field="date_joined", period_days=30, now=now)
    assert result["current_period_value"] == 3
    assert result["previous_period_value"] == 1
    assert result["percent_change"] == 200.0  # went from 1 to 3 = +200%


@pytest.mark.django_db
def test_percent_change_is_none_not_a_fabricated_number_with_no_prior_history():
    """The honest-uncertainty case: going from zero activity to some
    activity is not a real percentage — must report None, not an
    invented number like 0% or a nonsensical infinite jump."""
    now = timezone.now()
    # All activity happens in the CURRENT period only — genuinely zero
    # rows exist in the previous period.
    for i in range(4):
        u = User.objects.create(username=f"trend_only_recent_{i}", phone=f"+23769988801{i}")
        u.date_joined = now - timedelta(days=2)
        u.save()

    result = compute_period_over_period(queryset=User.objects.filter(username__startswith="trend_only_recent_"), date_field="date_joined", period_days=30, now=now)
    assert result["current_period_value"] == 4
    assert result["previous_period_value"] == 0
    assert result["percent_change"] is None  # honestly reported as "no history to compare," not fabricated


@pytest.mark.django_db
def test_top_n_by_aggregate_orders_correctly():
    from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
    from property.models import House, Listing, ListingType, ListingStatus

    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")

    landlord = User.objects.create(username="topn_landlord", phone="+237699888005")
    house_a = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    house_b = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    Listing.objects.create(property_asset=house_a, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("50000"))
    Listing.objects.create(property_asset=house_b, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("150000"))

    result = top_n_by_aggregate(queryset=Listing.objects.all(), group_by_field="property_asset__type", aggregate_field="price_xaf", n=5)
    assert result[0]["total"] == Decimal("200000")  # both HOUSE listings summed, since they share the group key
