"""Everyday goods for sale: posting, browsing with category/condition filters, and buying through escrow."""
import pytest
from rest_framework.test import APIClient

from identity.models import User
from marketplace.models import GoodsListing
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401


def _post(client, quarter, **extra):
    payload = {"title": "Samsung Galaxy A54", "price_xaf": "150000", "quarter": str(quarter.id), "item_category": "PHONES", "condition": "NEW", **extra}
    return client.post("/api/goods/", payload)


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
