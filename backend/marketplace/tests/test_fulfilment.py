"""Shipment tracking with proof, order receipts, and return requests (refund, partial refund, replacement)."""
import json
import pytest
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone
from rest_framework.test import APIClient

from identity.models import User
from marketplace.fulfilment import auto_release_at, process_return_requests
from marketplace.models import GoodsListing, MarketplaceOrder, MarketplaceReturnRequest
from marketplace.services import process_marketplace_orders
from monetization.models import Wallet
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import fee_policy  # noqa: F401

PROOF = "https://cdn.example.com/proof.jpg"


@pytest.fixture
def seller(quarter):
    return _verify(User.objects.create(username="ful_seller", phone="+237699600001"))


@pytest.fixture
def buyer(quarter):
    return _verify(User.objects.create(username="ful_buyer", phone="+237699600002"))


@pytest.fixture
def goods(seller, quarter):
    created = _auth_client(seller).post("/api/goods/", {
        "title": "Gas cooker", "price_xaf": "10000", "quarter": str(quarter.id), "item_category": "APPLIANCES", "condition": "NEW",
        "quantity": 5, "pickup_available": True, "seller_delivery": True, "seller_delivery_fee_xaf": "1000",
        "courier_shipping": True, "courier_fee_xaf": "2000",
    }, format="json")
    assert created.status_code == 201, created.data
    return created.data["id"]


def place(client, listing_id, *, quantity=1, method="PICKUP", address=""):
    """Buys goods and lets the payment provider confirm; returns the order as the buyer sees it."""
    body = {"category": "goods", "listing_id": listing_id, "phone_number": "670000000", "quantity": quantity, "delivery_method": method}
    if address:
        body["delivery_address"] = address
    response = client.post("/api/marketplace-orders/", body, format="json")
    assert response.status_code == 202, response.data
    order = MarketplaceOrder.objects.get(pk=response.data["id"])
    webhook = client.post("/api/webhooks/payment/", data=json.dumps({
        "externalId": order.booking.idempotency_key, "transId": f"T-{order.pk}", "status": "SUCCESSFUL",
    }), content_type="application/json")
    assert webhook.status_code == 200, webhook.data
    return client.get(f"/api/marketplace-orders/{order.id}/").data


def url(order_id, action):
    return f"/api/marketplace-orders/{order_id}/{action}/"


def handed_over(seller, buyer, goods, **kwargs):
    order = place(_auth_client(buyer), goods, **kwargs)
    assert _auth_client(seller).post(url(order["id"], "hand-over")).status_code == 200
    return order["id"]


# --------------------------------------------------------------------------- shipment tracking
@pytest.mark.django_db
def test_a_courier_parcel_is_tracked_to_delivery_with_proof(seller, buyer, goods):
    order = place(_auth_client(buyer), goods, method="COURIER", address="Bonamoussadi, near the market")
    assert order["is_tracked"] is True and order["status"] == "PAID"
    s, b = _auth_client(seller), _auth_client(buyer)

    assert b.post(url(order["id"], "shipment"), {"status": "IN_TRANSIT", "courier_name": "Binam Express"}, format="json").status_code == 403
    assert s.post(url(order["id"], "shipment"), {"status": "IN_TRANSIT"}, format="json").status_code == 400  # courier missing
    sent = s.post(url(order["id"], "shipment"), {"status": "IN_TRANSIT", "courier_name": "Binam Express", "tracking_number": "BX-1042"}, format="json")
    assert sent.status_code == 200, sent.data
    assert sent.data["status"] == "HANDED_OVER" and sent.data["shipment_status"] == "IN_TRANSIT"
    assert sent.data["tracking_number"] == "BX-1042" and len(sent.data["shipment_events"]) == 1

    assert s.post(url(order["id"], "shipment"), {"status": "OUT_FOR_DELIVERY"}, format="json").status_code == 200
    assert s.post(url(order["id"], "shipment"), {"status": "IN_TRANSIT"}, format="json").status_code == 400  # no going back
    assert s.post(url(order["id"], "shipment"), {"status": "DELIVERED"}, format="json").status_code == 400  # needs proof
    done = s.post(url(order["id"], "shipment"), {"status": "DELIVERED", "proof_url": PROOF, "note": "Left with the guard"}, format="json")
    assert done.status_code == 200
    assert done.data["delivery_proof_url"] == PROOF and done.data["delivered_at"] and len(done.data["shipment_events"]) == 3

    assert b.post(url(order["id"], "confirm")).data["status"] == "COMPLETED"


@pytest.mark.django_db
def test_a_pickup_order_cannot_be_tracked(seller, buyer, goods):
    order = place(_auth_client(buyer), goods, method="PICKUP")
    assert order["is_tracked"] is False
    refused = _auth_client(seller).post(url(order["id"], "shipment"), {"status": "IN_TRANSIT"}, format="json")
    assert refused.status_code == 400


