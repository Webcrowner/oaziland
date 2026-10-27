"""Only a listing's own lister (or an admin) can edit, delete or change the status of a marketplace listing."""
import pytest
from marketplace.models import WarehouseListing, CarListing
from identity.models import User, AdminProfile
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401


def _listing(owner, client, quarter, **extra):
    response = client.post("/api/warehouses/", {
        "title": "Owner warehouse", "price_basis": "RENT_MONTHLY", "price_xaf": "500000",
        "quarter": str(quarter.id), "size_sqm": "800", **extra,
    })
    assert response.status_code == 201, response.data
    return response.data["id"]


@pytest.fixture
def parties(quarter):
    owner = _verify(User.objects.create(username="own_owner", phone="+237699100101"))
    stranger = User.objects.create(username="own_stranger", phone="+237699100102")
    listing_id = _listing(owner, _auth_client(owner), quarter)
    return owner, stranger, listing_id


@pytest.mark.django_db
def test_a_stranger_cannot_edit_or_delete_someone_elses_listing(parties):
    owner, stranger, listing_id = parties
    url = f"/api/warehouses/{listing_id}/"

    assert _auth_client(stranger).patch(url, {"price_xaf": "1"}, format="json").status_code == 403
    assert _auth_client(stranger).put(url, {"title": "x", "price_basis": "SALE", "price_xaf": "1", "size_sqm": "1"}, format="json").status_code == 403
    assert _auth_client(stranger).delete(url).status_code == 403
    assert _auth_client(stranger).post(f"{url}set-status/", {"status": "UNAVAILABLE"}, format="json").status_code == 403

    listing = WarehouseListing.objects.get(pk=listing_id)
    assert str(listing.price_xaf) == "500000.00" and listing.availability_status == "AVAILABLE"


@pytest.mark.django_db
def test_anonymous_users_cannot_edit_or_delete_listings(parties):
    from rest_framework.test import APIClient
    _, _, listing_id = parties
    url = f"/api/warehouses/{listing_id}/"
    assert APIClient().patch(url, {"price_xaf": "1"}, format="json").status_code == 401
    assert APIClient().delete(url).status_code == 401


@pytest.mark.django_db
def test_the_lister_can_edit_change_status_and_delete(parties):
    owner, _, listing_id = parties
    client = _auth_client(owner)
    url = f"/api/warehouses/{listing_id}/"

    assert client.patch(url, {"price_xaf": "450000", "title": "Reduced"}, format="json").status_code == 200
    listing = WarehouseListing.objects.get(pk=listing_id)
    assert str(listing.price_xaf) == "450000.00" and listing.title == "Reduced"
    # Fields the lister must not control stay untouched.
    assert client.patch(url, {"lister_role": "AGENCY", "availability_status": "UNAVAILABLE"}, format="json").status_code == 200
    listing.refresh_from_db()
    assert listing.lister_role == "OWNER" and listing.availability_status == "AVAILABLE"

    assert client.post(f"{url}set-status/", {"status": "UNDER_OFFER"}, format="json").data["availability_status"] == "UNDER_OFFER"
    assert client.post(f"{url}set-status/", {"status": "NOPE"}, format="json").status_code == 400

    assert client.delete(url).status_code == 204
    assert not WarehouseListing.objects.filter(pk=listing_id).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("field,value", [
    ("price_xaf", "0"),
    ("price_xaf", "-1"),
    ("size_sqm", "0"),
    ("size_sqm", "-1"),
])
def test_listing_rejects_non_positive_prices_and_sizes(quarter, field, value):
    owner = _verify(User.objects.create(username=f"invalid_{field}_{value}", phone=f"+2376992{abs(hash((field, value))) % 1000000:06d}"))
    payload = {
        "title": "Invalid warehouse", "price_basis": "SALE", "price_xaf": "1000",
        "quarter": str(quarter.id), "size_sqm": "10", field: value,
    }

    response = _auth_client(owner).post("/api/warehouses/", payload, format="json")

    assert response.status_code == 400
    assert field in response.data


@pytest.mark.django_db
def test_an_admin_can_moderate_a_listing(parties):
    _, _, listing_id = parties
    admin = User.objects.create(username="own_admin", phone="+237699100103")
    AdminProfile.objects.create(user=admin)
    assert _auth_client(admin).delete(f"/api/warehouses/{listing_id}/").status_code == 204


