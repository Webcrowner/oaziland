"""
monetization.services — the wallet and gift-economy business logic.

WHY every function here goes through Wallet + WalletTransaction together,
never touching wallet.balance_xaf directly from outside this file: a
wallet balance that can be edited from anywhere is a wallet balance
nobody can trust. These functions are the ONLY sanctioned way money
moves in or out of a wallet.
"""
from decimal import Decimal
from datetime import timedelta
from django.db import transaction as db_transaction

from .models import (
    Wallet, WalletTransaction, WalletTransactionType, WithdrawalRequest,
    WithdrawalStatus, Gift, GIFT_POINT_VALUES, POINTS_TO_XAF_RATE,
    PlatformFeePolicy, TransactionCategory, BOOST_DURATION_TIMEDELTA,
)


def get_or_create_wallet(user) -> Wallet:
    wallet, _ = Wallet.objects.get_or_create(owner=user)
    return wallet


def recharge_wallet(*, user, amount_xaf: Decimal, payment_gateway, phone_number: str):
    """Adds money to a wallet via the same PaymentGateway interface the
    booking flow uses (Prompt 5) — recharging a wallet and paying for a
    booking are both 'take money from a Mobile Money account', so they
    reuse the exact same interface rather than a second payment pathway."""
    wallet = get_or_create_wallet(user)
    debit_result = payment_gateway.initiate_debit(
        phone_number=phone_number, amount_xaf=amount_xaf,
        idempotency_key=f"recharge-{wallet.id}-{amount_xaf}",
    )
    if not debit_result.success:
        raise ValueError("Wallet recharge payment failed.")

    with db_transaction.atomic():
        wallet.balance_xaf += amount_xaf
        wallet.save(update_fields=["balance_xaf"])
        WalletTransaction.objects.create(
            wallet=wallet, transaction_type=WalletTransactionType.RECHARGE,
            amount_xaf=amount_xaf, related_reference=debit_result.provider_reference,
        )
    return wallet


def send_gift(*, sender, recipient, gift_type: str, post=None, live_session=None) -> Gift:
    """Records a gift. Sending a gift does NOT immediately move money —
    it accumulates as points until the recipient chooses to convert them
    (convert_gift_to_wallet_balance below), matching how TikTok-style
    gifting actually works: gifts are a running points balance, cashed
    out on the recipient's own schedule."""
    point_value = GIFT_POINT_VALUES[gift_type]
    return Gift.objects.create(
        sender=sender, recipient=recipient, gift_type=gift_type,
        point_value=point_value, post=post, live_session=live_session,
    )


def convert_gifts_to_wallet_balance(*, user) -> Decimal:
    """Converts every one of a user's un-converted gifts into real wallet
    balance, applying the platform's GIFT_CONVERSION fee — the 'negligible
    percentage' the founder specified applies here exactly like it does
    on a booking. Returns the net XAF amount credited."""
    unconverted = Gift.objects.filter(recipient=user, converted_to_wallet=False)
    total_points = sum(g.point_value for g in unconverted)
    if total_points == 0:
        return Decimal("0")

    gross_xaf = Decimal(total_points) * POINTS_TO_XAF_RATE
    fee = PlatformFeePolicy.fee_for(TransactionCategory.GIFT_CONVERSION, gross_xaf)
    net_xaf = gross_xaf - fee

    wallet = get_or_create_wallet(user)
    with db_transaction.atomic():
        wallet.balance_xaf += net_xaf
        wallet.save(update_fields=["balance_xaf"])
        WalletTransaction.objects.create(
            wallet=wallet, transaction_type=WalletTransactionType.GIFT_PAYOUT,
            amount_xaf=net_xaf, platform_fee_xaf=fee,
            related_reference=f"{unconverted.count()} gifts converted",
        )
        unconverted.update(converted_to_wallet=True)
    return net_xaf


def fund_ad_campaign_from_wallet(*, user, campaign, amount_xaf: Decimal):
    """Pays for an ad campaign directly out of wallet balance — the
    'use gift earnings to run ads' requirement — instead of requiring a
    fresh Mobile Money charge every time someone wants to promote a post."""
    wallet = get_or_create_wallet(user)
    if wallet.balance_xaf < amount_xaf:
        raise ValueError("Insufficient wallet balance to fund this ad campaign.")

    with db_transaction.atomic():
        wallet.balance_xaf -= amount_xaf
        wallet.save(update_fields=["balance_xaf"])
        WalletTransaction.objects.create(
            wallet=wallet, transaction_type=WalletTransactionType.AD_SPEND,
            amount_xaf=amount_xaf, related_reference=str(campaign.id),
        )
        campaign.spent_so_far_xaf += amount_xaf
        campaign.save(update_fields=["spent_so_far_xaf"])
    return wallet


def request_withdrawal(*, user, amount_xaf: Decimal) -> WithdrawalRequest:
    """Starts a cash-out request. Deliberately NOT auto-approved — see
    WithdrawalRequest's docstring. The wallet balance is reserved
    (deducted) immediately so the same funds can't be withdrawn twice
    while a request is pending."""
    wallet = get_or_create_wallet(user)
    if wallet.balance_xaf < amount_xaf:
        raise ValueError("Insufficient wallet balance for this withdrawal.")

    with db_transaction.atomic():
        wallet.balance_xaf -= amount_xaf
        wallet.save(update_fields=["balance_xaf"])
        request = WithdrawalRequest.objects.create(wallet=wallet, amount_xaf=amount_xaf)
        WalletTransaction.objects.create(
            wallet=wallet, transaction_type=WalletTransactionType.WITHDRAWAL,
            amount_xaf=amount_xaf, related_reference=str(request.id),
        )
    return request


