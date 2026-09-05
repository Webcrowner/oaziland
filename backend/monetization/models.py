"""
monetization — advertising, the platform's revenue mechanism, agency
membership perks, and paid subscription tiers for agents/agencies.
Built per Prompt 8 / UML Section 8.
"""
import uuid
from decimal import Decimal
from django.conf import settings
from django.db import models


class AdPlacement(models.TextChoices):
    FEED_BOOSTED_POST = "FEED_BOOSTED_POST", "Boosted in Feed"
    SEARCH_TOP_PLACEMENT = "SEARCH_TOP_PLACEMENT", "Top of Search Results"
    QUARTER_FEATURED_LISTING = "QUARTER_FEATURED_LISTING", "Featured in Quarter"


class AdStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    ACTIVE = "ACTIVE", "Active"
    PAUSED = "PAUSED", "Paused"
    ENDED = "ENDED", "Ended"


class BoostDurationUnit(models.TextChoices):
    """WHY configurable tiers instead of 'pick any start/end date':
    Facebook-style boosting sells TIME in fixed units (an hour, a day, a
    month, a year) at a per-unit price — pricing a campaign is then just
    'unit price × how many units', not a free-form calendar picker with
    no relationship to cost."""
    HOURLY = "HOURLY", "Hourly"
    DAILY = "DAILY", "Daily"
    MONTHLY = "MONTHLY", "Monthly"
    YEARLY = "YEARLY", "Yearly"


BOOST_DURATION_TIMEDELTA = {
    BoostDurationUnit.HOURLY: {"hours": 1},
    BoostDurationUnit.DAILY: {"days": 1},
    BoostDurationUnit.MONTHLY: {"days": 30},   # a simple, explicit approximation — not a calendar-month edge case
    BoostDurationUnit.YEARLY: {"days": 365},
}


class BoostPricingTier(models.Model):
    """The price of ONE unit of boosting, per placement type. An admin-
    configurable table (not hardcoded prices in code) so pricing can
    change without a deployment. unique_together means each
    (placement, duration_unit) combination has exactly one price."""
    placement = models.CharField(max_length=30, choices=AdPlacement.choices)
    duration_unit = models.CharField(max_length=10, choices=BoostDurationUnit.choices)
    price_xaf = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        db_table = "boost_pricing_tiers"
        unique_together = [("placement", "duration_unit")]

    def __str__(self):
        return f"{self.get_placement_display()} / {self.get_duration_unit_display()}: {self.price_xaf} XAF"


class AdCampaign(models.Model):
    """A paid promotion. Owned by ANY user — a landlord, an independent
    agent, or an agency — not just agencies, since a landlord advertising
    their own house is just as valid a use case."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ad_campaigns")
    placement = models.CharField(max_length=30, choices=AdPlacement.choices)
    duration_unit = models.CharField(max_length=10, choices=BoostDurationUnit.choices, default=BoostDurationUnit.DAILY)
    duration_quantity = models.PositiveIntegerField(default=1)  # e.g. duration_unit=DAILY, quantity=3 -> a 3-day boost
    budget_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    spent_so_far_xaf = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    target_quarter = models.ForeignKey("geo.Quarter", on_delete=models.SET_NULL, null=True, blank=True)
    target_property_type = models.CharField(max_length=30, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=AdStatus.choices, default=AdStatus.DRAFT)

    class Meta:
        db_table = "ad_campaigns"
        indexes = [models.Index(fields=["status", "target_quarter"])]

    def launch(self):
        self.status = AdStatus.ACTIVE
        self.save(update_fields=["status"])

    def pause(self):
        self.status = AdStatus.PAUSED
        self.save(update_fields=["status"])

    def remaining_budget(self):
        """How much of this campaign's budget is left to spend — read by
        the ad-serving logic to stop showing an ad once its budget runs out."""
        return self.budget_xaf - self.spent_so_far_xaf


class BoostedContent(models.Model):
    """Wraps a Listing or Post, giving it a priority_rank in the feed while
    its parent AdCampaign is active. Kept separate from the campaign itself
    because one campaign could (later) boost more than one piece of content."""
    campaign = models.ForeignKey(AdCampaign, on_delete=models.CASCADE, related_name="boosted_items")
    listing_id = models.UUIDField(null=True, blank=True)
    post = models.ForeignKey("social.Post", on_delete=models.CASCADE, null=True, blank=True)
    priority_rank = models.PositiveSmallIntegerField(default=100)  # lower = shown higher

    class Meta:
        db_table = "boosted_content"


class AdImpression(models.Model):
    campaign = models.ForeignKey(AdCampaign, on_delete=models.CASCADE, related_name="impressions")
    viewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    shown_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ad_impressions"


class AdClick(models.Model):
    campaign = models.ForeignKey(AdCampaign, on_delete=models.CASCADE, related_name="clicks")
    clicker = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    clicked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ad_clicks"


class TransactionCategory(models.TextChoices):
    PROPERTY_BOOKING = "PROPERTY_BOOKING", "Property Booking"
    MARKETPLACE_SALE = "MARKETPLACE_SALE", "Marketplace Sale"
    SERVICE_PAYMENT = "SERVICE_PAYMENT", "Service Payment"
    AD_SPEND = "AD_SPEND", "Ad Spend"
    GIFT_CONVERSION = "GIFT_CONVERSION", "Gift-to-Cash Conversion"
    WALLET_WITHDRAWAL = "WALLET_WITHDRAWAL", "Wallet Withdrawal"
    RIDE_FARE = "RIDE_FARE", "Ride Fare"


class PlatformFeePolicy(models.Model):
    """ONE shared fee table for EVERY kind of money-moving transaction on
    the platform. WHY this matters: without it, a developer could easily
    end up hardcoding "take 2%" separately in four different places, and
    those four numbers could quietly drift out of sync over time. Here,
    changing the booking fee is one row edit, not a code change."""
    category = models.CharField(max_length=30, choices=TransactionCategory.choices, unique=True)
    fee_percent = models.DecimalField(max_digits=5, decimal_places=2)

    class Meta:
        db_table = "platform_fee_policies"

    @classmethod
    def fee_for(cls, category: str, gross_amount):
        """Looks up the fee percentage for a category and returns the fee
        amount. Centralizing this lookup here means every part of the
        platform computes the platform's cut identically."""
        policy = cls.objects.get(category=category)
        return gross_amount * (policy.fee_percent / 100)


