"""Rentals: a deposit paid with the rent and held separately, rental dates, relisting and deposit return."""
import json
import pytest
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from django.utils import timezone

from identity.models import User, AdminProfile
from marketplace.models import MarketplaceListingBase, MarketplaceOrder, DepositStatus
from marketplace.services import rental_end_date, process_marketplace_orders
from monetization.models import Wallet
from notifications.models import Notification
from property_management.models import DisputeCase
from property_management.services import resolve_dispute
from transactions.models import EscrowStatus, BookingStatus
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import _order, _pending_order, fee_policy  # noqa: F401


def _listing(client, quarter, basis="RENT_MONTHLY", deposit="50000", price="100000"):
    response = client.post("/api/warehouses/", {
        "title": "Rental warehouse", "price_basis": basis, "price_xaf": price, "security_deposit_xaf": deposit,
        "quarter": str(quarter.id), "size_sqm": "300",
    }, format="json")
    return response


@pytest.fixture
def rental(quarter):
    seller = _verify(User.objects.create(username="rent_seller", phone="+237699700001"))
    buyer = _verify(User.objects.create(username="rent_buyer", phone="+237699700002"))
    created = _listing(_auth_client(seller), quarter)
    assert created.status_code == 201, created.data
    return seller, buyer, created.data["id"]


def _paid_order(rental):
    seller, buyer, listing_id = rental
    placed = _order(_auth_client(buyer), listing_id)
    assert placed.status_code == 200, placed.data
    return MarketplaceOrder.objects.get(pk=placed.data["id"])


def _completed_rental(rental):
    """Paid, handed over and confirmed: the rent is with the seller and the deposit is still held."""
    seller, buyer, _ = rental
    order = _paid_order(rental)
    assert _auth_client(seller).post(f"/api/marketplace-orders/{order.id}/hand-over/").status_code == 200
    assert _auth_client(buyer).post(f"/api/marketplace-orders/{order.id}/confirm/").status_code == 200
    order.refresh_from_db()
    return order


def _noon(day):
    return timezone.make_aware(datetime.combine(day, time(12, 0)))


def _listing_status(listing_id):
    return MarketplaceListingBase.objects.get(pk=listing_id).availability_status


@pytest.mark.django_db
def test_a_deposit_only_applies_to_rentals_and_cannot_be_negative(quarter):
    seller = _verify(User.objects.create(username="rent_validation", phone="+237699700010"))
    client = _auth_client(seller)
    assert _listing(client, quarter, basis="SALE", deposit="1000").status_code == 400
    assert _listing(client, quarter, deposit="-1").status_code == 400
    assert _listing(client, quarter, basis="SALE", deposit="0").status_code == 201
    assert _listing(client, quarter, basis="RENT_WEEKLY", deposit="25000").status_code == 201


@pytest.mark.django_db
def test_changing_a_listing_to_a_sale_is_blocked_while_it_has_a_deposit(rental):
    seller, _, listing_id = rental
    response = _auth_client(seller).patch(f"/api/warehouses/{listing_id}/", {"price_basis": "SALE"}, format="json")
    assert response.status_code == 400 and "security_deposit_xaf" in response.data


@pytest.mark.parametrize("basis,start,expected", [
    ("RENT_NIGHTLY", date(2026, 1, 31), date(2026, 2, 1)),
    ("RENT_WEEKLY", date(2026, 1, 31), date(2026, 2, 7)),
    ("RENT_MONTHLY", date(2026, 1, 31), date(2026, 2, 28)),
    ("RENT_MONTHLY", date(2026, 12, 15), date(2027, 1, 15)),
    ("RENT_ANNUAL", date(2024, 2, 29), date(2025, 2, 28)),
])
def test_rental_periods_end_on_the_right_day(basis, start, expected):
    assert rental_end_date(start, basis) == expected


def test_a_sale_has_no_rental_period():
    with pytest.raises(ValueError):
        rental_end_date(date(2026, 1, 1), "SALE")