def approve_withdrawal(*, withdrawal_request: WithdrawalRequest):
    """An admin action (not automatic) — marks a withdrawal ready for
    real payout. Applies the WALLET_WITHDRAWAL platform fee at the point
    of payout, not at request time, since a rejected request shouldn't
    have ever charged a fee."""
    from django.utils import timezone
    fee = PlatformFeePolicy.fee_for(TransactionCategory.WALLET_WITHDRAWAL, withdrawal_request.amount_xaf)
    withdrawal_request.status = WithdrawalStatus.APPROVED
    withdrawal_request.resolved_at = timezone.now()
    withdrawal_request.save(update_fields=["status", "resolved_at"])
    return fee


def get_boost_price(*, placement: str, duration_unit: str, duration_quantity: int) -> Decimal:
    """Looks up the per-unit price for a placement/duration combination
    and multiplies by how many units were purchased — e.g. DAILY at
    2,000 XAF/day × 3 days = 6,000 XAF."""
    from .models import BoostPricingTier
    tier = BoostPricingTier.objects.get(placement=placement, duration_unit=duration_unit)
    return tier.price_xaf * duration_quantity


def purchase_campaign_boost(
    *, owner, placement: str, duration_unit: str, duration_quantity: int,
    payment_gateway, phone_number: str, target_quarter=None, target_property_type: str = "",
    target_post=None, target_listing_id=None,
):
    """Charges the advertiser for a boost (hourly/daily/monthly/yearly,
    Facebook-style) through the SAME PaymentGateway interface as every
    other payment in the platform, then applies the AD_SPEND platform
    fee via the SAME PlatformFeePolicy.fee_for() used for bookings — the
    literal 'same underlying calculation' the acceptance criteria asks
    for. The campaign's usable budget is the price paid MINUS the
    platform's fee, mirroring how a booking's payee_amount is gross
    minus fee.

    WHY target_post/target_listing_id matter, and were a real gap
    before this fix: AdPlacement.FEED_BOOSTED_POST existed as a choice,
    but nothing ever actually connected a purchased campaign to a
    SPECIFIC post or listing — a BoostedContent row (the thing the
    feed/search algorithms actually check) was never created here.
    A campaign existed, paid for, active — boosting nothing."""
    from django.utils import timezone
    from .models import AdCampaign, AdStatus, BoostedContent

    total_price = get_boost_price(placement=placement, duration_unit=duration_unit, duration_quantity=duration_quantity)

    debit_result = payment_gateway.initiate_debit(
        phone_number=phone_number, amount_xaf=total_price,
        idempotency_key=f"adboost-{owner.id}-{placement}-{timezone.now().timestamp()}",
    )
    if not debit_result.success:
        raise ValueError("Ad boost payment failed.")

    platform_fee = PlatformFeePolicy.fee_for(TransactionCategory.AD_SPEND, total_price)
    usable_budget = total_price - platform_fee

    duration_delta = timedelta(**BOOST_DURATION_TIMEDELTA[duration_unit])
    starts_at = timezone.now()

    campaign = AdCampaign.objects.create(
        owner=owner, placement=placement, duration_unit=duration_unit,
        duration_quantity=duration_quantity, budget_xaf=usable_budget,
        target_quarter=target_quarter, target_property_type=target_property_type,
        starts_at=starts_at, ends_at=starts_at + (duration_delta * duration_quantity),
    )
    campaign.launch()

    if target_post is not None or target_listing_id is not None:
        BoostedContent.objects.create(campaign=campaign, post=target_post, listing_id=target_listing_id)

    return campaign, platform_fee


# ---------------------------------------------------------------------------
# Creator premium subscription — a small, low-cost perk unlocking a
# checkmark, a small feed-ranking boost, and watermark-free downloads.
# Deliberately separate from SubscriptionTier, which is an agent/
# agency LISTING plan, not a general content-creator perk.
# ---------------------------------------------------------------------------
def subscribe_to_creator_premium(*, user, payment_gateway, phone_number: str, monthly_price_xaf: Decimal = Decimal("500")):
    """Charges through the SAME PaymentGateway interface as every
    other payment in the platform. Re-subscribing (or renewing) simply
    extends renews_at by another month from now, rather than stacking
    separate subscription rows — there is exactly one premium status
    per user at a time."""
    from django.utils import timezone
    from .models import CreatorPremiumSubscription

    debit_result = payment_gateway.initiate_debit(
        phone_number=phone_number, amount_xaf=monthly_price_xaf,
        idempotency_key=f"creator-premium-{user.id}-{timezone.now().timestamp()}",
    )
    if not debit_result.success:
        raise ValueError("Creator premium subscription payment failed.")

    subscription, _ = CreatorPremiumSubscription.objects.update_or_create(
        subscriber=user,
        defaults={
            "monthly_price_xaf": monthly_price_xaf,
            "renews_at": timezone.now() + timezone.timedelta(days=30),
            "cancelled_at": None,
        },
    )
    return subscription


def cancel_creator_premium(user):
    """WHY this doesn't delete the row or zero renews_at immediately:
    someone who already paid for this month should keep their perks
    until the period they paid for actually ends — cancelling just
    stops the NEXT renewal, exactly like cancelling any real
    subscription should work."""
    from django.utils import timezone
    from .models import CreatorPremiumSubscription

    try:
        subscription = CreatorPremiumSubscription.objects.get(subscriber=user)
    except CreatorPremiumSubscription.DoesNotExist:
        return None
    subscription.cancelled_at = timezone.now()
    subscription.save(update_fields=["cancelled_at"])
    return subscription


def is_premium_creator(user) -> bool:
    from .models import CreatorPremiumSubscription
    try:
        return user.creator_premium.is_active()
    except CreatorPremiumSubscription.DoesNotExist:
        return False
