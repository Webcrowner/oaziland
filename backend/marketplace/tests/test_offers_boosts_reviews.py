"""Marketplace offers and TOP boosts over the API, and verified-purchase reviews of completed orders."""
import pytest
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from marketplace.models import MarketplaceOrder, MarketplaceOffer, WarehouseListing
from monetization.models import BoostPricingTier, Wallet
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import deal, fee_policy, _order  # noqa: F401

OFFERS = "/api/marketplace-offers/"


def _offer(client, listing_id, amount):
    # The fixture posts the listing as a form, where an absent checkbox reads as off; JSON clients get the default (on).
    WarehouseListing.objects.filter(pk=listing_id).update(allow_offers=True)
    return client.post(OFFERS, {"category": "warehouses", "listing_id": listing_id, "amount_xaf": str(amount)}, format="json")


@pytest.mark.django_db
def test_an_offer_is_countered_accepted_and_paid_at_the_agreed_price(deal):
    seller, buyer, listing_id = deal
    buyer_client, seller_client = _auth_client(buyer), _auth_client(seller)

    assert _offer(buyer_client, listing_id, 100000).status_code == 400  # under 30% of the asking price
    assert _offer(seller_client, listing_id, 800000).status_code == 400  # the seller can't bid on their own listing
    made = _offer(buyer_client, listing_id, 700000)
    assert made.status_code == 201 and made.data["status"] == "PENDING", made.data
    offer_id = made.data["id"]
    assert _offer(buyer_client, listing_id, 750000).status_code == 400  # one open offer at a time

    assert buyer_client.post(f"{OFFERS}{offer_id}/counter/", {"amount_xaf": "850000"}, format="json").status_code == 403
    countered = seller_client.post(f"{OFFERS}{offer_id}/counter/", {"amount_xaf": "850000"}, format="json")
    assert countered.status_code == 200 and countered.data["status"] == "COUNTERED"

    mine = buyer_client.get(f"{OFFERS}?role=buying&listing_id={listing_id}")
    assert [o["id"] for o in mine.data["results"]] == [offer_id]
    assert seller_client.get(f"{OFFERS}?role=buying").data["results"] == []

    accepted = buyer_client.post(f"{OFFERS}{offer_id}/accept/")
    assert accepted.status_code == 200 and accepted.data["status"] == "ACCEPTED"
    assert Decimal(accepted.data["agreed_amount_xaf"]) == Decimal("850000")

    placed = buyer_client.post("/api/marketplace-orders/", {
        "category": "warehouses", "listing_id": listing_id, "phone_number": "670000000", "offer_id": offer_id,
    }, format="json")
    assert placed.status_code == 202, placed.data
    assert Decimal(placed.data["amount_xaf"]) == Decimal("850000")
    assert MarketplaceOrder.objects.get(pk=placed.data["id"]).offer_id == MarketplaceOffer.objects.get(pk=offer_id).pk


@pytest.mark.django_db
def test_a_buyer_can_withdraw_an_offer_and_make_a_new_one(deal):
    _, buyer, listing_id = deal
    client = _auth_client(buyer)
    offer = _offer(client, listing_id, 700000)
    assert offer.status_code == 201, offer.data
    offer_id = offer.data["id"]
    assert client.post(f"{OFFERS}{offer_id}/withdraw/").data["status"] == "WITHDRAWN"
    assert _offer(client, listing_id, 720000).status_code == 201


@pytest.mark.django_db
def test_a_seller_can_switch_offers_off(deal):
    seller, buyer, listing_id = deal
    assert _auth_client(seller).patch(f"/api/warehouses/{listing_id}/", {"allow_offers": False}, format="json").status_code == 200
    refused = _auth_client(buyer).post(OFFERS, {"category": "warehouses", "listing_id": listing_id, "amount_xaf": "700000"}, format="json")
    assert refused.status_code == 400 and "isn't taking offers" in refused.data["detail"]


@pytest.fixture
def boost_price(db):
    BoostPricingTier.objects.update_or_create(placement="MARKETPLACE_TOP", duration_unit="DAILY", defaults={"price_xaf": Decimal("1000")})


