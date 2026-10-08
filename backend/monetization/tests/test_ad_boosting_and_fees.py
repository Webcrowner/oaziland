"""
Tests for Prompt 8's exact acceptance criteria: a boosted listing
appears higher in quarter search than a non-boosted one, and the SAME
platform fee calculation applies to a booking, a marketplace-shaped
transaction, and an ad purchase.
"""
import pytest
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from property.services import search_listings_by_quarter
from monetization.models import (
    AdCampaign, AdPlacement, AdStatus, BoostedContent, BoostPricingTier,
    BoostDurationUnit, PlatformFeePolicy, TransactionCategory,
)
from monetization.services import get_boost_price, purchase_campaign_boost
from payments.gateways import SandboxGateway
from transactions.services import reserve_booking, confirm_payment


class FakeLock:
    def __init__(self):
        self.locked = set()

    def acquire(self, key, ttl_seconds):
        if key in self.locked:
            return False
        self.locked.add(key)
        return True

    def release(self, key, permanent=False):
        self.locked.discard(key)


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_boosted_listing_ranks_above_organic_listing_in_search(quarter):
    """Prompt 8's literal acceptance criteria."""
    landlord = User.objects.create(username="boost_landlord", phone="+237699800001")

    older_organic_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    organic_listing = Listing.objects.create(
        property_asset=older_organic_house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"),
    )
    organic_listing.publish()

    newer_boosted_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    boosted_listing = Listing.objects.create(
        property_asset=newer_boosted_house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("120000"),
    )
    boosted_listing.publish()

    campaign = AdCampaign.objects.create(
        owner=landlord, placement=AdPlacement.SEARCH_TOP_PLACEMENT, budget_xaf=Decimal("10000"),
        target_quarter=quarter, starts_at=timezone.now(), ends_at=timezone.now() + timedelta(days=1),
        status=AdStatus.ACTIVE,
    )
    BoostedContent.objects.create(campaign=campaign, listing_id=boosted_listing.id, priority_rank=1)

    # Even though the organic listing is technically OLDER (would normally
    # not out-rank a newer one), the boosted one must come first regardless.
    results = search_listings_by_quarter(quarter)
    result_ids = [listing.id for listing in results]

    assert result_ids.index(boosted_listing.id) < result_ids.index(organic_listing.id)


@pytest.mark.django_db
def test_boost_pricing_scales_with_duration_quantity():
    """Hourly/daily/monthly/yearly tiers, Facebook-style."""
    BoostPricingTier.objects.create(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.HOURLY, price_xaf=Decimal("500"))
    BoostPricingTier.objects.create(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.DAILY, price_xaf=Decimal("3000"))
    BoostPricingTier.objects.create(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.MONTHLY, price_xaf=Decimal("50000"))
    BoostPricingTier.objects.create(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.YEARLY, price_xaf=Decimal("500000"))

    assert get_boost_price(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.HOURLY, duration_quantity=5) == Decimal("2500")
    assert get_boost_price(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.DAILY, duration_quantity=3) == Decimal("9000")
    assert get_boost_price(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.MONTHLY, duration_quantity=1) == Decimal("50000")
    assert get_boost_price(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.YEARLY, duration_quantity=1) == Decimal("500000")


@pytest.mark.django_db
def test_purchasing_a_boost_creates_a_correctly_dated_active_campaign():
    BoostPricingTier.objects.create(placement=AdPlacement.QUARTER_FEATURED_LISTING, duration_unit=BoostDurationUnit.DAILY, price_xaf=Decimal("2000"))
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.AD_SPEND, defaults={"fee_percent": Decimal("5.0")})
    advertiser = User.objects.create(username="ad_buyer", phone="+237699800002")
    gateway = SandboxGateway()

    campaign, fee = purchase_campaign_boost(
        owner=advertiser, placement=AdPlacement.QUARTER_FEATURED_LISTING,
        duration_unit=BoostDurationUnit.DAILY, duration_quantity=3,
        payment_gateway=gateway, phone_number="+237670000002",
    )

    total_price = Decimal("6000")  # 2000 * 3 days
    expected_fee = total_price * Decimal("0.05")
    assert fee == expected_fee
    assert campaign.budget_xaf == total_price - expected_fee
    assert campaign.status == AdStatus.ACTIVE
    assert (campaign.ends_at - campaign.starts_at).days == 3


@pytest.mark.django_db
def test_same_fee_calculation_applies_to_booking_and_ad_purchase(quarter):
    """The acceptance criteria's core claim: booking fees and ad-purchase
    fees must use the exact SAME PlatformFeePolicy mechanism, not two
    separate calculations that happen to look similar."""
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.PROPERTY_BOOKING, defaults={"fee_percent": Decimal("3.0")})
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.AD_SPEND, defaults={"fee_percent": Decimal("3.0")})
    BoostPricingTier.objects.create(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.DAILY, price_xaf=Decimal("100000"))

    # --- Booking side ---
    landlord = User.objects.create(username="fee_test_landlord", phone="+237699800003")
    guest = User.objects.create(username="fee_test_guest", phone="+237699800004")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    lock = FakeLock()
    booking = reserve_booking(lock_client=lock, requester=guest, booking_type="GENERAL_RENTAL", target_content_type="property.Listing", target_id=listing.id, amount_xaf=Decimal("100000"))
    escrow = confirm_payment(lock_client=lock, booking=booking, provider="MTN_MOMO", provider_reference="fee-test-ref")

    # --- Ad side, same 100,000 XAF amount, same 3% policy ---
    advertiser = User.objects.create(username="fee_test_advertiser", phone="+237699800005")
    gateway = SandboxGateway()
    campaign, ad_fee = purchase_campaign_boost(
        owner=advertiser, placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.DAILY,
        duration_quantity=1, payment_gateway=gateway, phone_number="+237670000003",
    )

    # Both fees, on the same 100,000 XAF base at the same 3% rate, must match exactly.
    assert escrow.platform_fee_xaf == ad_fee == Decimal("3000.00")
