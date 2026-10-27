"""The token refresh endpoint must answer 401 (not 500) for a valid refresh
token whose user no longer exists, so the web app can send the user back to sign in."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User

REFRESH_URL = "/api/auth/login/refresh/"


@pytest.mark.django_db
def test_refresh_returns_new_access_token_for_existing_user():
    user = User.objects.create(username="refresh_ok", phone="+237699300001")
    res = APIClient().post(REFRESH_URL, {"refresh": str(RefreshToken.for_user(user))}, format="json")
    assert res.status_code == 200
    assert res.json()["access"]


@pytest.mark.django_db
def test_refresh_returns_401_when_token_user_was_deleted():
    user = User.objects.create(username="refresh_gone", phone="+237699300002")
    token = str(RefreshToken.for_user(user))
    user.delete()
    res = APIClient().post(REFRESH_URL, {"refresh": token}, format="json")
    assert res.status_code == 401


@pytest.mark.django_db
def test_refresh_returns_401_for_garbage_token():
    res = APIClient().post(REFRESH_URL, {"refresh": "not-a-token"}, format="json")
    assert res.status_code == 401
