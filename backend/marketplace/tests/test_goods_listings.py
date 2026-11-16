"""Everyday goods for sale: posting, browsing with category/condition filters, and buying through escrow."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient

from identity.models import User
from marketplace.models import GoodsListing
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401


def _post(client, quarter, **extra):
    payload = {"title": "Samsung Galaxy A54", "price_xaf": "150000", "quarter": str(quarter.id), "item_category": "PHONES", "condition": "NEW", **extra}
    return client.post("/api/goods/", payload, format="json")


@pytest.fixture
def seller(quarter):
    return _verify(User.objects.create(username="goods_seller", phone="+237699500001"))


@pytest.mark.django_db
def test_a_verified_user_can_post_goods_for_sale_and_it_defaults_to_a_sale(seller, quarter):
    response = _post(_auth_client(seller), quarter, quantity=3)
    assert response.status_code == 201, response.data
    goods = GoodsListing.objects.get(pk=response.data["id"])
    assert goods.price_basis == "SALE" and goods.quantity == 3 and goods.item_category == "PHONES"
    assert goods.lister_user == seller


@pytest.mark.django_db
def test_goods_cannot_be_listed_for_rent(seller, quarter):
    response = _post(_auth_client(seller), quarter, price_basis="RENT_MONTHLY")
    assert response.status_code == 400 and "price_basis" in response.data


@pytest.mark.django_db
def test_goods_need_a_valid_quantity_and_category(seller, quarter):
    client = _auth_client(seller)
    assert _post(client, quarter, quantity=0).status_code == 400
    assert _post(client, quarter, item_category="NOPE").status_code == 400


@pytest.mark.django_db
def test_posting_goods_requires_login_but_browsing_does_not(seller, quarter):
    assert _post(APIClient(), quarter).status_code == 401
    _post(_auth_client(seller), quarter)
    assert APIClient().get("/api/goods/").data["count"] == 1


@pytest.mark.django_db
def test_goods_filter_by_category_condition_and_text(seller, quarter):
    client = _auth_client(seller)
    _post(client, quarter, title="Used sofa", item_category="HOME", condition="USED", price_xaf="40000")
    _post(client, quarter, title="New phone", item_category="PHONES", condition="NEW")

    def titles(query):
        return [r["title"] for r in APIClient().get(f"/api/goods/?{query}").data["results"]]

    assert titles("item_category=HOME") == ["Used sofa"]
    assert titles("condition=NEW") == ["New phone"]
    assert titles("q=sofa") == ["Used sofa"]
    assert titles("ordering=price_asc") == ["Used sofa", "New phone"]
    assert APIClient().get("/api/goods/?item_category=NOPE").status_code == 400


def _buy(client, listing_id, quantity=1, confirm=True):
    import json
    from marketplace.models import MarketplaceOrder
    response = client.post("/api/marketplace-orders/", {
        "category": "goods", "listing_id": listing_id, "phone_number": "670000000", "quantity": quantity,
    }, format="json")
    if response.status_code != 202 or not confirm:
        return response
    order = MarketplaceOrder.objects.get(pk=response.data["id"])
    webhook = client.post("/api/webhooks/payment/", data=json.dumps({
        "externalId": order.booking.idempotency_key, "transId": f"T-{order.pk}", "status": "SUCCESSFUL",
    }), content_type="application/json")
    assert webhook.status_code == 200, webhook.data
    return client.get(f"/api/marketplace-orders/{order.id}/")


@pytest.fixture
def stocked(seller, quarter):
    created = _post(_auth_client(seller), quarter, quantity=5, price_xaf="10000")
    assert created.status_code == 201, created.data
    return created.data["id"]


def _buyer(name, phone):
    return _verify(User.objects.create(username=name, phone=phone))


@pytest.mark.django_db
def test_buyers_take_units_from_stock_and_the_listing_stays_on_sale_until_sold_out(stocked):
    first = _buy(_auth_client(_buyer("stock_b1", "+237699500011")), stocked, quantity=2)
    assert first.status_code == 200 and first.data["status"] == "PAID", first.data
    assert first.data["quantity"] == 2 and first.data["amount_xaf"].startswith("20000")
    goods = GoodsListing.objects.get(pk=stocked)
    assert goods.quantity == 3 and goods.availability_status == "AVAILABLE"

    # A second buyer can buy at the same time from what is left, but never more than that.
    second_client = _auth_client(_buyer("stock_b2", "+237699500012"))
    too_many = _buy(second_client, stocked, quantity=4)
    assert too_many.status_code == 409 and "Only 3 left" in str(too_many.data)
    assert _buy(second_client, stocked, quantity=3).status_code == 200
    goods.refresh_from_db()
    assert goods.quantity == 0 and goods.availability_status == "UNDER_OFFER"
    assert APIClient().get("/api/goods/").data["count"] == 0


@pytest.mark.django_db
def test_a_cancelled_order_puts_its_units_back(stocked):
    from marketplace.models import MarketplaceOrder
    from marketplace.services import cancel_order
    buyer = _buyer("stock_b3", "+237699500013")
    order = MarketplaceOrder.objects.get(pk=_buy(_auth_client(buyer), stocked, quantity=5).data["id"])
    assert GoodsListing.objects.get(pk=stocked).quantity == 0
    cancel_order(order=order, buyer=buyer)
    cancel_order_again = MarketplaceOrder.objects.get(pk=order.pk)
    assert cancel_order_again.stock_taken == 0
    goods = GoodsListing.objects.get(pk=stocked)
    assert goods.quantity == 5 and goods.availability_status == "AVAILABLE"


@pytest.mark.django_db
def test_a_failed_payment_puts_units_back_and_a_completed_sale_only_ends_a_sold_out_listing(stocked):
    from marketplace.models import MarketplaceOrder
    from marketplace.services import confirm_receipt, fail_marketplace_order_payment
    unpaid = _buy(_auth_client(_buyer("stock_b4", "+237699500014")), stocked, quantity=1, confirm=False)
    assert unpaid.status_code == 202
    order = MarketplaceOrder.objects.get(pk=unpaid.data["id"])
    fail_marketplace_order_payment(booking=order.booking)
    fail_marketplace_order_payment(booking=order.booking)
    assert GoodsListing.objects.get(pk=stocked).quantity == 5

    buyer = _buyer("stock_b5", "+237699500015")
    sale = MarketplaceOrder.objects.get(pk=_buy(_auth_client(buyer), stocked, quantity=2).data["id"])
    confirm_receipt(order=sale, buyer=buyer)
    goods = GoodsListing.objects.get(pk=stocked)
    assert goods.quantity == 3 and goods.availability_status == "AVAILABLE"


@pytest.mark.django_db
def test_restocking_a_sold_out_item_puts_it_back_on_sale(seller, stocked):
    from marketplace.models import MarketplaceOrder
    from marketplace.services import confirm_receipt
    buyer = _buyer("stock_b6", "+237699500016")
    sale = MarketplaceOrder.objects.get(pk=_buy(_auth_client(buyer), stocked, quantity=5).data["id"])
    confirm_receipt(order=sale, buyer=buyer)
    assert GoodsListing.objects.get(pk=stocked).availability_status == "UNAVAILABLE"
    assert _auth_client(seller).patch(f"/api/goods/{stocked}/", {"quantity": 4}, format="json").status_code == 200
    goods = GoodsListing.objects.get(pk=stocked)
    assert goods.quantity == 4 and goods.availability_status == "AVAILABLE"


@pytest.mark.django_db
def test_an_accepted_offer_holds_one_unit_not_the_whole_stocked_item(seller, stocked):
    import json
    from marketplace.models import MarketplaceOrder
    from marketplace.offers import accept_offer, make_offer
    from marketplace.models import GoodsListing as Goods

    holder = _buyer("stock_b7", "+237699500017")
    other = _auth_client(_buyer("stock_b8", "+237699500018"))
    offer = make_offer(listing=Goods.objects.get(pk=stocked), buyer=holder, amount_xaf=Decimal("9000"))
    accept_offer(offer=offer, seller=seller)

    # 5 in stock, one held for the offer: another buyer can still buy the other 4, but not 5.
    assert _buy(other, stocked, quantity=5).status_code == 409
    assert _buy(other, stocked, quantity=2).status_code == 200
    assert Goods.objects.get(pk=stocked).quantity == 3

    # Once the offer holder places their order it takes its own unit, which must not also stay held.
    client = _auth_client(holder)
    placed = client.post("/api/marketplace-orders/", {
        "category": "goods", "listing_id": stocked, "phone_number": "670000000", "offer_id": str(offer.pk),
    }, format="json")
    assert placed.status_code == 202, placed.data
    assert Goods.objects.get(pk=stocked).quantity == 2
    assert _buy(other, stocked, quantity=2).status_code == 200
    assert Goods.objects.get(pk=stocked).quantity == 0
