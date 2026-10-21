"""Marketplace sorting, text search, price-basis filter, and saving a marketplace listing as a favourite."""
import pytest
from rest_framework.test import APIClient

from identity.models import User
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401


def _post(client, quarter, title, price, basis="RENT_MONTHLY", description=""):
    response = client.post("/api/warehouses/", {
        "title": title, "description": description, "price_basis": basis, "price_xaf": price,
        "quarter": str(quarter.id), "size_sqm": "200",
    })
    assert response.status_code == 201, response.data
    return response.data["id"]


@pytest.fixture
def seeded(quarter):
    user = _verify(User.objects.create(username="ls_lister", phone="+237699400001"))
    client = _auth_client(user)
    _post(client, quarter, "Middle depot", "300000")
    _post(client, quarter, "Cheap shed", "100000", description="Near the market")
    _post(client, quarter, "Grand hall", "900000", basis="SALE")
    return client


@pytest.mark.django_db
def test_listings_sort_by_price_both_ways(seeded):
    ascending = [r["title"] for r in APIClient().get("/api/warehouses/?ordering=price_asc").data["results"]]
    descending = [r["title"] for r in APIClient().get("/api/warehouses/?ordering=price_desc").data["results"]]
    assert ascending == ["Cheap shed", "Middle depot", "Grand hall"]
    assert descending == ["Grand hall", "Middle depot", "Cheap shed"]


@pytest.mark.django_db
def test_listings_default_to_newest_first(seeded):
    titles = [r["title"] for r in APIClient().get("/api/warehouses/").data["results"]]
    assert titles == ["Grand hall", "Cheap shed", "Middle depot"]


@pytest.mark.django_db
def test_listings_filter_by_price_basis_and_text(seeded):
    sale = APIClient().get("/api/warehouses/?price_basis=SALE").data
    assert [r["title"] for r in sale["results"]] == ["Grand hall"]
    found = APIClient().get("/api/warehouses/?q=market").data
    assert [r["title"] for r in found["results"]] == ["Cheap shed"]


@pytest.mark.django_db
def test_listings_are_paged_and_the_second_page_continues_the_sort(quarter):
    client = _auth_client(_verify(User.objects.create(username="ls_pager", phone="+237699400004")))
    for index in range(22):
        _post(client, quarter, f"Depot {index:02d}", str(1000 + index))

    first = APIClient().get("/api/warehouses/?ordering=price_asc").data
    second = APIClient().get("/api/warehouses/?ordering=price_asc&page=2").data

    assert first["count"] == 22 and len(first["results"]) == 20 and first["next"]
    assert [r["title"] for r in second["results"]] == ["Depot 20", "Depot 21"] and second["next"] is None
    assert APIClient().get("/api/warehouses/?page=3").status_code == 404


@pytest.mark.django_db
def test_bad_ordering_or_price_basis_is_rejected(seeded):
    assert APIClient().get("/api/warehouses/?ordering=bogus").status_code == 400
    assert APIClient().get("/api/warehouses/?price_basis=bogus").status_code == 400


@pytest.mark.django_db
def test_a_marketplace_listing_can_be_saved_and_unsaved(quarter):
    lister = _verify(User.objects.create(username="ls_lister2", phone="+237699400002"))
    listing_id = _post(_auth_client(lister), quarter, "Saveable", "150000")
    buyer = _auth_client(User.objects.create(username="ls_saver", phone="+237699400003"))

    assert buyer.post(f"/api/listings/{listing_id}/toggle-favorite/").data["is_favorited"] is True
    assert listing_id in [str(i) for i in buyer.get("/api/my-favorites/").data["listing_ids"]]
    assert buyer.post(f"/api/listings/{listing_id}/toggle-favorite/").data["is_favorited"] is False
