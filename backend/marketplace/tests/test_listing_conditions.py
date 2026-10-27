"""Marketplace listing conditions: validated, replaceable, moderated, and frozen while an order is active."""
import pytest
from identity.models import User
from marketplace.models import ListingCondition
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import deal, _order, _pending_order, fee_policy  # noqa: F401

URL = "/api/listing-conditions/"


def _payload(listing_id, structured=None, clause="", target="marketplace.WarehouseListing"):
    return {"target_content_type": target, "target_id": listing_id, "structured_conditions": structured or {}, "free_text_clause": clause}


def _stored(listing_id):
    return ListingCondition.objects.filter(target_id=listing_id)


@pytest.mark.django_db
def test_the_lister_sets_conditions_and_the_public_can_read_them(deal):
    seller, _, listing_id = deal
    structured = {"min_lease_months": 12, "deposit_required": True, "pet_policy": "NO_PETS", "insurance_required": False}

    response = _auth_client(seller).post(URL, _payload(listing_id, structured, " Viewing by appointment. "), format="json")

    assert response.status_code == 201, response.data
    assert response.data["free_text_clause"] == "Viewing by appointment."
    from rest_framework.test import APIClient
    public = APIClient().get(f"{URL}?target_content_type=marketplace.WarehouseListing&target_id={listing_id}")
    assert public.status_code == 200 and public.data[0]["structured_conditions"] == structured


@pytest.mark.django_db
def test_posting_again_replaces_earlier_conditions_and_empty_input_clears_them(deal):
    seller, _, listing_id = deal
    client = _auth_client(seller)
    assert client.post(URL, _payload(listing_id, {"no_subletting": True}), format="json").status_code == 201
    assert client.post(URL, _payload(listing_id, {"driver_required": True}, "Updated"), format="json").status_code == 201

    rows = list(_stored(listing_id))
    assert len(rows) == 1 and rows[0].structured_conditions == {"driver_required": True} and rows[0].free_text_clause == "Updated"

    assert client.post(URL, _payload(listing_id), format="json").status_code == 204
    assert not _stored(listing_id).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("structured", [
    {"unknown_rule": True},
    {"deposit_required": "yes"},
    {"min_lease_months": 0},
    {"min_lease_months": 121},
    {"min_lease_months": True},
    {"min_lease_months": "12"},
    {"mileage_cap_km": -1},
    {"pet_policy": ""},
    {"pet_policy": "x" * 51},
    {"pet_policy": 5},
])
def test_invalid_structured_conditions_are_rejected(deal, structured):
    seller, _, listing_id = deal
    response = _auth_client(seller).post(URL, _payload(listing_id, structured), format="json")
    assert response.status_code == 400
    assert "structured_conditions" in response.data
    assert not _stored(listing_id).exists()


@pytest.mark.django_db
def test_conditions_must_be_an_object_and_the_clause_is_length_limited(deal):
    seller, _, listing_id = deal
    client = _auth_client(seller)
    assert client.post(URL, _payload(listing_id, ["no_subletting"]), format="json").status_code == 400
    assert client.post(URL, _payload(listing_id, clause="x" * 2001), format="json").status_code == 400
    assert client.post(URL, _payload(listing_id, clause="x" * 2000), format="json").status_code == 201


@pytest.mark.django_db
def test_only_known_listing_types_can_be_targeted(deal):
    seller, _, listing_id = deal
    for target in ("identity.User", "marketplace.MarketplaceOrder", "nonsense"):
        response = _auth_client(seller).post(URL, _payload(listing_id, {"no_subletting": True}, target=target), format="json")
        assert response.status_code == 400, target
        assert "target_content_type" in response.data


@pytest.mark.django_db
def test_a_stranger_cannot_change_someone_elses_conditions(deal):
    seller, _, listing_id = deal
    _auth_client(seller).post(URL, _payload(listing_id, {"no_subletting": True}), format="json")
    stranger = _verify(User.objects.create(username="cond_stranger", phone="+237699600001"))

    response = _auth_client(stranger).post(URL, _payload(listing_id), format="json")

    assert response.status_code == 403
    assert _stored(listing_id).count() == 1


@pytest.mark.django_db
def test_prohibited_wording_in_the_clause_is_blocked(deal):
    seller, _, listing_id = deal
    response = _auth_client(seller).post(URL, _payload(listing_id, clause="contains badword here"), format="json")
    assert response.status_code == 400 and "moderation" in response.data["detail"]
    assert not _stored(listing_id).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("paid", [False, True])
def test_conditions_cannot_change_while_an_order_is_active(deal, paid):
    seller, buyer, listing_id = deal
    seller_client = _auth_client(seller)
    assert seller_client.post(URL, _payload(listing_id, {"no_subletting": True}), format="json").status_code == 201
    placed = (_order if paid else _pending_order)(_auth_client(buyer), listing_id)
    assert placed.status_code == (200 if paid else 202), placed.data

    response = seller_client.post(URL, _payload(listing_id, {"no_subletting": False}), format="json")

    assert response.status_code == 409
    assert _stored(listing_id).get().structured_conditions == {"no_subletting": True}
