"""Marketplace engagement like Jiji / Leboncoin / Facebook Marketplace: listing expiry and renewal, view/save/chat
stats, saved-search and price-drop alerts, the seller trust card and similar items."""
import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.test import APIClient

from identity.models import User
from marketplace.models import MarketplaceListingBase
from marketplace.engagement import remind_expiring_listings, LISTING_LIFETIME_DAYS
from notifications.models import Notification
from social.models import Favorite
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_car_rentals import _post_car, SPEC


def _goods(client, quarter, title="Samsung A54", price="150000", category="PHONES"):
    response = client.post("/api/goods/", {
        "title": title, "price_xaf": price, "quarter": str(quarter.id), "item_category": category, "condition": "USED",
    }, format="json")
    assert response.status_code == 201, response.data
    return response.data["id"]


@pytest.fixture
def seller(quarter):
    return _verify(User.objects.create(username="eng_seller", phone="+237699820001"))


@pytest.mark.django_db
def test_views_are_counted_once_per_viewer_per_day_and_not_for_the_lister(seller, quarter):
    listing = _goods(_auth_client(seller), quarter)
    buyer = User.objects.create(username="eng_viewer", phone="+237699820002")
    for _ in range(3):
        _auth_client(buyer).get(f"/api/goods/{listing}/")
    _auth_client(seller).get(f"/api/goods/{listing}/")
    APIClient().get(f"/api/goods/{listing}/")
    assert MarketplaceListingBase.objects.get(pk=listing).view_count == 2


@pytest.mark.django_db
def test_my_listings_show_views_saves_and_chats(seller, quarter):
    client = _auth_client(seller)
    listing = _goods(client, quarter)
    buyer = User.objects.create(username="eng_saver", phone="+237699820003")
    _auth_client(buyer).get(f"/api/goods/{listing}/")
    Favorite.objects.create(user=buyer, listing_id=listing)
    conversation = _auth_client(buyer).post("/api/conversations/", {"participant_id": str(seller.id)}).data["id"]
    for text in ("Available?", "Last price?"):
        _auth_client(buyer).post(f"/api/conversations/{conversation}/send/", {"text": text, "listing_id": listing}, format="json")
    row = client.get("/api/goods/mine/").data["results"][0]
    assert row["stats"] == {"views": 1, "saves": 1, "chats": 1}


@pytest.mark.django_db
def test_expired_listings_leave_the_marketplace_until_renewed(seller, quarter):
    client = _auth_client(seller)
    listing = _goods(client, quarter)
    MarketplaceListingBase.objects.filter(pk=listing).update(renewed_at=timezone.now() - timedelta(days=LISTING_LIFETIME_DAYS + 1))
    assert APIClient().get("/api/goods/").data["count"] == 0
    assert APIClient().get("/api/marketplace-feed/").data["count"] == 0
    detail = APIClient().get(f"/api/goods/{listing}/").data
    assert detail["is_expired"] is True
    buyer = _verify(User.objects.create(username="eng_buyer", phone="+237699820004"))
    order = _auth_client(buyer).post("/api/marketplace-orders/", {"category": "goods", "listing_id": listing, "phone_number": "+237670000000"})
    assert order.status_code == 409

    assert _auth_client(buyer).post(f"/api/goods/{listing}/renew/").status_code == 403
    renewed = client.post(f"/api/goods/{listing}/renew/")
    assert renewed.status_code == 200 and renewed.data["is_expired"] is False
    assert APIClient().get("/api/goods/").data["count"] == 1


@pytest.mark.django_db
def test_listers_are_reminded_once_before_expiry(seller, quarter):
    listing = _goods(_auth_client(seller), quarter)
    MarketplaceListingBase.objects.filter(pk=listing).update(renewed_at=timezone.now() - timedelta(days=LISTING_LIFETIME_DAYS - 2))
    assert [str(x.pk) for x in remind_expiring_listings()] == [listing]
    assert remind_expiring_listings() == []
    assert Notification.objects.filter(recipient=seller, notification_type="LISTING_EXPIRING").count() == 1


