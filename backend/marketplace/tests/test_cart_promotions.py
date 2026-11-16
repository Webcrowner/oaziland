"""Flash sales, seller coupons, the multi-item cart (one payment per seller), shop storefronts and vacation mode."""
import json
import pytest
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone
from rest_framework.test import APIClient

from identity.models import StaffAccess, User
from identity.staff_access import check_staff_request
from marketplace.models import CartItem, GoodsListing, MarketplaceCoupon, MarketplaceOrder
from marketplace.services import process_marketplace_orders
from notifications.models import Notification
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import fee_policy  # noqa: F401
from marketplace.tests.test_fulfilment import seller, buyer, place, url  # noqa: F401

PHONE = "670000000"


@pytest.fixture
def goods(seller, quarter):
    """Gas cookers, stock 10: pickup free, seller delivery 1 000, courier 2 000."""
    created = _auth_client(seller).post("/api/goods/", {
        "title": "Gas cooker", "price_xaf": "10000", "quarter": str(quarter.id), "item_category": "APPLIANCES", "condition": "NEW",
        "quantity": 10, "pickup_available": True, "seller_delivery": True, "seller_delivery_fee_xaf": "1000",
        "courier_shipping": True, "courier_fee_xaf": "2000",
    }, format="json")
    assert created.status_code == 201, created.data
    return created.data["id"]


def post_goods(client, quarter, title, price, **extra):
    body = {
        "title": title, "price_xaf": str(price), "quarter": str(quarter.id), "item_category": "APPLIANCES", "condition": "NEW",
        "quantity": 10, "pickup_available": True, **extra,
    }
    created = client.post("/api/goods/", body, format="json")
    assert created.status_code == 201, created.data
    return created.data["id"]


@pytest.fixture
def second(seller, quarter):
    """A cheaper item from the same seller (seller delivery costs 500)."""
    return post_goods(_auth_client(seller), quarter, "Electric kettle", 5000, seller_delivery=True, seller_delivery_fee_xaf="500")


def sale_window(**kwargs):
    return {"sale_price_xaf": "7000", "sale_ends_at": (timezone.now() + timedelta(days=2)).isoformat(), **kwargs}


def confirm(client, order):
    webhook = client.post("/api/webhooks/payment/", data=json.dumps({
        "externalId": order.booking.idempotency_key, "transId": f"T-{order.pk}", "status": "SUCCESSFUL",
    }), content_type="application/json")
    assert webhook.status_code == 200, webhook.data


def make_coupon(seller, **extra):
    body = {"code": "save10", "kind": "PERCENT", "value": "10", **extra}
    created = _auth_client(seller).post("/api/marketplace-coupons/", body, format="json")
    assert created.status_code == 201, created.data
    return created.data


# --------------------------------------------------------------------------- flash sales
@pytest.mark.django_db
def test_a_flash_sale_lowers_the_price_buyers_pay_until_it_ends(seller, buyer, goods):
    s, b = _auth_client(seller), _auth_client(buyer)
    assert s.patch(f"/api/goods/{goods}/", sale_window(sale_price_xaf="10000"), format="json").status_code == 400  # not below the price
    assert s.patch(f"/api/goods/{goods}/", {"sale_price_xaf": "7000"}, format="json").status_code == 400  # no end date
    assert s.patch(f"/api/goods/{goods}/", sale_window(sale_ends_at=(timezone.now() - timedelta(hours=1)).isoformat()), format="json").status_code == 400
    assert s.patch(f"/api/goods/{goods}/", sale_window(), format="json").status_code == 200

    shown = APIClient().get(f"/api/goods/{goods}/").data
    assert shown["on_sale"] is True and shown["current_price_xaf"] == "7000.00" and shown["price_xaf"] == "10000.00"
    assert place(b, goods, quantity=2)["amount_xaf"].startswith("14000")

    GoodsListing.objects.filter(pk=goods).update(sale_ends_at=timezone.now() - timedelta(minutes=1))
    assert APIClient().get(f"/api/goods/{goods}/").data["current_price_xaf"] == "10000.00"


