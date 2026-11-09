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


@pytest.fixture
def seeded_cars(quarter):
    client = _auth_client(_verify(User.objects.create(username="ls_car_lister", phone="+237699400005")))
    for title, make, model, year, mileage in [
        ("Family sedan", "Toyota", "Corolla", 2012, 180000),
        ("Weekend runabout", "Toyota", "Yaris", 2019, 40000),
        ("Work pickup", "Nissan", "Hardbody", 2016, None),
    ]:
        spec = {"make": make, "model": model, "year": year}
        if mileage is not None:
            spec["mileage_km"] = mileage
        response = client.post("/api/cars/", {
            "title": title, "price_basis": "SALE", "price_xaf": "5000000", "quarter": str(quarter.id), "vehicle_spec": spec,
        }, format="json")
        assert response.status_code == 201, response.data


def _car_titles(query):
    return sorted(r["title"] for r in APIClient().get(f"/api/cars/?{query}").data["results"])


@pytest.mark.django_db
def test_cars_filter_by_make_year_and_mileage(seeded_cars):
    assert _car_titles("make=toyota") == ["Family sedan", "Weekend runabout"]
    assert _car_titles("min_year=2015") == ["Weekend runabout", "Work pickup"]
    assert _car_titles("max_year=2015") == ["Family sedan"]
    assert _car_titles("make=toyota&min_year=2015&max_year=2020") == ["Weekend runabout"]
    # A car with no recorded mileage can't be shown to satisfy a mileage cap.
    assert _car_titles("max_mileage_km=100000") == ["Weekend runabout"]


@pytest.mark.django_db
def test_car_text_search_matches_make_and_model(seeded_cars):
    assert _car_titles("q=hardbody") == ["Work pickup"]
    assert _car_titles("q=nissan") == ["Work pickup"]


@pytest.mark.django_db
def test_car_filters_are_ignored_by_other_categories_and_bad_numbers_rejected(seeded, seeded_cars):
    assert APIClient().get("/api/warehouses/?make=toyota&min_year=2015").data["count"] == 3
    assert APIClient().get("/api/cars/?min_year=abc").status_code == 400
    assert APIClient().get("/api/cars/?max_mileage_km=1.5").status_code == 400


@pytest.mark.django_db
def test_the_combined_feed_merges_categories_in_one_global_order(seeded, seeded_cars):
    data = APIClient().get("/api/marketplace-feed/?ordering=price_asc").data

    assert data["count"] == 6
    assert [r["title"] for r in data["results"]] == ["Cheap shed", "Middle depot", "Grand hall", "Work pickup", "Weekend runabout", "Family sedan"]
    assert {r["category"] for r in data["results"]} == {"warehouses", "cars"}
    prices = [float(r["price_xaf"]) for r in data["results"]]
    assert prices == sorted(prices)
    assert APIClient().get("/api/marketplace-feed/?ordering=price_desc").data["results"][-1]["title"] == "Cheap shed"


@pytest.mark.django_db
def test_the_combined_feed_filters_and_pages_exactly(quarter, seeded_cars):
    client = _auth_client(_verify(User.objects.create(username="ls_feed_pager", phone="+237699400006")))
    for index in range(22):
        _post(client, quarter, f"Depot {index:02d}", str(1000 + index))

    first = APIClient().get("/api/marketplace-feed/?ordering=price_asc").data
    second = APIClient().get("/api/marketplace-feed/?ordering=price_asc&page=2").data

    assert first["count"] == 25 and len(first["results"]) == 20 and first["next"]
    assert len(second["results"]) == 5 and second["next"] is None
    # The three cars all cost more than every warehouse, so they close the merged list.
    assert {r["category"] for r in second["results"]} >= {"cars"}
    assert APIClient().get("/api/marketplace-feed/?page=3").status_code == 404
    assert APIClient().get("/api/marketplace-feed/?q=corolla").data["count"] == 1
    assert APIClient().get("/api/marketplace-feed/?price_basis=bogus").status_code == 400


@pytest.mark.django_db
def test_the_combined_feed_pages_in_the_database_with_a_fixed_number_of_queries(quarter, seeded_cars, django_assert_max_num_queries):
    client = _auth_client(_verify(User.objects.create(username="ls_feed_queries", phone="+237699400007")))
    for index in range(22):
        _post(client, quarter, f"Depot {index:02d}", str(1000 + index))

    # 5 counts + 5 key lookups + at most 5 row loads, each with its photo prefetch: not one query per listing.
    with django_assert_max_num_queries(20):
        data = APIClient().get("/api/marketplace-feed/?ordering=price_asc&page=2").data
    assert len(data["results"]) == 5

    with django_assert_max_num_queries(12):
        assert APIClient().get("/api/warehouses/?ordering=price_asc").data["count"] == 22


