"""
Tests for the real flyer generation API — closing a genuine gap:
generate_flyer() already composed a real, printable PNG (a real QR
code, real logo/headline layout via Pillow) and saved it as a real
file, but nothing ever exposed this over HTTP.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from flyers.models import Flyer


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_generating_a_real_flyer_for_a_single_listing():
    user = User.objects.create(username="flyer_user", phone="+237699444401")
    client = _auth_client(user)

    response = client.post("/api/flyers/", {
        "category": "HOUSE_FOR_RENT", "finish_level": "MODERN", "headline_details": "2 Bedrooms, Bastos",
        "qr_target_type": "SINGLE_LISTING", "qr_target_id": "11111111-1111-1111-1111-111111111111",
    }, format="json")

    assert response.status_code == 201
    assert response.data["qr_target_url"] == "https://oaziland.com/listing/11111111-1111-1111-1111-111111111111"
    assert response.data["generated_image"]  # a real file path was returned

    flyer = Flyer.objects.get(id=response.data["id"])
    assert flyer.generated_image.name  # a real file genuinely exists on disk


@pytest.mark.django_db
def test_generating_a_flyer_for_a_quarter_search():
    user = User.objects.create(username="flyer_quarter_user", phone="+237699444402")
    client = _auth_client(user)

    response = client.post("/api/flyers/", {
        "category": "HOUSE_FOR_RENT", "qr_target_type": "QUARTER_SEARCH", "quarter_id": "22222222-2222-2222-2222-222222222222",
    }, format="json")

    assert response.status_code == 201
    assert "quarter=22222222" in response.data["qr_target_url"]


@pytest.mark.django_db
def test_unknown_qr_target_type_returns_a_clean_error():
    user = User.objects.create(username="flyer_bad_target_user", phone="+237699444403")
    client = _auth_client(user)

    response = client.post("/api/flyers/", {"category": "HOUSE_FOR_RENT", "qr_target_type": "NOT_A_REAL_TYPE"}, format="json")

    assert response.status_code == 400


@pytest.mark.django_db
def test_flyers_are_scoped_to_the_requester():
    user_a = User.objects.create(username="flyer_scope_a", phone="+237699444404")
    user_b = User.objects.create(username="flyer_scope_b", phone="+237699444405")
    _auth_client(user_a).post("/api/flyers/", {
        "category": "HOUSE_FOR_RENT", "qr_target_type": "SINGLE_LISTING", "qr_target_id": "11111111-1111-1111-1111-111111111111",
    }, format="json")

    a_list = _auth_client(user_a).get("/api/flyers/")
    b_list = _auth_client(user_b).get("/api/flyers/")

    assert a_list.data["count"] == 1
    assert b_list.data["count"] == 0


@pytest.mark.django_db
def test_flyer_generation_requires_authentication():
    response = APIClient().post("/api/flyers/", {"category": "HOUSE_FOR_RENT", "qr_target_type": "SINGLE_LISTING"})
    assert response.status_code == 401