@pytest.mark.django_db
def test_the_deals_list_shows_only_running_sales_ending_soonest_first(seller, quarter, goods, second):
    s = _auth_client(seller)
    s.patch(f"/api/goods/{goods}/", sale_window(sale_ends_at=(timezone.now() + timedelta(days=5)).isoformat()), format="json")
    s.patch(f"/api/goods/{second}/", {"sale_price_xaf": "4000", "sale_ends_at": (timezone.now() + timedelta(days=1)).isoformat()}, format="json")
    deals = APIClient().get("/api/marketplace-feed/?on_sale=1&ordering=ending_soon").data["results"]
    assert [d["id"] for d in deals] == [second, goods]
    assert APIClient().get("/api/marketplace-feed/?ordering=ending_soon").status_code == 400
    assert len(APIClient().get("/api/marketplace-feed/").data["results"]) == 2


@pytest.mark.django_db
def test_flash_sales_are_for_goods_only(seller, quarter):
    created = _auth_client(seller).post("/api/warehouses/", {
        "title": "Depot", "price_basis": "SALE", "price_xaf": "100000", "quarter": str(quarter.id), "size_sqm": "50",
        **sale_window(sale_price_xaf="80000"),
    }, format="json")
    assert created.status_code == 400 and "sale_price_xaf" in created.data


# --------------------------------------------------------------------------- coupons
@pytest.mark.django_db
def test_a_coupon_takes_money_off_the_goods_and_the_fee_follows_what_was_charged(seller, buyer, goods):
    make_coupon(seller, min_order_xaf="5000")
    b = _auth_client(buyer)
    checked = b.post("/api/marketplace-coupon-check/", {"listing_id": goods, "quantity": 2, "code": " SAVE10 "}, format="json").data
    assert checked["valid"] is True and checked["discount_xaf"] == "2000"

    body = {"category": "goods", "listing_id": goods, "phone_number": PHONE, "quantity": 2, "delivery_method": "SELLER",
            "delivery_address": "Bonamoussadi, near the market", "coupon_code": "save10"}
    order = b.post("/api/marketplace-orders/", body, format="json")
    assert order.status_code == 202, order.data
    # 2 x 10 000 - 10% + 1 000 delivery (delivery is never discounted)
    assert order.data["amount_xaf"].startswith("19000") and order.data["discount_xaf"].startswith("2000") and order.data["coupon_code"] == "SAVE10"
    model = MarketplaceOrder.objects.get(pk=order.data["id"])
    confirm(b, model)
    assert model.booking.escrow.gross_amount_xaf == Decimal("19000.00") and model.booking.escrow.platform_fee_xaf == Decimal("950.00")
    assert MarketplaceCoupon.objects.get(seller=seller).uses == 1


@pytest.mark.django_db
def test_coupon_rules_are_enforced(seller, buyer, goods):
    make_coupon(seller, min_order_xaf="50000")
    b = _auth_client(buyer)
    low = b.post("/api/marketplace-coupon-check/", {"listing_id": goods, "code": "SAVE10"}, format="json").data
    assert low["valid"] is False and "at least" in low["message"]
    assert b.post("/api/marketplace-coupon-check/", {"listing_id": goods, "code": "NOPE"}, format="json").data["valid"] is False
    assert _auth_client(seller).post("/api/marketplace-coupon-check/", {"listing_id": goods, "code": "SAVE10"}, format="json").data["valid"] is False
    other = _auth_client(buyer).post("/api/marketplace-coupons/", {"code": "save10", "kind": "PERCENT", "value": "95"}, format="json")
    assert other.status_code == 400  # over the percentage cap
    assert _auth_client(seller).post("/api/marketplace-coupons/", {"code": "SAVE10", "kind": "FIXED", "value": "500"}, format="json").status_code == 400  # duplicate code
    assert [c["code"] for c in b.get("/api/marketplace-coupons/").data["results"]] == []  # coupons are private to their seller


