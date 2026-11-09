"""Dispute decisions move real money: a full release pays the payee's wallet, a full refund pays the payer's
wallet, and a split divides the payment, with the platform fee charged only on the payee's share."""
from decimal import Decimal

import pytest

from identity.models import AdminProfile, User
from marketplace.tests.test_marketplace_api import _auth_client
from monetization.models import Wallet, WalletTransaction, WalletTransactionType
from notifications.models import Notification
from property.models import House, Listing, ListingStatus, ListingType
from property_management.models import DisputeStatus
from property_management.services import open_dispute, resolve_dispute
from property_management.tests.test_maintenance_leases_safety import quarter  # noqa: F401
from transactions.models import Booking, BookingStatus, BookingType, EscrowStatus, PaymentEscrow
from transactions.services import EscrowSettlementError, split_amounts
from trust_safety.models import AuditLog


@pytest.fixture
def people(db):
    landlord = User.objects.create(username="ds_landlord", phone="+237699510001")
    guest = User.objects.create(username="ds_guest", phone="+237699510002")
    admin = User.objects.create(username="ds_admin", phone="+237699510003")
    AdminProfile.objects.create(user=admin)
    return landlord, guest, admin


@pytest.fixture
def dispute(people, quarter):
    landlord, guest, _ = people
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(
        property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"),
    )
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("100000"), idempotency_key="ds-1",
    )
    escrow = PaymentEscrow.objects.create(
        booking=booking, gross_amount_xaf=Decimal("100000"), platform_fee_xaf=Decimal("5000"),
        payee_amount_xaf=Decimal("95000"), status=EscrowStatus.HELD, provider="MTN_MOMO",
    )
    return open_dispute(escrow=escrow, raised_by=guest, reason="Water was cut for two weeks")


def balance(user) -> Decimal:
    wallet = Wallet.objects.filter(owner=user).first()
    return wallet.balance_xaf if wallet else Decimal("0")


def test_split_amounts_charge_the_fee_only_on_the_payees_share(dispute):
    escrow = dispute.escrow
    assert split_amounts(escrow, 30000) == {
        "payer_xaf": Decimal("30000"), "payee_gross_xaf": Decimal("70000"), "fee_xaf": Decimal("3500"), "payee_xaf": Decimal("66500"),
    }
    assert split_amounts(escrow, 0)["fee_xaf"] == Decimal("5000")
    assert split_amounts(escrow, 100000)["fee_xaf"] == Decimal("0")
    assert split_amounts(escrow, 33333)["fee_xaf"] == Decimal("3333")  # rounded to the franc
    for bad in (-1, 100001, "12.5", "abc"):
        with pytest.raises(EscrowSettlementError):
            split_amounts(escrow, bad)


def test_a_split_pays_both_wallets_and_records_the_division(people, dispute):
    landlord, guest, _ = people

    resolve_dispute(dispute=dispute, outcome="SPLIT", payer_amount_xaf="30000", notes="Water cut for half the stay")

    escrow = PaymentEscrow.objects.get(pk=dispute.escrow.pk)
    assert escrow.status == EscrowStatus.RELEASED and escrow.released_at is not None
    assert (escrow.refunded_amount_xaf, escrow.platform_fee_xaf, escrow.payee_amount_xaf) == (Decimal("30000"), Decimal("3500"), Decimal("66500"))
    assert balance(guest) == Decimal("30000") and balance(landlord) == Decimal("66500")
    assert WalletTransaction.objects.get(wallet__owner=guest).transaction_type == WalletTransactionType.REFUND
    assert escrow.booking.status == BookingStatus.COMPLETED
    dispute.refresh_from_db()
    assert dispute.status == DisputeStatus.RESOLVED and dispute.resolution_notes == "Water cut for half the stay"
    for person in (guest, landlord):
        message = Notification.objects.get(recipient=person, notification_type="DISPUTE_RESOLVED").message
        assert "30000 XAF back to the payer" in message and "66500 XAF to the payee" in message and "Water cut" in message


def test_a_full_release_now_credits_the_landlords_wallet(people, dispute):
    landlord, guest, _ = people
    resolve_dispute(dispute=dispute, outcome="RELEASE")
    escrow = PaymentEscrow.objects.get(pk=dispute.escrow.pk)
    assert escrow.status == EscrowStatus.RELEASED and escrow.refunded_amount_xaf == 0
    assert balance(landlord) == Decimal("95000") and balance(guest) == 0


def test_a_full_refund_now_credits_the_payers_wallet_and_takes_no_fee(people, dispute):
    landlord, guest, _ = people
    resolve_dispute(dispute=dispute, outcome="REFUND")
    escrow = PaymentEscrow.objects.get(pk=dispute.escrow.pk)
    assert escrow.status == EscrowStatus.REFUNDED and escrow.refunded_amount_xaf == Decimal("100000") and escrow.platform_fee_xaf == 0
    assert balance(guest) == Decimal("100000") and balance(landlord) == 0
    assert escrow.booking.status == BookingStatus.CANCELLED


def test_money_moves_once_only(people, dispute):
    landlord, guest, _ = people
    resolve_dispute(dispute=dispute, outcome="SPLIT", payer_amount_xaf=40000)
    dispute.refresh_from_db()
    with pytest.raises(EscrowSettlementError):
        resolve_dispute(dispute=dispute, outcome="REFUND")
    assert balance(guest) == Decimal("40000")


def test_the_admin_api_splits_validates_and_audits(people, dispute):
    landlord, guest, admin = people
    client = _auth_client(admin)
    url = f"/api/admin/dispute-cases/{dispute.pk}/resolve/"

    for body in ({"outcome": "SPLIT"}, {"outcome": "SPLIT", "payer_amount_xaf": "0"}, {"outcome": "SPLIT", "payer_amount_xaf": "100000"},
                 {"outcome": "SPLIT", "payer_amount_xaf": "999999"}, {"outcome": "HALF"}):
        assert client.post(url, body, format="json").status_code == 400, body
    assert balance(guest) == balance(landlord) == 0

    response = client.post(url, {"outcome": "SPLIT", "payer_amount_xaf": "25000", "notes": "Partly as described"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["status"] == DisputeStatus.RESOLVED
    assert response.data["payment"]["refunded_xaf"] == "25000.00" and response.data["payment"]["payee_xaf"] == "71250.00"
    entry = AuditLog.objects.get(action="admin-dispute-case/resolve", status_code=200)
    assert entry.details["outcome"] == "SPLIT" and entry.details["payer_amount_xaf"] == "25000"

    # Ordinary users can't decide disputes.
    assert _auth_client(guest).post(url, {"outcome": "REFUND"}, format="json").status_code == 403


def test_payment_totals_count_each_part_of_a_split(people, dispute):
    from trust_safety.payments import payments_summary

    resolve_dispute(dispute=dispute, outcome="SPLIT", payer_amount_xaf=30000)
    totals = payments_summary(30)["totals"]
    assert totals["released_xaf"] == "70000.00" and totals["refunded_xaf"] == "30000.00" and totals["fees_xaf"] == "3500.00"