@pytest.mark.django_db
def test_browsing_the_marketplace_is_not_limited_by_the_anonymous_hourly_budget(seeded):
    from django.conf import settings

    anon_budget = int(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["anon"].split("/")[0])
    client = APIClient()
    # Five lists per "All"-tab load; enough loads to blow through the generic anonymous budget.
    for _ in range(anon_budget // 5 + 2):
        for category in ("goods", "cars", "stores", "warehouses", "businesses"):
            assert client.get(f"/api/{category}/").status_code == 200


def _post_at(client, quarter, title, latitude, longitude, category="warehouses"):
    payload = {"title": title, "price_basis": "SALE", "price_xaf": "1000", "quarter": str(quarter.id), "latitude": latitude, "longitude": longitude}
    if category == "warehouses":
        payload["size_sqm"] = "100"
    else:
        payload["vehicle_spec"] = {"make": "Toyota", "model": "Corolla", "year": 2015}
    response = client.post(f"/api/{category}/", payload, format="json")
    assert response.status_code == 201, response.data


@pytest.fixture
def located(quarter):
    client = _auth_client(_verify(User.objects.create(username="ls_geo_lister", phone="+237699400008")))
    _post_at(client, quarter, "Mid-distance depot", "3.9500000", "11.5200000")
    _post_at(client, quarter, "Close car", "3.8600000", "11.5100000", category="cars")
    _post_at(client, quarter, "Douala depot", "4.0500000", "9.7000000")
    _post(client, quarter, "Unlocated depot", "100")


@pytest.mark.django_db
def test_listings_near_a_point_are_within_the_radius_nearest_first_with_distance(located):
    data = APIClient().get("/api/warehouses/?near_lat=3.848&near_lng=11.502&radius_km=50&ordering=distance").data
    assert [r["title"] for r in data["results"]] == ["Mid-distance depot"]
    assert 10 < data["results"][0]["distance_km"] < 13

    wide = APIClient().get("/api/warehouses/?near_lat=3.848&near_lng=11.502&radius_km=300&ordering=distance").data
    assert [r["title"] for r in wide["results"]] == ["Mid-distance depot", "Douala depot"]
    assert wide["results"][1]["distance_km"] > 150
    # Listings with no map position can't be placed, so they only appear without a location filter.
    assert APIClient().get("/api/warehouses/").data["count"] == 3


@pytest.mark.django_db
def test_the_combined_feed_orders_nearest_first_across_categories(located):
    data = APIClient().get("/api/marketplace-feed/?near_lat=3.848&near_lng=11.502&radius_km=50&ordering=distance").data
    assert [(r["category"], r["title"]) for r in data["results"]] == [("cars", "Close car"), ("warehouses", "Mid-distance depot")]
    assert data["results"][0]["distance_km"] < data["results"][1]["distance_km"]
    # Distance is still reported when sorting by something else.
    by_price = APIClient().get("/api/marketplace-feed/?near_lat=3.848&near_lng=11.502&radius_km=50&ordering=price_asc").data
    assert all(r["distance_km"] is not None for r in by_price["results"])
    assert APIClient().get("/api/marketplace-feed/").data["results"][0]["distance_km"] is None


@pytest.mark.django_db
def test_bad_location_filters_are_rejected(located):
    for query in ("ordering=distance", "near_lat=3.8", "near_lat=abc&near_lng=11", "near_lat=95&near_lng=11", "near_lat=3.8&near_lng=11&radius_km=0",
                  "near_lat=3.8&near_lng=11&radius_km=5000"):
        assert APIClient().get(f"/api/marketplace-feed/?{query}").status_code == 400, query


@pytest.mark.django_db
def test_a_marketplace_listing_can_be_saved_and_unsaved(quarter):
    lister = _verify(User.objects.create(username="ls_lister2", phone="+237699400002"))
    listing_id = _post(_auth_client(lister), quarter, "Saveable", "150000")
    buyer = _auth_client(User.objects.create(username="ls_saver", phone="+237699400003"))

    assert buyer.post(f"/api/listings/{listing_id}/toggle-favorite/").data["is_favorited"] is True
    assert listing_id in [str(i) for i in buyer.get("/api/my-favorites/").data["listing_ids"]]
    assert buyer.post(f"/api/listings/{listing_id}/toggle-favorite/").data["is_favorited"] is False