@pytest.mark.django_db
def test_saved_marketplace_searches_alert_on_matching_new_listings(seller, quarter):
    hunter = User.objects.create(username="eng_hunter", phone="+237699820005")
    hunter_client = _auth_client(hunter)
    saved = hunter_client.post("/api/saved-searches/", {
        "name": "Cheap Toyota", "scope": "MARKETPLACE",
        "filters": {"category": "cars", "make": "Toyota", "max_price": "8000000", "ordering": "newest"},
    }, format="json")
    assert saved.status_code == 201, saved.data
    assert "ordering" not in saved.data["filters"]
    assert hunter_client.post("/api/saved-searches/", {"scope": "MARKETPLACE", "filters": {"min_year": "abc"}}, format="json").status_code == 400
    assert hunter_client.post("/api/saved-searches/", {"scope": "MARKETPLACE", "filters": {"category": "boats"}}, format="json").status_code == 400

    client = _auth_client(seller)
    _post_car(client, quarter, title="Pricey", price_basis="SALE", price_xaf="20000000", security_deposit_xaf="0")
    _post_car(client, quarter, title="Honda", price_basis="SALE", price_xaf="5000000", security_deposit_xaf="0", vehicle_spec={**SPEC, "make": "Honda"})
    _goods(client, quarter, title="Toyota keyring", price="1000")
    assert not Notification.objects.filter(recipient=hunter, notification_type="SAVED_SEARCH_MATCH").exists()
    _post_car(client, quarter, title="Corolla deal", price_basis="SALE", price_xaf="6000000", security_deposit_xaf="0")
    alerts = Notification.objects.filter(recipient=hunter, notification_type="SAVED_SEARCH_MATCH")
    assert alerts.count() == 1 and "Corolla deal" in alerts.get().message


@pytest.mark.django_db
def test_people_who_saved_an_item_hear_about_a_price_drop(seller, quarter):
    client = _auth_client(seller)
    listing = _goods(client, quarter, price="150000")
    fan = User.objects.create(username="eng_fan", phone="+237699820006")
    Favorite.objects.create(user=fan, listing_id=listing)
    client.patch(f"/api/goods/{listing}/", {"price_xaf": "160000"}, format="json")
    assert not Notification.objects.filter(recipient=fan, notification_type="PRICE_DROP").exists()
    client.patch(f"/api/goods/{listing}/", {"price_xaf": "120000"}, format="json")
    drop = Notification.objects.get(recipient=fan, notification_type="PRICE_DROP")
    assert "120,000" in drop.message and "160,000" in drop.message


@pytest.mark.django_db
def test_seller_trust_card(seller, quarter):
    _goods(_auth_client(seller), quarter)
    card = APIClient().get(f"/api/marketplace-sellers/{seller.id}/").data
    assert card["id_verified"] is True and card["active_listings"] == 1 and card["items_sold"] == 0
    assert card["reply_rate_pct"] is None  # too few conversations to say
    for i in range(3):
        asker = User.objects.create(username=f"eng_ask{i}", phone=f"+23769982010{i}")
        conversation = _auth_client(asker).post("/api/conversations/", {"participant_id": str(seller.id)}).data["id"]
        _auth_client(asker).post(f"/api/conversations/{conversation}/send/", {"text": "Hello"}, format="json")
        if i < 2:
            _auth_client(seller).post(f"/api/conversations/{conversation}/send/", {"text": "Hi!"}, format="json")
    card = APIClient().get(f"/api/marketplace-sellers/{seller.id}/").data
    assert card["reply_rate_pct"] == 67 and card["reply_time_hours"] == 0.0
    assert APIClient().get("/api/marketplace-sellers/00000000-0000-0000-0000-000000000000/").status_code == 404


@pytest.mark.django_db
def test_similar_items_match_category_and_kind(seller, quarter):
    client = _auth_client(seller)
    phone = _goods(client, quarter, title="Phone A")
    _goods(client, quarter, title="Phone B")
    _goods(client, quarter, title="Sofa", category="HOME")
    titles = [row["title"] for row in APIClient().get(f"/api/goods/{phone}/similar/").data]
    assert titles == ["Phone B"]
