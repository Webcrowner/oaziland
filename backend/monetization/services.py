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


def _withdrawal_fee(amount_xaf: Decimal) -> Decimal:
    """The WALLET_WITHDRAWAL platform fee for this amount, or 0 when no
    policy row has been configured yet."""
    try:
        fee = PlatformFeePolicy.fee_for(TransactionCategory.WALLET_WITHDRAWAL, amount_xaf)
    except PlatformFeePolicy.DoesNotExist:
        return Decimal("0")
    return fee.quantize(Decimal("0.01"))


class KycRequiredForWithdrawal(Exception):
    """Raised when someone whose identity is not approved tries to cash out."""

    MESSAGES = {
        "NONE": "Verify your identity (KYC) before withdrawing money.",
        "PENDING": "Your identity verification is still under review. You can withdraw once it is approved.",
        "REJECTED": "Your identity verification was rejected. Please resubmit your details before withdrawing.",
    }

    def __init__(self, kyc_status: str):
        self.kyc_status = kyc_status
        super().__init__(self.MESSAGES.get(kyc_status, "Your identity must be verified before you can withdraw money."))


def request_withdrawal(*, user, amount_xaf: Decimal, phone_number: str = "", provider: str = "MTN_MOMO") -> WithdrawalRequest:
    """Starts a cash-out request. Deliberately NOT auto-approved — see
    WithdrawalRequest's docstring. Only users whose identity (KYC) has
    been approved may withdraw. The wallet balance is reserved
    (deducted) immediately so the same funds can't be withdrawn twice
    while a request is pending. The wallet row is locked so two
    simultaneous requests can't both pass the balance check."""
    from identity.services import get_user_kyc_status
    kyc_status = get_user_kyc_status(user)
    if kyc_status != "VERIFIED":
        raise KycRequiredForWithdrawal(kyc_status)

    with db_transaction.atomic():
        wallet = Wallet.objects.select_for_update().get(pk=get_or_create_wallet(user).pk)
        if wallet.balance_xaf < amount_xaf:
            raise ValueError("Insufficient wallet balance for this withdrawal.")

        wallet.balance_xaf -= amount_xaf
        wallet.save(update_fields=["balance_xaf"])
        request = WithdrawalRequest.objects.create(
            wallet=wallet, amount_xaf=amount_xaf, phone_number=phone_number, provider=provider,
        )
        WalletTransaction.objects.create(
            wallet=wallet, transaction_type=WalletTransactionType.WITHDRAWAL,
            amount_xaf=amount_xaf, related_reference=str(request.id),
        )
    return request


def approve_withdrawal(*, withdrawal_request: WithdrawalRequest, reviewer=None):
    """An admin action (not automatic) — marks a pending withdrawal ready
    for payout and fixes the platform fee. The fee is applied at the
    point of payout, not at request time, since a rejected request
    shouldn't have ever charged a fee. Returns the fee."""
    from django.utils import timezone
    if withdrawal_request.status != WithdrawalStatus.PENDING:
        raise ValueError("Only a pending withdrawal can be approved.")
    fee = _withdrawal_fee(withdrawal_request.amount_xaf)
    withdrawal_request.status = WithdrawalStatus.APPROVED
    withdrawal_request.fee_xaf = fee
    withdrawal_request.reviewed_by = reviewer
    withdrawal_request.resolved_at = timezone.now()
    withdrawal_request.save(update_fields=["status", "fee_xaf", "reviewed_by", "resolved_at"])
    WalletTransaction.objects.filter(
        wallet=withdrawal_request.wallet, transaction_type=WalletTransactionType.WITHDRAWAL,
        related_reference=str(withdrawal_request.id),
    ).update(platform_fee_xaf=fee)
    return fee


def reject_withdrawal(*, withdrawal_request: WithdrawalRequest, reviewer, reason: str) -> WithdrawalRequest:
    """Declines a pending withdrawal and returns the reserved amount to
    the wallet as a REFUND entry, so the ledger shows both sides."""
    from django.utils import timezone
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("A reason is required to reject a withdrawal.")
    with db_transaction.atomic():
        locked = WithdrawalRequest.objects.select_for_update().get(pk=withdrawal_request.pk)
        if locked.status != WithdrawalStatus.PENDING:
            raise ValueError("Only a pending withdrawal can be rejected.")
        wallet = Wallet.objects.select_for_update().get(pk=locked.wallet_id)
        wallet.balance_xaf += locked.amount_xaf
        wallet.save(update_fields=["balance_xaf"])
        WalletTransaction.objects.create(
            wallet=wallet, transaction_type=WalletTransactionType.REFUND,
            amount_xaf=locked.amount_xaf, related_reference=str(locked.id),
        )
        locked.status = WithdrawalStatus.REJECTED
        locked.rejection_reason = reason
        locked.reviewed_by = reviewer
        locked.resolved_at = timezone.now()
        locked.save(update_fields=["status", "rejection_reason", "reviewed_by", "resolved_at"])
    return locked