@pytest.mark.django_db
def test_rent_and_deposit_are_paid_once_then_held_in_separate_escrows(rental):
    _, buyer, listing_id = rental
    pending = _pending_order(_auth_client(buyer), listing_id)
    assert pending.status_code == 202
    assert (pending.data["amount_xaf"], pending.data["deposit_xaf"], pending.data["total_xaf"]) == ("100000.00", "50000.00", "150000.00")
    assert pending.data["deposit_status"] == "NONE"
    order = MarketplaceOrder.objects.get(pk=pending.data["id"])
    assert order.booking.amount_xaf == Decimal("150000.00") and order.deposit_booking is None

    other_buyer = _verify(User.objects.create(username="rent_other", phone="+237699700003"))
    assert _order(_auth_client(other_buyer), listing_id).status_code == 409  # reserved by the pending order

    webhook = _auth_client(buyer).post(
        "/api/webhooks/payment/",
        data=json.dumps({"externalId": order.booking.idempotency_key, "transId": f"TEST-{order.booking.idempotency_key}", "status": "SUCCESSFUL"}),
        content_type="application/json",
    )
    assert webhook.status_code == 200
    order.refresh_from_db()

    assert order.status == "PAID" and order.deposit_status == DepositStatus.HELD
    rent_escrow, deposit_escrow = order.booking.escrow, order.deposit_booking.escrow
    assert (rent_escrow.gross_amount_xaf, rent_escrow.platform_fee_xaf, rent_escrow.payee_amount_xaf) == (
        Decimal("100000.00"), Decimal("5000.00"), Decimal("95000.00"))
    assert (deposit_escrow.gross_amount_xaf, deposit_escrow.platform_fee_xaf, deposit_escrow.payee_amount_xaf) == (
        Decimal("50000.00"), Decimal("0.00"), Decimal("50000.00"))
    assert rent_escrow.status == deposit_escrow.status == EscrowStatus.HELD
    assert order.deposit_booking.requester_id == buyer.id and order.deposit_booking.status == BookingStatus.CONFIRMED


@pytest.mark.django_db
def test_a_duplicate_payment_webhook_does_not_split_the_deposit_twice(rental):
    _, buyer, listing_id = rental
    order = _paid_order(rental)
    first_deposit = order.deposit_booking_id
    again = _auth_client(buyer).post(
        "/api/webhooks/payment/",
        data=json.dumps({"externalId": order.booking.idempotency_key, "transId": f"TEST-{order.booking.idempotency_key}", "status": "SUCCESSFUL"}),
        content_type="application/json",
    )
    assert again.status_code == 200
    order.refresh_from_db()
    assert order.deposit_booking_id == first_deposit
    assert order.booking.escrow.gross_amount_xaf == Decimal("100000.00")


@pytest.mark.django_db
def test_a_rental_without_a_deposit_behaves_like_before(quarter):
    seller = _verify(User.objects.create(username="rent_nodeposit_s", phone="+237699700020"))
    buyer = _verify(User.objects.create(username="rent_nodeposit_b", phone="+237699700021"))
    listing_id = _listing(_auth_client(seller), quarter, deposit="0").data["id"]
    order = MarketplaceOrder.objects.get(pk=_order(_auth_client(buyer), listing_id).data["id"])
    assert order.deposit_booking is None and order.deposit_status == DepositStatus.NONE
    assert order.booking.escrow.gross_amount_xaf == Decimal("100000.00")


@pytest.mark.django_db
def test_the_rental_period_starts_at_the_handover(rental):
    seller, buyer, _ = rental
    order = _paid_order(rental)
    assert order.rental_starts_on is None
    response = _auth_client(seller).post(f"/api/marketplace-orders/{order.id}/hand-over/")
    today = timezone.localdate()
    assert response.data["rental_starts_on"] == today.isoformat()
    assert response.data["rental_ends_on"] == rental_end_date(today, "RENT_MONTHLY").isoformat()


@pytest.mark.django_db
def test_confirming_pays_the_rent_but_keeps_the_deposit_held(rental):
    seller, _, listing_id = rental
    order = _completed_rental(rental)
    assert Wallet.objects.get(owner=seller).balance_xaf == Decimal("95000.00")
    assert order.deposit_booking.escrow.status == EscrowStatus.HELD and order.deposit_status == DepositStatus.HELD
    assert _listing_status(listing_id) == "UNAVAILABLE"
    assert order.deposit_xaf == Decimal("50000.00")