class BenefitType(models.TextChoices):
    SHARED_LEAD_POOL = "SHARED_LEAD_POOL", "Shared Lead Pool"
    INHERITED_AGENCY_BADGE = "INHERITED_AGENCY_BADGE", "Inherited Agency Badge"
    MARKETING_SUPPORT = "MARKETING_SUPPORT", "Marketing Support"
    BULK_LISTING_TOOLS = "BULK_LISTING_TOOLS", "Bulk Listing Tools"
    TRAINING_RESOURCES = "TRAINING_RESOURCES", "Training Resources"


class AgencyBenefit(models.Model):
    """Answers 'why join this agency' concretely — attached per-agency so
    each one can offer a different mix of benefits, and a prospective agent
    can compare agencies before deciding to join one."""
    agency = models.ForeignKey("identity.AgencyProfile", on_delete=models.CASCADE, related_name="benefits")
    benefit_type = models.CharField(max_length=30, choices=BenefitType.choices)
    description = models.TextField(blank=True)

    class Meta:
        db_table = "agency_benefits"


class SubscriptionTierName(models.TextChoices):
    FREE = "FREE", "Free"
    BASIC = "BASIC", "Basic"
    PRO = "PRO", "Pro"
    FEATURED = "FEATURED", "Featured"


class SubscriptionTier(models.Model):
    """An agent/agency's paid plan, controlling how many active listings
    they can have and which visibility features they get — the
    Terres.cm-derived pricing model (roughly Free / 10k XAF Basic /
    35k XAF Pro / one-time Featured boosts)."""
    subscriber = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscription")
    tier = models.CharField(max_length=10, choices=SubscriptionTierName.choices, default=SubscriptionTierName.FREE)
    max_active_listings = models.PositiveIntegerField(default=2)  # Free tier default
    monthly_price_xaf = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    renews_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "subscription_tiers"


# ---------------------------------------------------------------------------
# Wallet & Gift economy.
#
# WHY Wallet lives here (monetization) and not in social, even though
# gifts are triggered by social interactions: a Wallet is a financial
# ledger — the same kind of thing PaymentEscrow already is — and it needs
# the exact same discipline (every change is a recorded WalletTransaction,
# never a silent balance edit). Keeping all money-handling code in one
# app makes it much easier to audit later.
# ---------------------------------------------------------------------------
class Wallet(models.Model):
    """One wallet per user. balance_xaf is never edited directly by
    calling code — always go through WalletTransaction / the services in
    monetization/services.py, so there's always a paper trail for where
    every franc came from or went."""
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wallet")
    balance_xaf = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        db_table = "wallets"


