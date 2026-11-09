"""
Paid "TOP" boosts for marketplace listings, the main paid feature on Jiji: for the days bought the listing shows a
TOP badge and comes first in its category and on the All tab (default order). Prices are the admin-editable
BoostPricingTier rows for the MARKETPLACE_TOP placement; the seller pays from their Oaziland wallet or by Mobile
Money. Each purchase is also recorded as an AdCampaign so it shows up with the platform's other ad revenue.
"""
from datetime import timedelta
from decimal import Decimal

BOOST_UNITS = {"DAILY": 30, "MONTHLY": 3}  # unit -> most units in one purchase


class BoostError(Exception):
    pass


def boost_options() -> list[dict]:
    """The boost units on sale right now with their unit price, for the "Boost" dialog."""
    from monetization.models import BoostPricingTier, AdPlacement
    tiers = BoostPricingTier.objects.filter(placement=AdPlacement.MARKETPLACE_TOP, duration_unit__in=BOOST_UNITS)
    return [
        {"duration_unit": t.duration_unit, "unit_price_xaf": str(t.price_xaf), "max_quantity": BOOST_UNITS[t.duration_unit]}
        for t in sorted(tiers, key=lambda t: list(BOOST_UNITS).index(t.duration_unit))
    ]


def _pay_from_wallet(user, amount: Decimal, reference: str):
    from django.db import transaction as db_transaction
    from monetization.models import Wallet, WalletTransaction, WalletTransactionType
    with db_transaction.atomic():
        wallet, _ = Wallet.objects.select_for_update().get_or_create(owner=user)
        if wallet.balance_xaf < amount:
            raise BoostError(f"Your wallet has {wallet.balance_xaf:,.0f} XAF; this boost costs {amount:,.0f} XAF. Top up or pay by Mobile Money.")
        wallet.balance_xaf -= amount
        wallet.save(update_fields=["balance_xaf"])
        WalletTransaction.objects.create(
            wallet=wallet, transaction_type=WalletTransactionType.AD_SPEND, amount_xaf=amount, related_reference=reference,
        )


def boost_listing(*, listing, user, duration_unit: str, quantity: int, pay_with: str, phone_number: str = "", payment_gateway=None):
    """Charges for the boost, then extends the listing's TOP period (a boost bought while one is running adds on
    after it). Returns (listing, price)."""
    from django.utils import timezone
    from monetization.models import (
        AdCampaign, AdPlacement, BoostedContent, BOOST_DURATION_TIMEDELTA, PlatformFeePolicy, TransactionCategory,
    )
    from monetization.services import get_boost_price, purchase_campaign_boost
    from .engagement import is_expired
    from .models import MarketplaceListingBase, AvailabilityStatus

    if listing.lister_user_id != user.id:
        raise BoostError("Only the lister can boost this listing.")
    if listing.removed_by_moderation or listing.availability_status != AvailabilityStatus.AVAILABLE or is_expired(listing):
        raise BoostError("Only a live, available listing can be boosted. Renew it or mark it available first.")
    if duration_unit not in BOOST_UNITS or not 1 <= quantity <= BOOST_UNITS[duration_unit]:
        raise BoostError("Choose a valid boost length.")
    try:
        price = get_boost_price(placement=AdPlacement.MARKETPLACE_TOP, duration_unit=duration_unit, duration_quantity=quantity)
    except ValueError as e:
        raise BoostError(str(e))

    now = timezone.now()
    length = timedelta(**BOOST_DURATION_TIMEDELTA[duration_unit]) * quantity
    if pay_with == "WALLET":
        _pay_from_wallet(user, price, f"TOP boost: {listing.title}"[:255])
        fee = PlatformFeePolicy.fee_for(TransactionCategory.AD_SPEND, price)
        campaign = AdCampaign.objects.create(
            owner=user, placement=AdPlacement.MARKETPLACE_TOP, duration_unit=duration_unit, duration_quantity=quantity,
            budget_xaf=price - fee, starts_at=now, ends_at=now + length,
        )
        campaign.launch()
        BoostedContent.objects.create(campaign=campaign, listing_id=listing.pk)
    elif pay_with == "MOMO":
        if not phone_number.strip():
            raise BoostError("Enter the Mobile Money number to charge.")
        try:
            purchase_campaign_boost(
                owner=user, placement=AdPlacement.MARKETPLACE_TOP, duration_unit=duration_unit, duration_quantity=quantity,
                payment_gateway=payment_gateway, phone_number=phone_number.strip(), target_listing_id=listing.pk,
            )
        except ValueError as e:
            raise BoostError(str(e))
    else:
        raise BoostError("Choose how to pay.")

    listing.refresh_from_db(fields=["boosted_until"])
    start = listing.boosted_until if listing.boosted_until and listing.boosted_until > now else now
    MarketplaceListingBase.objects.filter(pk=listing.pk).update(boosted_until=start + length)
    listing.boosted_until = start + length
    return listing, price