@pytest.mark.django_db
def test_the_seller_returns_the_deposit_and_the_listing_is_available_again(rental):
    seller, buyer, listing_id = rental
    order = _completed_rental(rental)
    url = f"/api/marketplace-orders/{order.id}/return-deposit/"

    assert _auth_client(buyer).post(url).status_code == 403
    assert _auth_client(User.objects.create(username="rent_stranger", phone="+237699700004")).post(url).status_code == 403
    response = _auth_client(seller).post(url)

    assert response.status_code == 200 and response.data["deposit_status"] == "RETURNED"
    order.refresh_from_db()
    assert order.deposit_booking.escrow.status == EscrowStatus.REFUNDED and order.deposit_settled_at is not None
    assert _listing_status(listing_id) == "AVAILABLE" and order.relisted_at is not None
    assert Notification.objects.filter(recipient=buyer, title="Your deposit was returned").exists()
    assert _auth_client(seller).post(url).status_code == 400
    assert _auth_client(seller).post(f"/api/marketplace-orders/{order.id}/claim-deposit/", {"reason": "Broken door"}, format="json").status_code == 400


@pytest.mark.django_db
def test_a_deposit_cannot_be_returned_or_claimed_before_the_rent_is_confirmed(rental):
    seller, _, _ = rental
    order = _paid_order(rental)
    base = f"/api/marketplace-orders/{order.id}"
    assert _auth_client(seller).post(f"{base}/return-deposit/").status_code == 400
    assert _auth_client(seller).post(f"{base}/claim-deposit/", {"reason": "Not yet returned"}, format="json").status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("outcome,deposit_status,escrow_status,seller_balance", [
    ("RELEASE", DepositStatus.FORFEITED, EscrowStatus.RELEASED, Decimal("145000.00")),
    ("REFUND", DepositStatus.RETURNED, EscrowStatus.REFUNDED, Decimal("95000.00")),
])
def test_a_claimed_deposit_is_decided_by_an_admin(rental, outcome, deposit_status, escrow_status, seller_balance):
    seller, buyer, listing_id = rental
    order = _completed_rental(rental)
    base = f"/api/marketplace-orders/{order.id}"

    assert _auth_client(buyer).post(f"{base}/claim-deposit/", {"reason": "Buyer cannot claim"}, format="json").status_code == 403
    assert _auth_client(seller).post(f"{base}/claim-deposit/", {"reason": "bad"}, format="json").status_code == 400
    claimed = _auth_client(seller).post(f"{base}/claim-deposit/", {"reason": "The door was broken"}, format="json")
    assert claimed.status_code == 200 and claimed.data["deposit_status"] == "CLAIMED"
    order.refresh_from_db()
    assert order.deposit_booking.escrow.status == EscrowStatus.DISPUTED
    assert _auth_client(seller).post(f"{base}/return-deposit/").status_code == 400  # frozen while claimed

    dispute = DisputeCase.objects.get(escrow=order.deposit_booking.escrow)
    resolve_dispute(dispute=dispute, outcome=outcome, notes="Reviewed")

    order.refresh_from_db()
    assert order.deposit_status == deposit_status and order.deposit_booking.escrow.status == escrow_status
    assert order.status == "COMPLETED"  # the rent decision is untouched
    assert Wallet.objects.get(owner=seller).balance_xaf == seller_balance
    assert _listing_status(listing_id) == "AVAILABLE"


@pytest.mark.django_db
def test_cancelling_before_the_handover_refunds_the_deposit_too(rental):
    seller, buyer, listing_id = rental
    order = _paid_order(rental)
    response = _auth_client(buyer).post(f"/api/marketplace-orders/{order.id}/cancel/")
    assert response.status_code == 200 and response.data["deposit_status"] == "RETURNED"
    order.refresh_from_db()
    assert order.booking.escrow.status == order.deposit_booking.escrow.status == EscrowStatus.REFUNDED
    assert order.deposit_booking.status == BookingStatus.CANCELLED
    assert _listing_status(listing_id) == "AVAILABLE"


@pytest.mark.django_db
def test_an_admin_refunding_a_disputed_rental_returns_the_deposit_and_releasing_keeps_it_held(rental):
    seller, buyer, _ = rental
    refunded = _paid_order(rental)
    assert _auth_client(buyer).post(f"/api/marketplace-orders/{refunded.id}/dispute/", {"reason": "Not as described"}, format="json").status_code == 200
    resolve_dispute(dispute=DisputeCase.objects.get(escrow=refunded.booking.escrow), outcome="REFUND")
    refunded.refresh_from_db()
    assert refunded.deposit_status == DepositStatus.RETURNED and refunded.deposit_booking.escrow.status == EscrowStatus.REFUNDED