@pytest.mark.django_db
def test_unavailable_listings_leave_the_public_list_but_stay_in_my_listings(parties):
    owner, stranger, listing_id = parties
    client = _auth_client(owner)
    client.post(f"/api/warehouses/{listing_id}/set-status/", {"status": "UNAVAILABLE"}, format="json")

    public = _auth_client(stranger).get("/api/warehouses/").data["results"]
    assert listing_id not in [row["id"] for row in public]
    mine = client.get("/api/warehouses/mine/")
    assert mine.status_code == 200 and listing_id in [row["id"] for row in mine.data["results"]]
    assert _auth_client(stranger).get("/api/warehouses/mine/").data["results"] == []

    from rest_framework.test import APIClient
    assert APIClient().get("/api/warehouses/mine/").status_code == 401


@pytest.mark.django_db
def test_editing_a_car_updates_its_vehicle_details(quarter):
    owner = _verify(User.objects.create(username="own_carowner", phone="+237699100104"))
    client = _auth_client(owner)
    created = client.post("/api/cars/", {
        "title": "Corolla", "price_basis": "SALE", "price_xaf": "4000000", "quarter": str(quarter.id),
        "vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2012, "mileage_km": 150000},
    }, format="json")
    assert created.status_code == 201, created.data

    response = client.patch(f"/api/cars/{created.data['id']}/", {"vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2012, "mileage_km": 160000}}, format="json")
    assert response.status_code == 200, response.data
    assert CarListing.objects.get(pk=created.data["id"]).vehicle_spec.mileage_km == 160000


@pytest.mark.django_db
def test_the_full_edit_form_payload_can_change_and_clear_every_field(quarter):
    from marketplace.models import BusinessListing
    owner = _verify(User.objects.create(username="own_fulledit", phone="+237699100105"))
    client = _auth_client(owner)

    car = client.post("/api/cars/", {
        "title": "Corolla", "price_basis": "SALE", "price_xaf": "4000000", "quarter": str(quarter.id),
        "vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2012, "mileage_km": 150000, "engine_size_cc": 1600},
    }, format="json")
    assert car.status_code == 201, car.data
    edited = client.patch(f"/api/cars/{car.data['id']}/", {
        "title": "Corolla LE", "description": "Clean", "price_xaf": "3900000", "price_basis": "RENT_MONTHLY", "quarter": None,
        "vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2013, "mileage_km": None, "engine_size_cc": None},
    }, format="json")
    assert edited.status_code == 200, edited.data
    saved = CarListing.objects.get(pk=car.data["id"])
    assert (saved.price_basis, saved.quarter_id, saved.vehicle_spec.year) == ("RENT_MONTHLY", None, 2013)
    assert saved.vehicle_spec.mileage_km is None and saved.vehicle_spec.engine_size_cc is None

    business = client.post("/api/businesses/", {
        "title": "Cafe", "price_basis": "SALE", "price_xaf": "9000000", "quarter": str(quarter.id),
        "size_sqm": "40", "seating_capacity": 20, "annual_revenue_xaf": "5000000", "includes_goodwill": True,
    }, format="json")
    assert business.status_code == 201, business.data
    cleared = client.patch(f"/api/businesses/{business.data['id']}/", {
        "size_sqm": None, "seating_capacity": None, "annual_revenue_xaf": None, "includes_goodwill": False, "includes_inventory": True,
    }, format="json")
    assert cleared.status_code == 200, cleared.data
    row = BusinessListing.objects.get(pk=business.data["id"])
    assert (row.size_sqm, row.seating_capacity, row.annual_revenue_xaf) == (None, None, None)
    assert (row.includes_goodwill, row.includes_inventory) == (False, True)


@pytest.mark.django_db
def test_media_must_be_a_real_url_of_a_known_type_and_is_capped(parties):
    owner, _, listing_id = parties
    client = _auth_client(owner)
    url = f"/api/warehouses/{listing_id}/add-media/"

    assert client.post(url, {"url": "not a url", "media_type": "PHOTO"}, format="json").status_code == 400
    assert client.post(url, {"url": "https://example.com/a.jpg", "media_type": "SCRIPT"}, format="json").status_code == 400
    assert client.post(url, {"media_type": "PHOTO"}, format="json").status_code == 400
    assert client.post(url, {"url": "https://example.com/a.jpg"}, format="json").status_code == 201

    for i in range(19):
        assert client.post(url, {"url": f"https://example.com/{i}.jpg", "media_type": "PHOTO"}, format="json").status_code == 201
    assert client.post(url, {"url": "https://example.com/over.jpg", "media_type": "PHOTO"}, format="json").status_code == 400
