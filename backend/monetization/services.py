"""
monetization.services — the wallet and gift-economy business logic.

WHY every function here goes through Wallet + WalletTransaction together,
never touching wallet.balance_xaf directly from outside this file: a
wallet balance that can be edited from anywhere is a wallet balance
nobody can trust. These functions are the ONLY sanctioned way money
moves in or out of a wallet.
"""
from decimal import Decimal
from django.db import transaction as db_transaction

from .models import (
    Wallet, WalletTransaction, WalletTransactionType, WithdrawalRequest,
    WithdrawalStatus, Gift, GIFT_POINT_VALUES, POINTS_TO_XAF_RATE,
    PlatformFeePolicy, TransactionCategory,
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
