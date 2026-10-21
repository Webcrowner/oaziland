"""Buying or renting a marketplace listing: the money waits in escrow until the buyer confirms."""
import pytest
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from django.core.management import call_command
from django.utils import timezone

from identity.models import User, KYCProfile, VerificationStatus
from marketplace.models import WarehouseListing, MarketplaceOrder, MarketplaceOrderStatus
from marketplace.services import dispute_order, process_marketplace_orders
from monetization.models import PlatformFeePolicy, TransactionCategory, Wallet
from notifications.models import Notification
from property_management.services import resolve_dispute
from transactions.models import EscrowStatus
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401

PHONE = "670000000"


@pytest.fixture(autouse=True)
def fee_policy(db):
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.MARKETPLACE_SALE, defaults={"fee_percent": Decimal("5.0")})


@pytest.fixture
def deal(quarter):
    seller = _verify(User.objects.create(username="mo_seller", phone="+237699400001"))
    buyer = _verify(User.objects.create(username="mo_buyer", phone="+237699400002"))
    created = _auth_client(seller).post("/api/warehouses/", {
        "title": "Warehouse near the port", "price_basis": "SALE", "price_xaf": "1000000", "quarter": str(quarter.id), "size_sqm": "800",
    })
    assert created.status_code == 201, created.data
    return seller, buyer, created.data["id"]


def _order(client, listing_id, category="warehouses", phone=PHONE):
    return client.post("/api/marketplace-orders/", {"category": category, "listing_id": listing_id, "phone_number": phone})


def _status(listing_id):
    return WarehouseListing.objects.get(pk=listing_id).availability_status


@pytest.mark.django_db
def test_full_purchase_pays_escrow_then_releases_to_the_seller_on_confirmation(deal):
    seller, buyer, listing_id = deal
    stranger = User.objects.create(username="mo_stranger", phone="+237699400003")

    placed = _order(_auth_client(buyer), listing_id)
    assert placed.status_code == 201, placed.data
    order_id = placed.data["id"]
    assert placed.data["status"] == "PAID" and placed.data["category"] == "warehouses" and placed.data["seller_deadline"]
    order = MarketplaceOrder.objects.get(pk=order_id)
    assert order.booking.escrow.status == EscrowStatus.HELD
    assert _status(listing_id) == "UNDER_OFFER"
    assert Notification.objects.filter(recipient=seller, notification_type="MARKETPLACE_ORDER").exists()

    # Nobody else can buy it meanwhile.
    other_buyer = _verify(User.objects.create(username="mo_buyer2", phone="+237699400004"))
    assert _order(_auth_client(other_buyer), listing_id).status_code == 409

    base = f"/api/marketplace-orders/{order_id}"
    assert _auth_client(buyer).post(f"{base}/hand-over/").status_code == 403
    handed = _auth_client(seller).post(f"{base}/hand-over/")
    assert handed.status_code == 200 and handed.data["status"] == "HANDED_OVER" and handed.data["auto_release_at"]

    assert _auth_client(stranger).post(f"{base}/confirm/").status_code == 403
    assert _auth_client(seller).post(f"{base}/confirm/").status_code == 403
    confirmed = _auth_client(buyer).post(f"{base}/confirm/")
    assert confirmed.status_code == 200 and confirmed.data["status"] == "COMPLETED"

    order.booking.escrow.refresh_from_db()
    assert order.booking.escrow.status == EscrowStatus.RELEASED
    assert Wallet.objects.get(owner=seller).balance_xaf == Decimal("950000.00")
    assert _status(listing_id) == "UNAVAILABLE"
    assert _auth_client(buyer).post(f"{base}/confirm/").status_code == 400


@pytest.mark.django_db
def test_buying_rules(deal):
    seller, buyer, listing_id = deal
    assert _order(_auth_client(seller), listing_id).status_code == 400  # own listing
    unverified = User.objects.create(username="mo_unverified", phone="+237699400005")
    assert _order(_auth_client(unverified), listing_id).status_code == 403
    assert _order(_auth_client(buyer), "00000000-0000-0000-0000-000000000000").status_code == 404
    assert _order(_auth_client(buyer), listing_id, category="boats").status_code == 400
    assert _order(_auth_client(buyer), listing_id, phone="").status_code == 400
    WarehouseListing.objects.filter(pk=listing_id).update(availability_status="UNAVAILABLE")
    assert _order(_auth_client(buyer), listing_id).status_code == 409


