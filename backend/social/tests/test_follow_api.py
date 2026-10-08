"""Tests for the real Follow/Unfollow API — UC13 (docs/01's use-case
diagram) had fully built and unit-tested follow_user/unfollow_user/
toggle_follow/is_mutual_follow logic, but nothing ever exposed any of
it over HTTP."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_toggle_follow_follows_then_unfollows():
    follower = User.objects.create(username="follow_follower", phone="+237699995001")
    followee = User.objects.create(username="follow_followee", phone="+237699995002")
    client = _auth_client(follower)

    status_response = client.get(f"/api/users/{followee.id}/follow/")
    assert status_response.status_code == 200
    assert status_response.data["is_following"] is False
    assert status_response.data["follower_count"] == 0

    follow_response = client.post(f"/api/users/{followee.id}/follow/")
    assert follow_response.status_code == 200
    assert follow_response.data["is_following"] is True
    assert follow_response.data["follower_count"] == 1

    unfollow_response = client.post(f"/api/users/{followee.id}/follow/")
    assert unfollow_response.status_code == 200
    assert unfollow_response.data["is_following"] is False
    assert unfollow_response.data["follower_count"] == 0


@pytest.mark.django_db
def test_mutual_follow_is_reported_both_ways():
    user_a = User.objects.create(username="follow_mutual_a", phone="+237699995003")
    user_b = User.objects.create(username="follow_mutual_b", phone="+237699995004")

    _auth_client(user_a).post(f"/api/users/{user_b.id}/follow/")
    response = _auth_client(user_b).post(f"/api/users/{user_a.id}/follow/")

    assert response.data["is_mutual"] is True


@pytest.mark.django_db
def test_cannot_follow_self():
    user = User.objects.create(username="follow_self_user", phone="+237699995005")
    response = _auth_client(user).post(f"/api/users/{user.id}/follow/")
    assert response.status_code == 400