@pytest.mark.django_db
def test_a_used_up_coupon_is_refused_and_a_failed_payment_gives_the_use_back(seller, buyer, goods):
    make_coupon(seller, max_uses=1)
    b = _auth_client(buyer)
    body = {"category": "goods", "listing_id": goods, "phone_number": PHONE, "delivery_method": "PICKUP", "coupon_code": "SAVE10"}
    first = b.post("/api/marketplace-orders/", body, format="json")
    assert first.status_code == 202
    second_try = b.post("/api/marketplace-orders/", body, format="json")
    assert second_try.status_code == 400 and "used up" in second_try.data["detail"]

    order = MarketplaceOrder.objects.get(pk=first.data["id"])
    b.post("/api/webhooks/payment/", data=json.dumps({
        "externalId": order.booking.idempotency_key, "transId": f"FAILED-{order.pk}", "status": "FAILED",
    }), content_type="application/json")
    assert MarketplaceCoupon.objects.get(seller=seller).uses == 0
    assert b.post("/api/marketplace-orders/", body, format="json").status_code == 202


# --------------------------------------------------------------------------- cart
@pytest.mark.django_db
def test_the_cart_groups_items_by_seller_and_caps_quantity_at_stock(seller, buyer, goods, second):
    b = _auth_client(buyer)
    assert b.post("/api/marketplace-cart/items/", {"listing_id": goods, "quantity": 99}, format="json").data["groups"][0]["items"][0]["quantity"] == 10
    assert b.post("/api/marketplace-cart/items/", {"listing_id": goods, "quantity": 2}, format="json").status_code == 200  # sets the quantity
    cart = b.post("/api/marketplace-cart/items/", {"listing_id": second}, format="json").data
    assert cart["item_count"] == 2 and len(cart["groups"]) == 1
    group = cart["groups"][0]
    assert group["subtotal_xaf"] == "25000" and group["can_checkout"] is True
    assert {o["method"] for o in group["delivery_options"]} == {"PICKUP", "SELLER"}  # the kettle isn't offered with a courier
    assert _auth_client(seller).post("/api/marketplace-cart/items/", {"listing_id": goods}, format="json").status_code == 400  # own listing
    assert b.delete(f"/api/marketplace-cart/items/{second}/").data["item_count"] == 1


@pytest.mark.django_db
def test_a_cart_checkout_is_one_payment_that_splits_into_an_order_and_escrow_per_item(seller, buyer, goods, second):
    make_coupon(seller)
    b, s = _auth_client(buyer), _auth_client(seller)
    b.post("/api/marketplace-cart/items/", {"listing_id": goods, "quantity": 2}, format="json")
    b.post("/api/marketplace-cart/items/", {"listing_id": second, "quantity": 1}, format="json")
    group = {"seller_id": str(seller.id), "delivery_method": "SELLER", "delivery_address": "Bonamoussadi, near the market", "coupon_code": "save10"}

    quote = b.post("/api/marketplace-cart/quote/", group, format="json").data
    assert quote["subtotal_xaf"] == "25000" and quote["discount_xaf"] == "2500" and quote["delivery_fee_xaf"] == "1000" and quote["total_xaf"] == "23500"

    done = b.post("/api/marketplace-cart/checkout/", {**group, "phone_number": PHONE}, format="json")
    assert done.status_code == 202, done.data
    assert done.data["total_xaf"] == "23500" and len(done.data["orders"]) == 2
    orders = {o.listing_id: o for o in MarketplaceOrder.objects.filter(checkout_id=done.data["checkout_id"])}
    lead = next(o for o in orders.values() if o.checkout_lead)
    assert lead.booking.amount_xaf == Decimal("23500.00")  # the one charge
    assert GoodsListing.objects.get(pk=goods).quantity == 8 and GoodsListing.objects.get(pk=second).quantity == 9
    assert CartItem.objects.filter(user=buyer).count() == 0

    confirm(b, lead)
    rows = {str(o.listing_id): o for o in MarketplaceOrder.objects.filter(checkout_id=done.data["checkout_id"]).select_related("booking__escrow")}
    assert {o.status for o in rows.values()} == {"PAID"}
    # The delivery fee rides on whichever item leads the checkout; the discount is shared in proportion (2 000 and 500).
    expected = {goods: Decimal("18000.00"), second: Decimal("4500.00")}
    expected[str(lead.listing_id)] += Decimal("1000")
    for listing_id, order in rows.items():
        escrow = order.booking.escrow
        assert order.amount_xaf == escrow.gross_amount_xaf == expected[listing_id]
        assert escrow.platform_fee_xaf == expected[listing_id] * Decimal("0.05") and escrow.status == "HELD"
    assert sum(o.amount_xaf for o in rows.values()) == Decimal("23500.00")
    assert MarketplaceCoupon.objects.get(seller=seller).uses == 1

    # Each item lives its own life: one is handed over and confirmed while the other still waits.
    first, other = rows[goods], rows[second]
    assert s.post(url(first.id, "hand-over")).status_code == 200
    assert b.post(url(first.id, "confirm")).data["status"] == "COMPLETED"
    assert MarketplaceOrder.objects.get(pk=other.pk).status == "PAID"
    assert b.post(url(other.id, "cancel")).data["status"] == "CANCELLED"
    assert GoodsListing.objects.get(pk=second).quantity == 10


