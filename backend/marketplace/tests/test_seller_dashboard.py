"""The seller dashboard: totals, fee breakdown, payout history and the CSV export."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient

from identity.models import User
from marketplace.models import GoodsListing
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import fee_policy  # noqa: F401
from marketplace.tests.test_fulfilment import seller, buyer, goods, place, url  # noqa: F401

DASHBOARD = "/api/marketplace-seller/dashboard/"


def complete(seller, buyer, goods, **kwargs):
    order = place(_auth_client(buyer), goods, **kwargs)
    _auth_client(seller).post(url(order["id"], "hand-over"))
    assert _auth_client(buyer).post(url(order["id"], "confirm")).data["status"] == "COMPLETED"
    return order["id"]


@pytest.fixture
def sold(seller, buyer, goods):
    """Two completed sales (10 000 and 20 000 XAF at a 5% fee), one open order and one cancelled."""
    complete(seller, buyer, goods)
    complete(seller, buyer, goods, quantity=2)
    place(_auth_client(buyer), goods)
    cancelled = place(_auth_client(buyer), goods)["id"]
    _auth_client(buyer).post(url(cancelled, "cancel"))
    return goods


@pytest.mark.django_db
def test_the_overview_adds_up_sales_fees_and_what_is_still_held(seller, sold):
    data = _auth_client(seller).get(DASHBOARD + "?period=30d").data
    s = data["summary"]
    assert s["orders_completed"] == 2 and s["orders_cancelled"] == 1 and s["orders_open"] == 1 and s["items_sold"] == 3
    assert s["gross_sales_xaf"] == "30000" and s["platform_fees_xaf"] == "1500" and s["net_earnings_xaf"] == "28500"
    assert s["average_order_xaf"] == "15000" and s["held_in_escrow_xaf"] == "10000"
    assert Decimal(s["wallet_balance_xaf"]) == Decimal("28500")

    assert data["by_category"] == [{"category": "goods", "orders": 2, "gross_xaf": "30000", "net_xaf": "28500"}]
    assert data["top_listings"][0]["title"] == "Gas cooker" and data["top_listings"][0]["gross_xaf"] == "30000"
    assert data["series"]["bucket"] == "day" and sum(p["orders"] for p in data["series"]["points"]) == 2
    assert sum(Decimal(p["net_xaf"]) for p in data["series"]["points"]) == Decimal("28500")
    assert _auth_client(seller).get(DASHBOARD + "?period=all").data["series"]["bucket"] == "month"


@pytest.mark.django_db
def test_a_partial_refund_is_taken_out_of_gross_sales(seller, buyer, goods):
    order_id = place(_auth_client(buyer), goods)["id"]
    _auth_client(seller).post(url(order_id, "hand-over"))
    _auth_client(buyer).post(url(order_id, "return-request"), {
        "kind": "PARTIAL_REFUND", "reason": "DAMAGED", "description": "Scratched on one side.", "requested_amount_xaf": "4000",
    }, format="json")
    _auth_client(seller).post(url(order_id, "return-respond"), {"decision": "ACCEPT"}, format="json")
    s = _auth_client(seller).get(DASHBOARD).data["summary"]
    assert s["refunded_xaf"] == "4000" and s["gross_sales_xaf"] == "6000"
    assert Decimal(s["net_earnings_xaf"]) + Decimal(s["platform_fees_xaf"]) == Decimal("6000")


@pytest.mark.django_db
def test_a_seller_with_no_sales_sees_zeros_and_others_data_stays_private(sold, buyer):
    summary = _auth_client(buyer).get(DASHBOARD).data["summary"]
    assert summary["orders_total"] == 0 and summary["net_earnings_xaf"] == "0" and summary["average_order_xaf"] == "0"
    assert APIClient().get(DASHBOARD).status_code == 401
    assert _auth_client(buyer).get(DASHBOARD + "?period=yesterday").status_code == 400


@pytest.mark.django_db
def test_the_payout_history_lists_each_sale_with_its_fee(seller, sold):
    data = _auth_client(seller).get("/api/marketplace-seller/payouts/").data
    assert data["count"] == 2
    assert sorted((r["gross_xaf"], r["fee_xaf"], r["net_xaf"]) for r in data["results"]) == [("10000", "500", "9500"), ("20000", "1000", "19000")]
    assert {r["listing_title"] for r in data["results"]} == {"Gas cooker"}


@pytest.mark.django_db
def test_the_csv_has_every_order_and_neutralises_spreadsheet_formulas(seller, sold):
    GoodsListing.objects.filter(pk=sold).update(title='=HYPERLINK("http://evil")')
    response = _auth_client(seller).get("/api/marketplace-seller/sales.csv?period=all")
    assert response.status_code == 200 and response["Content-Type"].startswith("text/csv")
    assert "attachment" in response["Content-Disposition"]
    text = response.content.decode("utf-8-sig")
    lines = text.strip().splitlines()
    assert lines[0].startswith("order_id,created_at,completed_at,status,category,listing")
    assert len(lines) == 5  # header + 4 orders
    assert "'=HYPERLINK" in text and ",=HYPERLINK" not in text
    assert sum(1 for line in lines if ",COMPLETED," in line) == 2
