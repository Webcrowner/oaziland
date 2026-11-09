from decimal import Decimal
from types import SimpleNamespace

import pytest
from rest_framework.test import APIClient

from identity.models import AdminProfile, KYCProfile, User, VerificationStatus
from monetization.models import (
    PlatformFeePolicy, TransactionCategory, WalletTransaction, WalletTransactionType, WithdrawalRequest, WithdrawalStatus,
)
from monetization.services import get_or_create_wallet
from notifications.models import Notification


def verify_identity(user, status=VerificationStatus.VERIFIED):
    return KYCProfile.objects.create(
        user=user, legal_full_name=user.username, date_of_birth="1990-01-01",
        national_id_number=f"ID-{user.username}", residential_address="Yaoundé", kyc_status=status,
    )


@pytest.fixture(autouse=True)
def withdrawal_fee_policy(db):
    PlatformFeePolicy.objects.update_or_create(
        category=TransactionCategory.WALLET_WITHDRAWAL, defaults={"fee_percent": Decimal("2.0")},
    )


@pytest.fixture
def earner(db):
    user = User.objects.create_user(
        username="wd_earner", email="wd_earner@example.com", phone="+237699100200", password="x-Strong-pass-1",
    )
    verify_identity(user)
    wallet = get_or_create_wallet(user)
    wallet.balance_xaf = Decimal("50000")
    wallet.save()
    return user


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="wd_admin", email="wd_admin@example.com", phone="+237699100201", password="x-Strong-pass-1",
    )
    AdminProfile.objects.create(user=admin)
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


def _request_withdrawal(user, amount=20000):
    client = APIClient()
    client.force_authenticate(user=user)
    res = client.post("/api/wallet/withdraw/", {"amount_xaf": amount, "phone_number": "+237699100200", "provider": "ORANGE_MONEY"})
    assert res.status_code == 202, res.data
    return WithdrawalRequest.objects.get(pk=res.data["withdrawal_id"])


@pytest.mark.django_db
@pytest.mark.parametrize("kyc_state, expected_status", [
    (None, "NONE"),
    (VerificationStatus.PENDING, "PENDING"),
    (VerificationStatus.REJECTED, "REJECTED"),
])
def test_unverified_users_cannot_withdraw(db, kyc_state, expected_status):
    user = User.objects.create_user(
        username="wd_unverified", email="wd_unverified@example.com", phone="+237699100300", password="x-Strong-pass-1",
    )
    if kyc_state:
        verify_identity(user, status=kyc_state)
    wallet = get_or_create_wallet(user)
    wallet.balance_xaf = Decimal("50000")
    wallet.save()
    client = APIClient()
    client.force_authenticate(user=user)

    res = client.post("/api/wallet/withdraw/", {"amount_xaf": 20000, "phone_number": "+237699100300", "provider": "MTN_MOMO"})

    assert res.status_code == 403
    assert res.data["code"] == "KYC_REQUIRED"
    assert res.data["kyc_status"] == expected_status
    assert WithdrawalRequest.objects.count() == 0
    assert get_or_create_wallet(user).balance_xaf == Decimal("50000")
    assert client.get("/api/wallet/").data["kyc_status"] == expected_status


@pytest.mark.django_db
def test_wallet_reports_verified_status_for_verified_users(earner):
    client = APIClient()
    client.force_authenticate(user=earner)

    assert client.get("/api/wallet/").data["kyc_status"] == "VERIFIED"


@pytest.mark.django_db
def test_requesting_a_withdrawal_reserves_funds_and_notifies_admins(earner, admin_client):
    admin = User.objects.get(username="wd_admin")
    withdrawal = _request_withdrawal(earner)

    assert withdrawal.status == WithdrawalStatus.PENDING
    assert withdrawal.provider == "ORANGE_MONEY"
    assert get_or_create_wallet(earner).balance_xaf == Decimal("30000")
    assert Notification.objects.filter(recipient=admin, notification_type="WITHDRAWAL_REQUESTED").count() == 1


@pytest.mark.django_db
def test_admin_queue_shows_the_decision_context(earner, admin_client):
    _request_withdrawal(earner)

    res = admin_client.get("/api/admin/withdrawals/?status=PENDING")

    assert res.status_code == 200
    row = res.data["results"][0] if "results" in res.data else res.data[0]
    assert row["user"]["username"] == "wd_earner"
    assert row["phone_number"] == "+237699100200"
    assert row["fee_xaf"] == "400.00"
    assert row["net_amount_xaf"] == "19600.00"
    assert row["kyc_status"] == "VERIFIED"
    assert Decimal(row["wallet_balance_xaf"]) == Decimal("30000")


