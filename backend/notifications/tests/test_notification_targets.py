"""Tapping a notification leads to the order, offer, listing or ride it is about."""
import pytest
from django.test import override_settings  # noqa: F401

from identity.models import User
from marketplace.models import WarehouseListing
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import deal, fee_policy, _order  # noqa: F401
from notifications.models import Notification
from notifications.services import notify


def inbox(user, **params):
    return _auth_client(user).get("/api/my-notifications/", params).data["results"]


def by_type(rows, notification_type):
    return next(r for r in rows if r["notification_type"] == notification_type)


@pytest.mark.django_db
def test_order_notifications_open_the_order_on_the_right_side(deal):
    seller, buyer, listing_id = deal
    order_id = _order(_auth_client(buyer), listing_id).data["id"]

    seller_row = by_type(inbox(seller), "MARKETPLACE_ORDER")
    assert seller_row["target"] == {"kind": "marketplace_order", "id": order_id, "role": "selling"}
    _auth_client(seller).post(f"/api/marketplace-orders/{order_id}/hand-over/")
    buyer_row = by_type(inbox(buyer), "MARKETPLACE_ORDER")
    assert buyer_row["target"] == {"kind": "marketplace_order", "id": order_id, "role": "buying"}


@pytest.mark.django_db
def test_offer_and_listing_notifications_lead_to_the_offer_and_the_listing(deal):
    seller, buyer, listing_id = deal
    WarehouseListing.objects.filter(pk=listing_id).update(allow_offers=True)
    offer = _auth_client(buyer).post("/api/marketplace-offers/", {"category": "warehouses", "listing_id": listing_id, "amount_xaf": "800000"}, format="json")
    assert offer.status_code == 201, offer.data
    assert by_type(inbox(seller), "MARKETPLACE_OFFER")["target"] == {"kind": "marketplace_offer", "id": offer.data["id"], "role": "selling"}

    notify(recipient=buyer, notification_type="PRICE_DROP", title="Price drop", message="Cheaper", related_reference=listing_id)
    assert by_type(inbox(buyer), "PRICE_DROP")["target"] == {"kind": "marketplace_listing", "id": listing_id, "category": "warehouses"}


@pytest.mark.django_db
def test_notifications_without_a_destination_have_no_target_and_nobody_else_is_resolved(deal, django_assert_max_num_queries):
    seller, buyer, listing_id = deal
    notify(recipient=buyer, notification_type="WEEKLY_DIGEST", title="Digest", message="Hi")
    notify(recipient=buyer, notification_type="MARKETPLACE_ORDER", title="Gone", message="x", related_reference="not-a-uuid")
    notify(recipient=buyer, notification_type="RIDE_UPDATE", title="Ride", message="x", related_reference="6b0f7a4e-8a52-4a63-9d1a-0b6a2a4b7f10")
    for i in range(5):
        notify(recipient=buyer, notification_type="PRICE_DROP", title=f"Drop {i}", message="x", related_reference=listing_id)

    with django_assert_max_num_queries(12):  # a fixed number however many notifications there are
        rows = inbox(buyer)
    assert by_type(rows, "WEEKLY_DIGEST")["target"] is None
    assert [r["target"] for r in rows if r["title"] == "Gone"] == [None]
    assert by_type(rows, "RIDE_UPDATE")["target"]["kind"] == "ride"
    # Marking one read returns it with its target too.
    row = by_type(rows, "PRICE_DROP")
    marked = _auth_client(buyer).post(f"/api/my-notifications/{row['id']}/mark_read/").data
    assert marked["target"]["kind"] == "marketplace_listing"