@pytest.mark.django_db
def test_a_failed_cart_payment_gives_back_every_items_stock_and_the_coupon(seller, buyer, goods, second):
    make_coupon(seller)
    b = _auth_client(buyer)
    b.post("/api/marketplace-cart/items/", {"listing_id": goods, "quantity": 3}, format="json")
    b.post("/api/marketplace-cart/items/", {"listing_id": second, "quantity": 2}, format="json")
    done = b.post("/api/marketplace-cart/checkout/", {
        "seller_id": str(seller.id), "delivery_method": "PICKUP", "coupon_code": "SAVE10", "phone_number": PHONE,
    }, format="json")
    assert done.status_code == 202
    lead = MarketplaceOrder.objects.get(checkout_id=done.data["checkout_id"], checkout_lead=True)
    b.post("/api/webhooks/payment/", data=json.dumps({
        "externalId": lead.booking.idempotency_key, "transId": f"FAILED-{lead.pk}", "status": "FAILED",
    }), content_type="application/json")
    assert {o.status for o in MarketplaceOrder.objects.filter(checkout_id=done.data["checkout_id"])} == {"CANCELLED"}
    assert GoodsListing.objects.get(pk=goods).quantity == 10 and GoodsListing.objects.get(pk=second).quantity == 10
    assert MarketplaceCoupon.objects.get(seller=seller).uses == 0


@pytest.mark.django_db
def test_an_unpaid_cart_checkout_expires_as_a_whole(seller, buyer, goods, second):
    b = _auth_client(buyer)
    b.post("/api/marketplace-cart/items/", {"listing_id": goods}, format="json")
    b.post("/api/marketplace-cart/items/", {"listing_id": second}, format="json")
    done = b.post("/api/marketplace-cart/checkout/", {"seller_id": str(seller.id), "delivery_method": "PICKUP", "phone_number": PHONE}, format="json")
    result = process_marketplace_orders(now=timezone.now() + timedelta(hours=2))
    assert len(result["expired"]) == 1  # the lead; the other item follows it
    assert {o.status for o in MarketplaceOrder.objects.filter(checkout_id=done.data["checkout_id"])} == {"CANCELLED"}
    assert GoodsListing.objects.get(pk=goods).quantity == 10


@pytest.mark.django_db
def test_checkout_refuses_what_it_cannot_deliver_or_stock(seller, buyer, goods, second):
    b = _auth_client(buyer)
    b.post("/api/marketplace-cart/items/", {"listing_id": goods}, format="json")
    b.post("/api/marketplace-cart/items/", {"listing_id": second}, format="json")
    base = {"seller_id": str(seller.id), "phone_number": PHONE}
    mixed = b.post("/api/marketplace-cart/checkout/", {**base, "delivery_method": "COURIER", "delivery_address": "Douala, Akwa"}, format="json")
    assert mixed.status_code == 400  # the kettle isn't offered with a courier
    GoodsListing.objects.filter(pk=second).update(quantity=0)
    gone = b.post("/api/marketplace-cart/checkout/", {**base, "delivery_method": "PICKUP"}, format="json")
    assert gone.status_code in (400, 409) and "Electric kettle" in gone.data["detail"]
    assert GoodsListing.objects.get(pk=goods).quantity == 10