class WalletTransactionType(models.TextChoices):
    RECHARGE = "RECHARGE", "Recharge"
    GIFT_PAYOUT = "GIFT_PAYOUT", "Gift Payout"
    AD_SPEND = "AD_SPEND", "Ad Spend (funded from wallet)"
    WITHDRAWAL = "WITHDRAWAL", "Withdrawal"
    REFUND = "REFUND", "Refund"


class WalletTransaction(models.Model):
    """An immutable record of one wallet balance change. WHY immutable
    (never edited after creation): a financial ledger you can rewrite
    isn't really a ledger — if a mistake happens, it gets CORRECTED with
    a new, opposite transaction, the same way real accounting works, not
    by editing history."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    wallet = models.ForeignKey(Wallet, on_delete=models.CASCADE, related_name="transactions")
    transaction_type = models.CharField(max_length=20, choices=WalletTransactionType.choices)
    amount_xaf = models.DecimalField(max_digits=12, decimal_places=2)  # always positive; direction comes from transaction_type
    platform_fee_xaf = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    related_reference = models.CharField(max_length=255, blank=True)  # e.g. a Gift id, an AdCampaign id
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "wallet_transactions"
        indexes = [models.Index(fields=["wallet", "created_at"])]


class WithdrawalStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    APPROVED = "APPROVED", "Approved"
    PAID_OUT = "PAID_OUT", "Paid Out"
    REJECTED = "REJECTED", "Rejected"


class WithdrawalRequest(models.Model):
    """A request to cash OUT of the wallet to a real Mobile Money account.
    NOT auto-approved — real payout rails need a human/admin check before
    real money leaves the platform, at least until a real payout API is
    connected (flagged the same way the payment gateways were)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    wallet = models.ForeignKey(Wallet, on_delete=models.CASCADE, related_name="withdrawal_requests")
    amount_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=15, choices=WithdrawalStatus.choices, default=WithdrawalStatus.PENDING)
    requested_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)


class GiftType(models.TextChoices):
    ROSE = "ROSE", "Rose (100 pts)"
    HOUSE_KEY = "HOUSE_KEY", "House Key (500 pts)"
    DIAMOND = "DIAMOND", "Diamond (2000 pts)"


GIFT_POINT_VALUES = {
    GiftType.ROSE: 100,
    GiftType.HOUSE_KEY: 500,
    GiftType.DIAMOND: 2000,
}
POINTS_TO_XAF_RATE = Decimal("5")  # 1 point = 5 XAF before the platform fee — a simple, adjustable starting rate


class Gift(models.Model):
    """A sender sends a gift to a recipient, attached to a Post or a
    LiveSession. point_value is captured at send-time (not looked up
    later from GIFT_POINT_VALUES) so that if gift pricing changes later,
    a gift someone already received keeps the value it had when it was
    given — history shouldn't silently change under people's feet."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="gifts_sent")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="gifts_received")
    gift_type = models.CharField(max_length=20, choices=GiftType.choices)
    point_value = models.PositiveIntegerField()
    post = models.ForeignKey("social.Post", on_delete=models.SET_NULL, null=True, blank=True, related_name="gifts")
    live_session = models.ForeignKey("social.LiveSession", on_delete=models.SET_NULL, null=True, blank=True, related_name="gifts")
    converted_to_wallet = models.BooleanField(default=False)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "gifts"


class CreatorPremiumSubscription(models.Model):
    """A small, deliberately low-cost monthly subscription unlocking
    creator-side perks — distinct from SubscriptionTier above, which
    is specifically an agent/agency LISTING plan (max_active_listings,
    the Terres.cm pricing model). This is a general, per-user content
    perk: any user posting on the social side can subscribe, not just
    agents/agencies managing listings.

    WHY this only stores what the subscription itself needs, not a
    stored 'has_checkmark'/'boost_amount' pair: those are DERIVED from
    is_active below, computed fresh every time — a stored flag can
    drift out of sync (e.g. after the subscription silently expires);
    checking is_active() directly never can."""
    subscriber = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="creator_premium")
    monthly_price_xaf = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("500"))
    started_at = models.DateTimeField(auto_now_add=True)
    renews_at = models.DateTimeField()
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "creator_premium_subscriptions"

    def is_active(self) -> bool:
        from django.utils import timezone
        if self.cancelled_at is not None:
            return False
        return timezone.now() < self.renews_at
