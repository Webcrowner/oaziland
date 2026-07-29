"""
monetization — advertising, the platform's revenue mechanism, agency
membership perks, and paid subscription tiers for agents/agencies.
Built per Prompt 8 / UML Section 8.
"""
import uuid
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


class AdCampaign(models.Model):
    """A paid promotion. Owned by ANY user — a landlord, an independent
    agent, or an agency — not just agencies, since a landlord advertising
    their own house is just as valid a use case."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ad_campaigns")
    placement = models.CharField(max_length=30, choices=AdPlacement.choices)
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