@pytest.mark.django_db
def test_a_failed_payment_leaves_the_listing_available(deal, monkeypatch):
    seller, buyer, listing_id = deal

    class FailingGateway:
        def initiate_debit(self, **kwargs):
            class Result:
                success = False
            return Result()

    monkeypatch.setattr("payments.gateways.get_active_gateway", lambda: FailingGateway())
    response = _order(_auth_client(buyer), listing_id)
    assert response.status_code == 400
    assert _status(listing_id) == "AVAILABLE"
    assert MarketplaceOrder.objects.count() == 0


@pytest.mark.django_db
def test_buyer_can_cancel_before_handover_and_is_refunded(deal):
    seller, buyer, listing_id = deal
    order_id = _order(_auth_client(buyer), listing_id).data["id"]
    base = f"/api/marketplace-orders/{order_id}"

    assert _auth_client(seller).post(f"{base}/cancel/").status_code == 403
    assert _auth_client(buyer).post(f"{base}/cancel/").status_code == 200
    order = MarketplaceOrder.objects.get(pk=order_id)
    assert order.status == MarketplaceOrderStatus.CANCELLED and order.booking.escrow.status == EscrowStatus.REFUNDED
    assert _status(listing_id) == "AVAILABLE"
    # The listing can be bought again afterwards.
    assert _order(_auth_client(buyer), listing_id).status_code == 201


@pytest.mark.django_db
def test_cannot_cancel_after_handover_but_can_report_a_problem(deal):
    seller, buyer, listing_id = deal
    order_id = _order(_auth_client(buyer), listing_id).data["id"]
    base = f"/api/marketplace-orders/{order_id}"
    _auth_client(seller).post(f"{base}/hand-over/")

    assert _auth_client(buyer).post(f"{base}/cancel/").status_code == 400
    assert _auth_client(buyer).post(f"{base}/dispute/", {"reason": "x"}).status_code == 400
    disputed = _auth_client(buyer).post(f"{base}/dispute/", {"reason": "The item was not as described"})
    assert disputed.status_code == 200 and disputed.data["status"] == "DISPUTED"
    assert MarketplaceOrder.objects.get(pk=order_id).booking.escrow.status == EscrowStatus.DISPUTED
    assert _auth_client(buyer).post(f"{base}/confirm/").status_code == 400


@pytest.mark.django_db
def test_seller_can_decline_and_the_buyer_is_refunded(deal):
    seller, buyer, listing_id = deal
    order_id = _order(_auth_client(buyer), listing_id).data["id"]
    base = f"/api/marketplace-orders/{order_id}"
    assert _auth_client(buyer).post(f"{base}/decline/").status_code == 403
    assert _auth_client(seller).post(f"{base}/decline/").status_code == 200
    assert MarketplaceOrder.objects.get(pk=order_id).booking.escrow.status == EscrowStatus.REFUNDED
    assert _status(listing_id) == "AVAILABLE"
    assert Notification.objects.filter(recipient=buyer, notification_type="MARKETPLACE_ORDER", title="Your order was declined").exists()


@pytest.mark.django_db
@pytest.mark.parametrize("outcome,expected_status,expected_listing,seller_balance", [
    ("RELEASE", MarketplaceOrderStatus.COMPLETED, "UNAVAILABLE", Decimal("950000.00")),
    ("REFUND", MarketplaceOrderStatus.CANCELLED, "AVAILABLE", None),
])
def test_an_admin_decision_on_a_disputed_order_pays_the_seller_or_refunds_the_buyer(deal, outcome, expected_status, expected_listing, seller_balance):
    seller, buyer, listing_id = deal
    order = MarketplaceOrder.objects.get(pk=_order(_auth_client(buyer), listing_id).data["id"])
    dispute_order(order=order, user=buyer, reason="Seller stopped replying")
    dispute = order.booking.escrow.dispute_case

    resolve_dispute(dispute=dispute, outcome=outcome, notes="Reviewed")

    order.refresh_from_db()
    assert order.status == expected_status
    assert _status(listing_id) == expected_listing
    if seller_balance is not None:
        assert Wallet.objects.get(owner=seller).balance_xaf == seller_balance
    else:
        assert not Wallet.objects.filter(owner=seller, balance_xaf__gt=0).exists()


