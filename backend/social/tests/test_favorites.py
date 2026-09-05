"""
Tests for real favorites — closing a genuine gap: the Favorite model
existed and was even USED (feeding get_recommended_feed's interest-tag
matching), but nothing ever let a user actually save a listing.
"""
import pytest
import uuid
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from social.models import Favorite
from social.services import favorite_listing, unfavorite_listing, is_listing_favorited, toggle_favorite_listing


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_favoriting_and_unfavoriting_a_listing():
    user = User.objects.create(username="favorite_user", phone="+237699555501")
    listing_id = uuid.uuid4()

    assert is_listing_favorited(user=user, listing_id=listing_id) is False
    favorite_listing(user=user, listing_id=listing_id)
    assert is_listing_favorited(user=user, listing_id=listing_id) is True

    unfavorite_listing(user=user, listing_id=listing_id)
    assert is_listing_favorited(user=user, listing_id=listing_id) is False


@pytest.mark.django_db
def test_favoriting_the_same_listing_twice_does_not_duplicate():
    user = User.objects.create(username="favorite_dedup_user", phone="+237699555502")
    listing_id = uuid.uuid4()

    favorite_listing(user=user, listing_id=listing_id)
    favorite_listing(user=user, listing_id=listing_id)

    assert Favorite.objects.filter(user=user, listing_id=listing_id).count() == 1


@pytest.mark.django_db
def test_toggle_favorite_real_api_flow():
    user = User.objects.create(username="favorite_api_user", phone="+237699555503")
    listing_id = uuid.uuid4()
    client = _auth_client(user)

    first_toggle = client.post(f"/api/listings/{listing_id}/toggle-favorite/")
    assert first_toggle.status_code == 200
    assert first_toggle.data["is_favorited"] is True

    second_toggle = client.post(f"/api/listings/{listing_id}/toggle-favorite/")
    assert second_toggle.data["is_favorited"] is False

    favorites_list = client.get("/api/my-favorites/")
    assert str(listing_id) not in favorites_list.data["listing_ids"]


@pytest.mark.django_db
def test_my_favorites_are_scoped_to_the_requester():
    user_a = User.objects.create(username="favorite_scope_a", phone="+237699555504")
    user_b = User.objects.create(username="favorite_scope_b", phone="+237699555505")
    listing_id = uuid.uuid4()

    favorite_listing(user=user_a, listing_id=listing_id)

    a_favorites = _auth_client(user_a).get("/api/my-favorites/")
    b_favorites = _auth_client(user_b).get("/api/my-favorites/")

    assert str(listing_id) in a_favorites.data["listing_ids"]
    assert str(listing_id) not in b_favorites.data["listing_ids"]


@pytest.mark.django_db
def test_favorites_require_authentication():
    response = APIClient().get("/api/my-favorites/")
    assert response.status_code == 401
