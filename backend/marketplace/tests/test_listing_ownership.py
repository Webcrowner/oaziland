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