@pytest.mark.django_db
def test_only_admins_can_use_the_withdrawal_queue(earner):
    withdrawal = _request_withdrawal(earner)
    client = APIClient()
    client.force_authenticate(user=earner)

    assert client.get("/api/admin/withdrawals/").status_code == 403
    assert client.post(f"/api/admin/withdrawals/{withdrawal.id}/approve/").status_code == 403
    withdrawal.refresh_from_db()
    assert withdrawal.status == WithdrawalStatus.PENDING


@pytest.mark.django_db
def test_approving_pays_out_the_net_amount_and_records_the_fee(earner, admin_client, monkeypatch):
    sent = {}

    class RecordingGateway:
        def initiate_disbursement(self, *, phone_number, amount_xaf, idempotency_key):
            sent.update(phone=phone_number, amount=amount_xaf, key=idempotency_key)
            return SimpleNamespace(success=True, provider_reference="PAYOUT-1", raw_provider_response={})

    monkeypatch.setattr("payments.gateways.get_active_gateway", lambda: RecordingGateway())
    withdrawal = _request_withdrawal(earner)

    res = admin_client.post(f"/api/admin/withdrawals/{withdrawal.id}/approve/")

    assert res.status_code == 200
    assert res.data["status"] == WithdrawalStatus.PAID_OUT
    assert res.data["reviewed_by_name"] == "wd_admin"
    assert sent == {"phone": "+237699100200", "amount": Decimal("19600.00"), "key": str(withdrawal.id)}
    withdrawal.refresh_from_db()
    assert withdrawal.fee_xaf == Decimal("400.00")
    assert withdrawal.payout_reference == "PAYOUT-1"
    ledger = WalletTransaction.objects.get(related_reference=str(withdrawal.id), transaction_type=WalletTransactionType.WITHDRAWAL)
    assert ledger.platform_fee_xaf == Decimal("400.00")
    assert Notification.objects.filter(recipient=earner, notification_type="WITHDRAWAL_PAID_OUT").exists()


@pytest.mark.django_db
def test_a_paid_withdrawal_cannot_be_paid_or_rejected_again(earner, admin_client):
    withdrawal = _request_withdrawal(earner)
    assert admin_client.post(f"/api/admin/withdrawals/{withdrawal.id}/approve/").status_code == 200

    assert admin_client.post(f"/api/admin/withdrawals/{withdrawal.id}/approve/").status_code == 400
    assert admin_client.post(f"/api/admin/withdrawals/{withdrawal.id}/reject/", {"reason": "Too late"}).status_code == 400
    assert get_or_create_wallet(earner).balance_xaf == Decimal("30000")


@pytest.mark.django_db
def test_a_gateway_failure_leaves_the_request_pending_so_it_can_be_retried(earner, admin_client, monkeypatch):
    class FailingGateway:
        def initiate_disbursement(self, *, phone_number, amount_xaf, idempotency_key):
            return SimpleNamespace(success=False, provider_reference="", raw_provider_response={})

    monkeypatch.setattr("payments.gateways.get_active_gateway", lambda: FailingGateway())
    withdrawal = _request_withdrawal(earner)

    res = admin_client.post(f"/api/admin/withdrawals/{withdrawal.id}/approve/")

    assert res.status_code == 400
    withdrawal.refresh_from_db()
    assert withdrawal.status == WithdrawalStatus.PENDING
    assert withdrawal.fee_xaf == Decimal("0")
    assert get_or_create_wallet(earner).balance_xaf == Decimal("30000")


@pytest.mark.django_db
def test_rejecting_refunds_the_wallet_and_tells_the_user_why(earner, admin_client):
    withdrawal = _request_withdrawal(earner)

    missing_reason = admin_client.post(f"/api/admin/withdrawals/{withdrawal.id}/reject/", {"reason": "  "})
    assert missing_reason.status_code == 400

    res = admin_client.post(f"/api/admin/withdrawals/{withdrawal.id}/reject/", {"reason": "Phone number does not match your ID"})

    assert res.status_code == 200
    assert res.data["status"] == WithdrawalStatus.REJECTED
    assert get_or_create_wallet(earner).balance_xaf == Decimal("50000")
    assert WalletTransaction.objects.filter(
        related_reference=str(withdrawal.id), transaction_type=WalletTransactionType.REFUND, amount_xaf=Decimal("20000"),
    ).exists()
    note = Notification.objects.get(recipient=earner, notification_type="WITHDRAWAL_REJECTED")
    assert "Phone number does not match your ID" in note.message


@pytest.mark.django_db
def test_console_summary_counts_pending_withdrawals(earner, admin_client):
    _request_withdrawal(earner)
    _request_withdrawal(earner, amount=5000)

    res = admin_client.get("/api/admin/console-summary/")

    assert res.status_code == 200
    assert res.data["pending_withdrawals"] == 2