@pytest.mark.django_db
def test_a_parcel_on_its_way_keeps_the_payment_held_longer_than_a_plain_handover(seller, buyer, goods):
    plain = handed_over(seller, buyer, goods, method="PICKUP")
    shipped = place(_auth_client(buyer), goods, method="SELLER", address="Akwa, rue Joss")["id"]
    _auth_client(seller).post(url(shipped, "shipment"), {"status": "IN_TRANSIT"}, format="json")
    now = timezone.now()

    result = process_marketplace_orders(now=now + timedelta(hours=73))
    assert [o.pk for o in result["released"]] == [MarketplaceOrder.objects.get(pk=plain).pk]
    assert MarketplaceOrder.objects.get(pk=shipped).status == "HANDED_OVER"

    result = process_marketplace_orders(now=now + timedelta(days=7, hours=73))
    assert [str(o.pk) for o in result["released"]] == [shipped]


@pytest.mark.django_db
def test_the_confirmation_time_starts_from_the_delivery(seller, buyer, goods):
    order_id = place(_auth_client(buyer), goods, method="SELLER", address="Akwa, rue Joss")["id"]
    s = _auth_client(seller)
    s.post(url(order_id, "shipment"), {"status": "IN_TRANSIT"}, format="json")
    s.post(url(order_id, "shipment"), {"status": "DELIVERED", "note": "Handed to the buyer"}, format="json")
    order = MarketplaceOrder.objects.get(pk=order_id)
    assert auto_release_at(order) == order.delivered_at + timedelta(hours=72)


# --------------------------------------------------------------------------- receipts
@pytest.mark.django_db
def test_each_side_can_download_the_order_pdf_and_outsiders_cannot(seller, buyer, goods):
    stranger = _verify(User.objects.create(username="ful_stranger", phone="+237699600003"))
    order_id = handed_over(seller, buyer, goods, quantity=2)
    for client in (_auth_client(buyer), _auth_client(seller)):
        response = client.get(url(order_id, "receipt"))
        assert response.status_code == 200 and response["Content-Type"] == "application/pdf"
        assert response.content.startswith(b"%PDF") and "attachment" in response["Content-Disposition"]
    assert _auth_client(buyer).get(url(order_id, "receipt") + "?lang=fr").status_code == 200
    assert _auth_client(stranger).get(url(order_id, "receipt")).status_code in (403, 404)
    assert _auth_client(buyer).get(f"/api/marketplace-orders/{order_id}/").data["receipt_available"] is True


@pytest.mark.django_db
def test_an_unpaid_or_cancelled_order_has_no_receipt(seller, buyer, goods):
    unpaid = _auth_client(buyer).post("/api/marketplace-orders/", {
        "category": "goods", "listing_id": goods, "phone_number": "670000000", "delivery_method": "PICKUP",
    }, format="json").data["id"]
    assert _auth_client(buyer).get(url(unpaid, "receipt")).status_code == 404


# --------------------------------------------------------------------------- returns
def ask(client, order_id, **extra):
    body = {"kind": "REFUND", "reason": "DAMAGED", "description": "The burner arrived cracked.", **extra}
    return client.post(url(order_id, "return-request"), body, format="json")


@pytest.mark.django_db
def test_an_accepted_full_refund_pays_the_buyer_back_and_restores_the_stock(seller, buyer, goods):
    order_id = handed_over(seller, buyer, goods, quantity=2)
    assert GoodsListing.objects.get(pk=goods).quantity == 3
    b, s = _auth_client(buyer), _auth_client(seller)
    assert b.get(f"/api/marketplace-orders/{order_id}/").data["can_request_return"] is True

    asked = ask(b, order_id, evidence_urls=[PROOF])
    assert asked.status_code == 200 and asked.data["return_request"]["status"] == "REQUESTED"
    assert asked.data["can_request_return"] is False
    assert ask(b, order_id).status_code == 400  # one open request at a time

    accepted = s.post(url(order_id, "return-respond"), {"decision": "ACCEPT"}, format="json")
    assert accepted.status_code == 200, accepted.data
    assert accepted.data["status"] == "CANCELLED" and accepted.data["return_request"]["status"] == "ACCEPTED"
    assert Wallet.objects.get(owner=buyer).balance_xaf == Decimal("20000.00")
    assert GoodsListing.objects.get(pk=goods).quantity == 5