# --------------------------------------------------------------------------- storefront, followers, vacation
@pytest.mark.django_db
def test_the_storefront_shows_the_profile_and_followers_hear_about_new_listings(seller, buyer, quarter):
    s = _auth_client(seller)
    saved = s.put("/api/marketplace-shop/me/", {
        "name": "Kamga Home", "tagline": "Appliances you can trust", "return_policy": "7 days, unused.", "announcement": "Free delivery in Douala",
    }, format="json")
    assert saved.status_code == 200 and saved.data["name"] == "Kamga Home"
    assert _auth_client(buyer).post(f"/api/users/{seller.id}/follow/").data["is_following"] is True

    shop = _auth_client(buyer).get(f"/api/marketplace-shops/{seller.id}/").data
    assert shop["name"] == "Kamga Home" and shop["return_policy"] == "7 days, unused." and shop["follower_count"] == 1
    assert shop["is_following"] is True and shop["is_owner"] is False and shop["on_vacation"] is False

    post_goods(s, quarter, "Blender", 8000)
    note = Notification.objects.filter(recipient=buyer, notification_type="SHOP_NEW_LISTING").first()
    assert note is not None and "Kamga Home" in note.title
    assert APIClient().get(f"/api/marketplace-shops/{buyer.id}/").data["name"]  # every seller has a storefront, even without a profile


@pytest.mark.django_db
def test_vacation_mode_hides_the_shop_and_pauses_buying_until_it_ends(seller, buyer, goods):
    s, b = _auth_client(seller), _auth_client(buyer)
    s.put("/api/marketplace-shop/me/", {"on_vacation": True, "vacation_message": "Back soon"}, format="json")
    assert APIClient().get("/api/goods/").data["count"] == 0
    assert APIClient().get(f"/api/marketplace-shops/{seller.id}/").data["on_vacation"] is True
    assert APIClient().get(f"/api/goods/{goods}/").data["seller_on_vacation"] is True

    refused = b.post("/api/marketplace-orders/", {"category": "goods", "listing_id": goods, "phone_number": PHONE, "delivery_method": "PICKUP"}, format="json")
    assert refused.status_code == 400 and "vacation" in refused.data["detail"]
    assert b.post("/api/marketplace-cart/items/", {"listing_id": goods}, format="json").status_code == 400
    offer = b.post("/api/marketplace-offers/", {"category": "goods", "listing_id": goods, "amount_xaf": "8000"}, format="json")
    assert offer.status_code == 400

    s.put("/api/marketplace-shop/me/", {"vacation_until": (timezone.localdate() - timedelta(days=1)).isoformat()}, format="json")
    assert APIClient().get("/api/goods/").data["count"] == 1  # the end date has passed
    s.put("/api/marketplace-shop/me/", {"on_vacation": False}, format="json")
    assert place(b, goods)["status"] == "PAID"


# --------------------------------------------------------------------------- staff
def grant(*permissions):
    return StaffAccess(permissions=list(permissions))


def test_shop_staff_scopes_cover_the_new_endpoints_without_leaking_earnings_or_the_cart():
    listings = grant("listings")
    assert check_staff_request(listings, "POST", "/api/marketplace-coupons/") is None
    assert check_staff_request(listings, "PUT", "/api/marketplace-shop/me/") is None
    assert check_staff_request(grant("messages"), "POST", "/api/marketplace-coupons/") is not None
    # The dashboard shows earnings, so it needs the earnings permission, and even then is read-only.
    assert check_staff_request(listings, "GET", "/api/marketplace-seller/dashboard/") is not None
    assert check_staff_request(grant("earnings_view"), "GET", "/api/marketplace-seller/payouts/") is None
    assert check_staff_request(grant("earnings_view"), "POST", "/api/marketplace-seller/payouts/") is not None
    assert check_staff_request(grant("listings", "bookings", "earnings_view"), "POST", "/api/marketplace-cart/checkout/") is not None