@pytest.mark.django_db
def test_sweep_refunds_unfulfilled_orders_and_releases_unconfirmed_handovers(deal, quarter):
    seller, buyer, listing_id = deal
    silent = MarketplaceOrder.objects.get(pk=_order(_auth_client(buyer), listing_id).data["id"])

    second_buyer = _verify(User.objects.create(username="mo_buyer3", phone="+237699400006"))
    second_listing = _auth_client(seller).post("/api/warehouses/", {
        "title": "Second", "price_basis": "SALE", "price_xaf": "200000", "quarter": str(quarter.id), "size_sqm": "100",
    }).data["id"]
    handed = MarketplaceOrder.objects.get(pk=_order(_auth_client(second_buyer), second_listing).data["id"])
    _auth_client(seller).post(f"/api/marketplace-orders/{handed.id}/hand-over/")

    MarketplaceOrder.objects.filter(pk=silent.pk).update(created_at=timezone.now() - timedelta(days=8))
    MarketplaceOrder.objects.filter(pk=handed.pk).update(handed_over_at=timezone.now() - timedelta(hours=80))

    out = StringIO()
    call_command("process_marketplace_orders", stdout=out)
    assert "Refunded 1" in out.getvalue() and "released 1" in out.getvalue()

    silent.refresh_from_db(); handed.refresh_from_db()
    assert silent.status == MarketplaceOrderStatus.CANCELLED and _status(listing_id) == "AVAILABLE"
    assert handed.status == MarketplaceOrderStatus.COMPLETED and _status(second_listing) == "UNAVAILABLE"
    assert Wallet.objects.get(owner=seller).balance_xaf == Decimal("190000.00")
    assert process_marketplace_orders() == {"refunded": [], "released": []}


@pytest.mark.django_db
def test_the_sweep_leaves_disputed_orders_alone(deal):
    seller, buyer, listing_id = deal
    order = MarketplaceOrder.objects.get(pk=_order(_auth_client(buyer), listing_id).data["id"])
    _auth_client(seller).post(f"/api/marketplace-orders/{order.id}/hand-over/")
    order.refresh_from_db()
    dispute_order(order=order, user=buyer, reason="Not as described at all")
    MarketplaceOrder.objects.filter(pk=order.pk).update(handed_over_at=timezone.now() - timedelta(days=10), created_at=timezone.now() - timedelta(days=10))
    assert process_marketplace_orders() == {"refunded": [], "released": []}
    order.refresh_from_db()
    assert order.status == MarketplaceOrderStatus.DISPUTED


@pytest.mark.django_db
def test_orders_are_listed_by_role_and_hidden_from_outsiders(deal):
    seller, buyer, listing_id = deal
    stranger = User.objects.create(username="mo_stranger2", phone="+237699400007")
    order_id = _order(_auth_client(buyer), listing_id).data["id"]

    assert [o["id"] for o in _auth_client(buyer).get("/api/marketplace-orders/?role=buying").data["results"]] == [order_id]
    assert _auth_client(buyer).get("/api/marketplace-orders/?role=selling").data["results"] == []
    assert [o["id"] for o in _auth_client(seller).get("/api/marketplace-orders/?role=selling").data["results"]] == [order_id]
    assert _auth_client(stranger).get("/api/marketplace-orders/").data["results"] == []
    assert _auth_client(stranger).get(f"/api/marketplace-orders/{order_id}/").status_code == 404
    assert _auth_client(seller).get(f"/api/marketplace-orders/{order_id}/").status_code == 200