@pytest.mark.django_db
def test_an_accepted_partial_refund_splits_the_payment(seller, buyer, goods):
    order_id = handed_over(seller, buyer, goods)
    b, s = _auth_client(buyer), _auth_client(seller)
    assert ask(b, order_id, kind="PARTIAL_REFUND").status_code == 400  # no amount
    assert ask(b, order_id, kind="PARTIAL_REFUND", requested_amount_xaf="10000").status_code == 400  # not less than the price
    assert ask(b, order_id, kind="PARTIAL_REFUND", requested_amount_xaf="3000").status_code == 200

    done = s.post(url(order_id, "return-respond"), {"decision": "ACCEPT"}, format="json")
    assert done.data["status"] == "COMPLETED"
    escrow = MarketplaceOrder.objects.get(pk=order_id).booking.escrow
    assert escrow.refunded_amount_xaf == Decimal("3000.00")
    assert escrow.payee_amount_xaf + escrow.platform_fee_xaf == Decimal("7000.00")
    assert Wallet.objects.get(owner=buyer).balance_xaf == Decimal("3000.00")


@pytest.mark.django_db
def test_an_accepted_replacement_gives_the_buyer_a_fresh_confirmation_window(seller, buyer, goods):
    order_id = handed_over(seller, buyer, goods)
    before = MarketplaceOrder.objects.get(pk=order_id).handed_over_at
    ask(_auth_client(buyer), order_id, kind="REPLACEMENT", reason="NOT_WORKING")
    done = _auth_client(seller).post(url(order_id, "return-respond"), {"decision": "ACCEPT"}, format="json")
    assert done.data["status"] == "HANDED_OVER" and done.data["return_request"]["kind"] == "REPLACEMENT"
    assert MarketplaceOrder.objects.get(pk=order_id).handed_over_at > before


@pytest.mark.django_db
def test_a_rejected_request_can_be_sent_to_support_and_becomes_a_dispute(seller, buyer, goods):
    order_id = handed_over(seller, buyer, goods)
    b, s = _auth_client(buyer), _auth_client(seller)
    ask(b, order_id)
    assert s.post(url(order_id, "return-respond"), {"decision": "REJECT"}, format="json").status_code == 400  # needs a reason
    rejected = s.post(url(order_id, "return-respond"), {"decision": "REJECT", "note": "It was fine when it left."}, format="json")
    assert rejected.data["return_request"]["status"] == "REJECTED" and rejected.data["return_request"]["buyer_decide_by"]
    assert s.post(url(order_id, "return-escalate")).status_code == 403

    escalated = b.post(url(order_id, "return-escalate"))
    assert escalated.status_code == 200
    assert escalated.data["status"] == "DISPUTED" and escalated.data["return_request"]["status"] == "ESCALATED"


@pytest.mark.django_db
def test_the_buyer_can_withdraw_and_only_the_buyer_can_ask(seller, buyer, goods):
    order_id = handed_over(seller, buyer, goods)
    assert ask(_auth_client(seller), order_id).status_code == 403
    ask(_auth_client(buyer), order_id)
    withdrawn = _auth_client(buyer).post(url(order_id, "return-withdraw"))
    assert withdrawn.data["return_request"]["status"] == "WITHDRAWN" and withdrawn.data["can_request_return"] is True


@pytest.mark.django_db
def test_returns_need_a_handed_over_delivered_purchase(seller, buyer, goods):
    waiting = place(_auth_client(buyer), goods)["id"]
    assert ask(_auth_client(buyer), waiting).status_code == 400  # not handed over yet

    in_transit = place(_auth_client(buyer), goods, method="COURIER", address="Douala, Akwa")["id"]
    _auth_client(seller).post(url(in_transit, "shipment"), {"status": "IN_TRANSIT", "courier_name": "Binam Express"}, format="json")
    refused = ask(_auth_client(buyer), in_transit)
    assert refused.status_code == 400 and "delivered" in refused.data["detail"]


@pytest.mark.django_db
def test_an_open_request_keeps_the_payment_from_being_released(seller, buyer, goods):
    order_id = handed_over(seller, buyer, goods)
    ask(_auth_client(buyer), order_id)
    later = timezone.now() + timedelta(hours=80)
    assert process_marketplace_orders(now=later)["released"] == []
    assert MarketplaceOrder.objects.get(pk=order_id).status == "HANDED_OVER"


@pytest.mark.django_db
def test_the_sweep_sends_unanswered_requests_to_support_and_closes_stale_rejections(seller, buyer, goods):
    silent = handed_over(seller, buyer, goods)
    ask(_auth_client(buyer), silent)
    rejected = handed_over(seller, buyer, goods)
    ask(_auth_client(buyer), rejected)
    _auth_client(seller).post(url(rejected, "return-respond"), {"decision": "REJECT", "note": "Not my fault."}, format="json")

    assert process_return_requests(now=timezone.now() + timedelta(hours=10)) == {"escalated": [], "closed": []}
    result = process_return_requests(now=timezone.now() + timedelta(hours=80))
    assert [str(r.order_id) for r in result["escalated"]] == [silent]
    assert [str(r.order_id) for r in result["closed"]] == [rejected]
    assert MarketplaceOrder.objects.get(pk=silent).status == "DISPUTED"
    assert MarketplaceReturnRequest.objects.get(order_id=rejected).status == "CLOSED"
