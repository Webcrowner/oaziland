"""
Tests for the wallet and gift economy: recharge, gift-to-cash conversion
(with the platform fee actually applied), funding ads from wallet
balance, and withdrawal requests.
"""
import pytest
from decimal import Decimal

from identity.models import User
from monetization.models import (
    Wallet, WalletTransactionType, Gift, GiftType, AdCampaign, AdPlacement,
    PlatformFeePolicy, TransactionCategory, WithdrawalStatus,
)
from monetization.services import (
    recharge_wallet, send_gift, convert_gifts_to_wallet_balance,
    fund_ad_campaign_from_wallet, request_withdrawal, approve_withdrawal,
    get_or_create_wallet,
)
from payments.gateways import SandboxGateway


@pytest.fixture
def sender(db):
    return User.objects.create(username="gift_sender", phone="+237699700001")


@pytest.fixture
def recipient(db):
    return User.objects.create(username="gift_recipient", phone="+237699700002")


@pytest.fixture
def gift_fee_policy(db):
    policy, _ = PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.GIFT_CONVERSION, defaults={"fee_percent": Decimal("5.0")})
    return policy


@pytest.mark.django_db
def test_recharge_wallet_via_payment_gateway(sender):
    """Proves wallet recharge reuses the SAME PaymentGateway interface
    the booking flow uses, not a separate payment pathway."""
    gateway = SandboxGateway()
    wallet = recharge_wallet(user=sender, amount_xaf=Decimal("10000"), payment_gateway=gateway, phone_number="+237670000001")

    assert wallet.balance_xaf == Decimal("10000")
    assert wallet.transactions.filter(transaction_type=WalletTransactionType.RECHARGE).count() == 1


@pytest.mark.django_db
def test_gift_sent_does_not_immediately_move_money(sender, recipient):
    """Gifts accumulate as points; money only moves when explicitly
    converted — matching how TikTok-style gifting actually works."""
    gift = send_gift(sender=sender, recipient=recipient, gift_type=GiftType.ROSE)

    assert gift.point_value == 100
    assert gift.converted_to_wallet is False
    # No wallet transaction should exist yet.
    wallet = get_or_create_wallet(recipient)
    assert wallet.transactions.count() == 0


@pytest.mark.django_db
def test_converting_gifts_applies_the_platform_fee(sender, recipient, gift_fee_policy):
    """This is the founder's explicit rule: 'for any money transaction,
    the app gets some negligible percentage.' Proves the fee is actually
    deducted, not just defined somewhere unused."""
    send_gift(sender=sender, recipient=recipient, gift_type=GiftType.HOUSE_KEY)  # 500 points
    send_gift(sender=sender, recipient=recipient, gift_type=GiftType.ROSE)       # 100 points
    # Total: 600 points * 5 XAF/point = 3000 XAF gross

    net_credited = convert_gifts_to_wallet_balance(user=recipient)

    gross = Decimal("3000")
    expected_fee = gross * Decimal("0.05")  # 5% fee policy
    expected_net = gross - expected_fee

    assert net_credited == expected_net
    wallet = get_or_create_wallet(recipient)
    assert wallet.balance_xaf == expected_net

    payout_txn = wallet.transactions.get(transaction_type=WalletTransactionType.GIFT_PAYOUT)
    assert payout_txn.platform_fee_xaf == expected_fee

    # Converted gifts must not be converted again.
    all_gifts_converted = Gift.objects.filter(recipient=recipient, converted_to_wallet=False).count()
    assert all_gifts_converted == 0


@pytest.mark.django_db
def test_double_conversion_does_not_double_pay(sender, recipient, gift_fee_policy):
    """A user converting twice in a row with no new gifts in between
    should get nothing the second time — proves converted gifts are
    correctly excluded from future conversions."""
    send_gift(sender=sender, recipient=recipient, gift_type=GiftType.ROSE)
    first_conversion = convert_gifts_to_wallet_balance(user=recipient)
    second_conversion = convert_gifts_to_wallet_balance(user=recipient)

    assert first_conversion > Decimal("0")
    assert second_conversion == Decimal("0")


@pytest.mark.django_db
def test_fund_ad_campaign_from_wallet_balance(sender, recipient, gift_fee_policy):
    """The founder's 'use gift earnings to run ads' requirement."""
    send_gift(sender=sender, recipient=recipient, gift_type=GiftType.DIAMOND)  # 2000 points
    convert_gifts_to_wallet_balance(user=recipient)
    wallet = get_or_create_wallet(recipient)
    balance_before = wallet.balance_xaf

    from django.utils import timezone
    from datetime import timedelta
    campaign = AdCampaign.objects.create(
        owner=recipient, placement=AdPlacement.FEED_BOOSTED_POST, budget_xaf=Decimal("5000"),
        starts_at=timezone.now(), ends_at=timezone.now() + timedelta(days=7),
    )

    fund_ad_campaign_from_wallet(user=recipient, campaign=campaign, amount_xaf=Decimal("1000"))

    wallet.refresh_from_db()
    campaign.refresh_from_db()
    assert wallet.balance_xaf == balance_before - Decimal("1000")
    assert campaign.spent_so_far_xaf == Decimal("1000")


@pytest.mark.django_db
def test_cannot_fund_ad_beyond_wallet_balance(recipient):
    from django.utils import timezone
    from datetime import timedelta
    campaign = AdCampaign.objects.create(
        owner=recipient, placement=AdPlacement.FEED_BOOSTED_POST, budget_xaf=Decimal("50000"),
        starts_at=timezone.now(), ends_at=timezone.now() + timedelta(days=7),
    )
    with pytest.raises(ValueError):
        fund_ad_campaign_from_wallet(user=recipient, campaign=campaign, amount_xaf=Decimal("50000"))


@pytest.mark.django_db
def test_withdrawal_request_reserves_balance_and_requires_approval(recipient, gift_fee_policy):
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.WALLET_WITHDRAWAL, defaults={"fee_percent": Decimal("2.0")})
    wallet = get_or_create_wallet(recipient)
    wallet.balance_xaf = Decimal("20000")
    wallet.save()

    request = request_withdrawal(user=recipient, amount_xaf=Decimal("15000"))
    wallet.refresh_from_db()

    assert request.status == WithdrawalStatus.PENDING
    assert wallet.balance_xaf == Decimal("5000")  # reserved immediately, not left available to spend twice

    fee = approve_withdrawal(withdrawal_request=request)
    request.refresh_from_db()
    assert request.status == WithdrawalStatus.APPROVED
    assert fee == Decimal("300")  # 2% of 15,000
