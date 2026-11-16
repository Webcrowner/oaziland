"""Goods variants (size / colour with their own stock and price) and the compare-at price."""
import json
import pytest
from decimal import Decimal

from marketplace.models import CartItem, GoodsListing, GoodsVariant, MarketplaceOrder
from marketplace.tests.test_cart_promotions import PHONE, confirm, post_goods
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import fee_policy  # noqa: F401
from marketplace.tests.test_fulfilment import seller, buyer, url  # noqa: F401
from notifications.models import Notification


@pytest.fixture
def shirt(seller, quarter):
    """A T-shirt at 10 000 XAF with Red / M (4 in stock), Red / L (+1 000, 5 in stock) and Blue / M (2 in stock)."""
    listing = post_goods(_auth_client(seller), quarter, "T-shirt", 10000)
    saved = _auth_client(seller).put(f"/api/goods/{listing}/variants/", {"variants": [
        {"options": {"Colour": "Red", "Size": "M"}, "quantity": 4},
        {"options": {"Colour": "Red", "Size": "L"}, "quantity": 5, "price_delta_xaf": 1000},
        {"options": {"Colour": "Blue", "Size": "M"}, "quantity": 2},
    ]}, format="json")
    assert saved.status_code == 200, saved.data
    return listing


def variant(listing, label):
    return GoodsVariant.objects.get(listing_id=listing, label=label)


def buy(client, listing, label, quantity=1):
    return client.post("/api/marketplace-orders/", {
        "category": "goods", "listing_id": listing, "variant_id": str(variant(listing, label).pk), "phone_number": PHONE,
        "quantity": quantity, "delivery_method": "PICKUP",
    }, format="json")


@pytest.mark.django_db
def test_the_listing_stock_is_the_sum_of_its_versions_and_the_price_shows_from(seller, buyer, shirt):
    detail = _auth_client(buyer).get(f"/api/goods/{shirt}/").data
    assert detail["quantity"] == 11 and detail["has_variants"] is True and detail["price_from_xaf"] == "10000"
    prices = {v["label"]: v["price_xaf"] for v in detail["variants"]}
    assert prices == {"Red / M": "10000", "Red / L": "11000", "Blue / M": "10000"}
    assert variant(shirt, "Red / M").sku  # one is made when the seller gives none


@pytest.mark.django_db
def test_versions_are_validated(seller, shirt):
    s = _auth_client(seller)

    def put(rows):
        return s.put(f"/api/goods/{shirt}/variants/", {"variants": rows}, format="json")

    assert put([{"options": {"Size": "S"}, "quantity": 1}, {"options": {"Colour": "Red"}, "quantity": 1}]).status_code == 400  # different options
    assert put([{"options": {"Size": "S"}, "quantity": 1}, {"options": {"Size": "s"}, "quantity": 1}]).status_code == 400  # same label twice
    assert put([{"options": {"Size": "S"}, "quantity": -1}]).status_code == 400
    assert put([{"options": {"Size": "S"}, "quantity": 1, "price_delta_xaf": -10000}]).status_code == 400  # free item
    assert put([{"options": {}, "quantity": 1}]).status_code == 400
    assert GoodsVariant.objects.filter(listing=shirt).count() == 3  # nothing changed
    assert put([{"options": {"Size": "S"}, "quantity": 1}]).status_code == 200
    assert GoodsListing.objects.get(pk=shirt).quantity == 1 and GoodsVariant.objects.filter(listing=shirt).count() == 1


@pytest.mark.django_db
def test_only_the_lister_edits_versions_and_the_stock_field_is_locked(seller, buyer, shirt):
    assert _auth_client(buyer).put(f"/api/goods/{shirt}/variants/", {"variants": []}, format="json").status_code == 403
    assert _auth_client(seller).patch(f"/api/goods/{shirt}/", {"quantity": 50}, format="json").status_code == 400
    hidden = variant(shirt, "Blue / M")
    s = _auth_client(seller)
    rows = [{"id": str(v.pk), "options": v.options, "quantity": v.quantity, "price_delta_xaf": v.price_delta_xaf, "is_active": v != hidden} for v in GoodsVariant.objects.filter(listing=shirt)]
    assert s.put(f"/api/goods/{shirt}/variants/", {"variants": rows}, format="json").status_code == 200
    public = _auth_client(buyer).get(f"/api/goods/{shirt}/variants/").data["variants"]
    assert "Blue / M" not in {v["label"] for v in public} and len(s.get(f"/api/goods/{shirt}/variants/").data["variants"]) == 3
    assert GoodsListing.objects.get(pk=shirt).quantity == 9