def process_withdrawal_payout(*, withdrawal_request: WithdrawalRequest, phone_number: str = "", payment_gateway=None, reviewer=None):
    """Transfers the net amount (request minus the withdrawal fee) to the
    payee's Mobile Money (MTN MoMo / Orange Money) account using the
    payment gateway's disbursement rails, and marks the withdrawal
    PAID_OUT. If the gateway fails, everything rolls back and the request
    stays pending so the admin can retry; the request id is the gateway
    idempotency key, so a retry can never pay twice."""
    from payments.gateways import get_active_gateway
    from django.utils import timezone

    if payment_gateway is None:
        payment_gateway = get_active_gateway()

    with db_transaction.atomic():
        locked = WithdrawalRequest.objects.select_for_update().select_related("wallet__owner").get(pk=withdrawal_request.pk)
        if locked.status in (WithdrawalStatus.PAID_OUT, WithdrawalStatus.REJECTED):
            raise ValueError("This withdrawal has already been resolved.")
        if locked.status == WithdrawalStatus.PENDING:
            approve_withdrawal(withdrawal_request=locked, reviewer=reviewer)

        dest_phone = phone_number or locked.phone_number or getattr(locked.wallet.owner, "phone", "")
        if not dest_phone:
            raise ValueError("No payout phone number is on file for this withdrawal.")
        try:
            disburse_result = payment_gateway.initiate_disbursement(
                phone_number=dest_phone,
                amount_xaf=locked.net_amount_xaf,
                idempotency_key=str(locked.id),
            )
        except NotImplementedError as exc:
            raise ValueError(str(exc) or "Payouts are not available on the active payment gateway.") from exc
        if not disburse_result.success:
            raise ValueError("Disbursement failed via payment gateway.")

        locked.status = WithdrawalStatus.PAID_OUT
        locked.payout_reference = disburse_result.provider_reference or ""
        locked.resolved_at = timezone.now()
        locked.save(update_fields=["status", "payout_reference", "resolved_at"])
    return locked


def notify_admins_of_withdrawal(withdrawal_request: WithdrawalRequest) -> None:
    """Tells every admin a cash-out is waiting for review."""
    from identity.models import AdminProfile
    from notifications.services import notify
    owner = withdrawal_request.wallet.owner
    for admin_profile in AdminProfile.objects.select_related("user"):
        notify(
            recipient=admin_profile.user, notification_type="WITHDRAWAL_REQUESTED", channel="IN_APP",
            title="New withdrawal request",
            message=f"{owner.full_name or owner.username} asked to withdraw {withdrawal_request.amount_xaf} XAF.",
            related_reference=str(withdrawal_request.id),
        )


def notify_user_of_withdrawal_outcome(withdrawal_request: WithdrawalRequest) -> None:
    """Tells the requester whether their cash-out was paid or declined."""
    from notifications.services import notify
    owner = withdrawal_request.wallet.owner
    if withdrawal_request.status == WithdrawalStatus.PAID_OUT:
        title = "Withdrawal sent"
        message = f"{withdrawal_request.net_amount_xaf} XAF was sent to {withdrawal_request.phone_number or owner.phone}."
    elif withdrawal_request.status == WithdrawalStatus.REJECTED:
        title = "Withdrawal declined"
        message = (
            f"Your withdrawal of {withdrawal_request.amount_xaf} XAF was declined and returned to your wallet. "
            f"Reason: {withdrawal_request.rejection_reason}"
        )
    else:
        return
    notify(
        recipient=owner, notification_type=f"WITHDRAWAL_{withdrawal_request.status}", channel="IN_APP",
        title=title, message=message, related_reference=str(withdrawal_request.id),
    )


def get_boost_price(*, placement: str, duration_unit: str, duration_quantity: int) -> Decimal:
    """Looks up the per-unit price for a placement/duration combination
    and multiplies by how many units were purchased — e.g. DAILY at
    2,000 XAF/day × 3 days = 6,000 XAF."""
    from .models import BoostPricingTier
    try:
        tier = BoostPricingTier.objects.get(placement=placement, duration_unit=duration_unit)
    except BoostPricingTier.DoesNotExist:
        raise ValueError("This boost option is not available right now.") from None
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