@pytest.mark.django_db
def test_releasing_a_disputed_rental_pays_the_seller_and_the_deposit_stays_held(rental):
    seller, buyer, _ = rental
    order = _paid_order(rental)
    assert _auth_client(buyer).post(f"/api/marketplace-orders/{order.id}/dispute/", {"reason": "Seller unreachable"}, format="json").status_code == 200
    resolve_dispute(dispute=DisputeCase.objects.get(escrow=order.booking.escrow), outcome="RELEASE")
    order.refresh_from_db()
    assert order.status == "COMPLETED" and order.deposit_status == DepositStatus.HELD
    assert order.deposit_booking.escrow.status == EscrowStatus.HELD


@pytest.mark.django_db
def test_the_sweep_relists_when_the_rental_ends_then_returns_an_unclaimed_deposit(rental):
    seller, buyer, listing_id = rental
    order = _completed_rental(rental)
    ends = order.rental_ends_on

    assert process_marketplace_orders(now=_noon(ends))["relisted"] == []  # still within the last day
    assert _listing_status(listing_id) == "UNAVAILABLE"

    result = process_marketplace_orders(now=_noon(ends + timedelta(days=1)))
    assert [o.pk for o in result["relisted"]] == [order.pk] and result["deposits_returned"] == []
    assert _listing_status(listing_id) == "AVAILABLE"
    order.refresh_from_db()
    assert order.deposit_status == DepositStatus.HELD  # the seller can still claim it

    # Relisting happens once: a seller who pauses the listing again is not overridden.
    MarketplaceListingBase.objects.filter(pk=listing_id).update(availability_status="UNAVAILABLE")
    assert process_marketplace_orders(now=_noon(ends + timedelta(days=2)))["relisted"] == []
    assert _listing_status(listing_id) == "UNAVAILABLE"

    assert process_marketplace_orders(now=_noon(ends + timedelta(days=3)))["deposits_returned"] == []
    result = process_marketplace_orders(now=_noon(ends + timedelta(days=4)))
    assert [o.pk for o in result["deposits_returned"]] == [order.pk]
    order.refresh_from_db()
    assert order.deposit_status == DepositStatus.RETURNED and order.deposit_booking.escrow.status == EscrowStatus.REFUNDED
    assert Notification.objects.filter(recipient=buyer, title="Your deposit was returned").exists()
    assert process_marketplace_orders(now=_noon(ends + timedelta(days=9)))["deposits_returned"] == []


@pytest.mark.django_db
def test_the_sweep_never_returns_a_claimed_deposit_or_relists_a_removed_listing(rental):
    seller, buyer, listing_id = rental
    order = _completed_rental(rental)
    _auth_client(seller).post(f"/api/marketplace-orders/{order.id}/claim-deposit/", {"reason": "Water damage"}, format="json")
    MarketplaceListingBase.objects.filter(pk=listing_id).update(removed_by_moderation=True)

    result = process_marketplace_orders(now=_noon(order.rental_ends_on + timedelta(days=30)))

    assert result["relisted"] == [] and result["deposits_returned"] == []
    order.refresh_from_db()
    assert order.deposit_status == DepositStatus.CLAIMED and order.deposit_booking.escrow.status == EscrowStatus.DISPUTED
    assert _listing_status(listing_id) == "UNAVAILABLE"


@pytest.mark.django_db
def test_the_listing_deposit_is_locked_while_an_order_is_active(rental):
    seller, _, listing_id = rental
    _paid_order(rental)
    response = _auth_client(seller).patch(f"/api/warehouses/{listing_id}/", {"security_deposit_xaf": "1"}, format="json")
    assert response.status_code == 400 and "security_deposit_xaf" in response.data
    assert _auth_client(seller).patch(f"/api/warehouses/{listing_id}/", {"security_deposit_xaf": "50000"}, format="json").status_code == 200


@pytest.mark.django_db
def test_a_sale_never_collects_a_deposit(quarter):
    seller = _verify(User.objects.create(username="rent_sale_s", phone="+237699700030"))
    buyer = _verify(User.objects.create(username="rent_sale_b", phone="+237699700031"))
    listing_id = _listing(_auth_client(seller), quarter, basis="SALE", deposit="0", price="900000").data["id"]
    order = MarketplaceOrder.objects.get(pk=_order(_auth_client(buyer), listing_id).data["id"])
    assert order.deposit_xaf == 0 and order.deposit_booking is None
    assert _auth_client(seller).post(f"/api/marketplace-orders/{order.id}/hand-over/").data["rental_ends_on"] is None
