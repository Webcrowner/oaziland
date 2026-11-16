"""Support's returns queue."""
import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.test import APIClient

from identity.models import AdminProfile
from marketplace.fulfilment import process_return_requests
from marketplace.models import MarketplaceReturnRequest
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import fee_policy  # noqa: F401
from marketplace.tests.test_fulfilment import seller, buyer, goods, place, url, ask, handed_over  # noqa: F401
from identity.models import User

QUEUE = "/api/admin/marketplace-returns/"


@pytest.fixture
def support(db):
    admin = _verify(User.objects.create(username="rt_admin", phone="+237699600099"))
    AdminProfile.objects.create(user=admin)
    return _auth_client(admin)


@pytest.mark.django_db
def test_support_sees_requests_with_their_order_parties_and_escalation(seller, buyer, goods, support):
    quiet = handed_over(seller, buyer, goods)
    ask(_auth_client(buyer), quiet, evidence_urls=["https://cdn.example.com/a.jpg"])
    escalated = handed_over(seller, buyer, goods)
    ask(_auth_client(buyer), escalated)
    _auth_client(seller).post(url(escalated, "return-respond"), {"decision": "REJECT", "note": "It was fine."}, format="json")
    _auth_client(buyer).post(url(escalated, "return-escalate"))

    summary = support.get(QUEUE + "summary/").data
    assert (summary["waiting"], summary["escalated"], summary["total"]) == (1, 1, 2)

    waiting = support.get(QUEUE).data["results"]  # defaults to what is waiting on the seller
    assert [r["order"]["id"] for r in waiting] == [quiet]
    row = waiting[0]
    assert row["order"]["listing_title"] == "Gas cooker" and row["order"]["category"] == "goods"
    assert row["buyer"]["username"] == "ful_buyer" and row["seller"]["username"] == "ful_seller"
    assert row["evidence_urls"] == ["https://cdn.example.com/a.jpg"] and row["respond_by"] and row["dispute_id"] is None

    sent = support.get(QUEUE + "?state=escalated").data["results"][0]
    assert sent["order"]["id"] == escalated and sent["seller_note"] == "It was fine." and sent["dispute_id"]
    assert len(support.get(QUEUE + "?state=all").data["results"]) == 2
    assert [r["order"]["id"] for r in support.get(QUEUE + "?state=all&q=nomatch").data["results"]] == []
    assert support.get(QUEUE + "?state=bogus").status_code == 400


@pytest.mark.django_db
def test_only_admins_can_open_the_returns_queue(seller, buyer, goods):
    assert _auth_client(buyer).get(QUEUE).status_code == 403
    assert APIClient().get(QUEUE).status_code in (401, 403)
    assert _auth_client(seller).get(QUEUE + "summary/").status_code == 403