@pytest.mark.django_db
def test_buying_a_version_charges_its_price_and_takes_its_stock(seller, buyer, shirt):
    b = _auth_client(buyer)
    assert b.post("/api/marketplace-orders/", {
        "category": "goods", "listing_id": shirt, "phone_number": PHONE, "delivery_method": "PICKUP",
    }, format="json").status_code == 400  # a version must be chosen

    bought = buy(b, shirt, "Red / L", quantity=2)
    assert bought.status_code == 202, bought.data
    order = MarketplaceOrder.objects.get(pk=bought.data["id"])
    assert order.amount_xaf == Decimal("22000.00") and order.variant_label == "Red / L"
    assert variant(shirt, "Red / L").quantity == 3 and GoodsListing.objects.get(pk=shirt).quantity == 9
    assert bought.data["variant_label"] == "Red / L"

    assert buy(b, shirt, "Red / L", quantity=4).status_code == 409  # only three left in that version
    confirm(b, order)
    # The seller hears the first time a version runs low, and the receipt names the version.
    assert Notification.objects.filter(recipient=seller, notification_type="LOW_STOCK").count() == 1
    assert b.get(url(order.id, "receipt")).status_code == 200

    cancelled = b.post(url(order.id, "cancel"))
    assert cancelled.status_code == 200
    assert variant(shirt, "Red / L").quantity == 5 and GoodsListing.objects.get(pk=shirt).quantity == 11


@pytest.mark.django_db
def test_a_failed_payment_gives_the_version_back_and_offers_are_not_available(seller, buyer, shirt):
    b = _auth_client(buyer)
    bought = buy(b, shirt, "Blue / M", quantity=2)
    assert bought.status_code == 202
    order = MarketplaceOrder.objects.get(pk=bought.data["id"])
    assert GoodsListing.objects.get(pk=shirt).quantity == 9
    b.post("/api/webhooks/payment/", data=json.dumps({
        "externalId": order.booking.idempotency_key, "transId": "FAILED-1", "status": "FAILED",
    }), content_type="application/json")
    assert variant(shirt, "Blue / M").quantity == 2 and GoodsListing.objects.get(pk=shirt).quantity == 11
    _auth_client(seller).patch(f"/api/goods/{shirt}/", {"allow_offers": True}, format="json")
    offer = b.post("/api/marketplace-offers/", {"category": "goods", "listing_id": shirt, "amount_xaf": "8000"}, format="json")
    assert offer.status_code == 400


@pytest.mark.django_db
def test_the_cart_keeps_versions_apart_and_checks_their_combined_stock(seller, buyer, shirt):
    b = _auth_client(buyer)
    red, blue = variant(shirt, "Red / M"), variant(shirt, "Blue / M")
    assert b.post("/api/marketplace-cart/items/", {"listing_id": shirt}, format="json").status_code == 400  # needs a version
    b.post("/api/marketplace-cart/items/", {"listing_id": shirt, "variant_id": str(red.pk), "quantity": 99}, format="json")
    cart = b.post("/api/marketplace-cart/items/", {"listing_id": shirt, "variant_id": str(blue.pk), "quantity": 2}, format="json").data
    lines = {i["variant_label"]: i for i in cart["groups"][0]["items"]}
    assert lines["Red / M"]["quantity"] == 4 and lines["Blue / M"]["quantity"] == 2  # capped at that version's stock
    assert cart["groups"][0]["subtotal_xaf"] == "60000" and cart["groups"][0]["can_checkout"] is True

    done = b.post("/api/marketplace-cart/checkout/", {"seller_id": str(seller.id), "delivery_method": "PICKUP", "phone_number": PHONE}, format="json")
    assert done.status_code == 202, done.data
    assert {o["variant_label"] for o in done.data["orders"]} == {"Red / M", "Blue / M"}
    assert variant(shirt, "Red / M").quantity == 0 and variant(shirt, "Blue / M").quantity == 0
    assert GoodsListing.objects.get(pk=shirt).quantity == 5 and CartItem.objects.filter(user=buyer).count() == 0


@pytest.mark.django_db
def test_removing_one_version_from_the_cart_leaves_the_other(seller, buyer, shirt):
    b = _auth_client(buyer)
    red, blue = variant(shirt, "Red / M"), variant(shirt, "Blue / M")
    for v in (red, blue):
        b.post("/api/marketplace-cart/items/", {"listing_id": shirt, "variant_id": str(v.pk)}, format="json")
    after = b.delete(f"/api/marketplace-cart/items/{shirt}/?variant_id={blue.pk}").data
    assert [i["variant_label"] for i in after["groups"][0]["items"]] == ["Red / M"]


@pytest.mark.django_db
def test_the_compare_at_price_must_beat_the_selling_price(seller, quarter):
    s = _auth_client(seller)
    body = {
        "title": "Kettle", "price_xaf": "5000", "quarter": str(quarter.id), "item_category": "APPLIANCES", "condition": "NEW",
        "quantity": 3, "pickup_available": True,
    }
    assert s.post("/api/goods/", {**body, "compare_at_price_xaf": "4000"}, format="json").status_code == 400
    created = s.post("/api/goods/", {**body, "compare_at_price_xaf": "8000"}, format="json")
    assert created.status_code == 201 and created.data["compare_at_price_xaf"] == "8000.00"
    assert s.patch(f"/api/goods/{created.data['id']}/", {"price_xaf": "9000"}, format="json").status_code == 400  # would no longer be a discount
    assert s.patch(f"/api/goods/{created.data['id']}/", {"compare_at_price_xaf": None}, format="json").status_code == 200