@pytest.mark.django_db
def test_a_seller_boosts_a_listing_from_the_wallet(deal, boost_price):
    seller, buyer, listing_id = deal
    options = _auth_client(seller).get("/api/marketplace-boost-options/").data["options"]
    assert any(o["duration_unit"] == "DAILY" and Decimal(o["unit_price_xaf"]) == Decimal("1000") for o in options)
    body = {"duration_unit": "DAILY", "quantity": 3, "pay_with": "WALLET"}

    assert _auth_client(buyer).post(f"/api/warehouses/{listing_id}/boost/", body, format="json").status_code == 403
    broke = _auth_client(seller).post(f"/api/warehouses/{listing_id}/boost/", body, format="json")
    assert broke.status_code == 400 and "wallet" in broke.data["detail"].lower()

    Wallet.objects.update_or_create(owner=seller, defaults={"balance_xaf": Decimal("5000")})
    done = _auth_client(seller).post(f"/api/warehouses/{listing_id}/boost/", body, format="json")
    assert done.status_code == 200, done.data
    assert Decimal(done.data["price_xaf"]) == Decimal("3000")
    assert Wallet.objects.get(owner=seller).balance_xaf == Decimal("2000")
    listing = WarehouseListing.objects.get(pk=listing_id)
    assert listing.boosted_until - timezone.now() > timedelta(days=2, hours=23)
    assert _auth_client(buyer).get(f"/api/warehouses/{listing_id}/").data["is_boosted"] is True


def _completed_order(deal):
    seller, buyer, listing_id = deal
    order_id = _order(_auth_client(buyer), listing_id).data["id"]
    _auth_client(seller).post(f"/api/marketplace-orders/{order_id}/hand-over/")
    _auth_client(buyer).post(f"/api/marketplace-orders/{order_id}/confirm/")
    return order_id


@pytest.mark.django_db
def test_only_the_buyer_of_a_completed_order_can_review_it_once(deal):
    seller, buyer, listing_id = deal
    stranger = _verify(User.objects.create(username="rv_stranger", phone="+237699400077"))
    order_id = _order(_auth_client(buyer), listing_id).data["id"]
    url = f"/api/marketplace-orders/{order_id}/review/"
    body = {"score": 5, "text": "Exactly as described."}

    assert _auth_client(buyer).post(url, body, format="json").status_code == 400  # not completed yet
    _auth_client(seller).post(f"/api/marketplace-orders/{order_id}/hand-over/")
    _auth_client(buyer).post(f"/api/marketplace-orders/{order_id}/confirm/")

    assert _auth_client(seller).post(url, body, format="json").status_code == 403
    assert _auth_client(stranger).post(url, body, format="json").status_code == 403
    assert _auth_client(buyer).post(url, {"score": 6, "text": "x"}, format="json").status_code == 400
    assert _auth_client(buyer).get(f"/api/marketplace-orders/{order_id}/").data["can_review"] is True

    done = _auth_client(buyer).post(url, body, format="json")
    assert done.status_code == 201
    assert done.data["can_review"] is False and done.data["my_review"]["score"] == 5
    assert _auth_client(buyer).post(url, body, format="json").status_code == 400
    assert _auth_client(seller).get(f"/api/marketplace-orders/{order_id}/").data["can_review"] is False


@pytest.mark.django_db
def test_a_listing_shows_its_verified_purchase_reviews_to_everyone(deal):
    seller, buyer, listing_id = deal
    buyer.first_name, buyer.last_name = "Jean", "Kamga"
    buyer.save(update_fields=["first_name", "last_name"])
    anonymous = __import__("rest_framework.test", fromlist=["APIClient"]).APIClient()
    empty = anonymous.get(f"/api/warehouses/{listing_id}/reviews/").data
    assert empty["count"] == 0 and empty["average"] is None and empty["results"] == []

    order_id = _completed_order(deal)
    _auth_client(buyer).post(f"/api/marketplace-orders/{order_id}/review/", {"score": 4, "text": "Good place, fair price."}, format="json")

    data = anonymous.get(f"/api/warehouses/{listing_id}/reviews/").data
    assert data["count"] == 1 and data["average"] == 4.0
    assert data["distribution"] == {"1": 0, "2": 0, "3": 0, "4": 1, "5": 0}
    review = data["results"][0]
    assert review["verified_purchase"] is True and review["text"] == "Good place, fair price."
    assert review["author_name"] == "Jean K."
