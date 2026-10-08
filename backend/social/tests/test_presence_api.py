"""Real presence over HTTP: heartbeat endpoint + presence in the conversation list."""
import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from social.models import Conversation, UserPresence


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def pair(db):
    me = User.objects.create(username="presence_me", phone="+237699444401")
    other = User.objects.create(username="presence_other", phone="+237699444402")
    conv = Conversation.objects.create()
    conv.participants.add(me, other)
    return me, other


def _other_details(me):
    response = _auth_client(me).get("/api/conversations/")
    assert response.status_code == 200
    return response.data["results"][0]["participants_details"][0]


@pytest.mark.django_db
def test_heartbeat_requires_authentication():
    assert APIClient().post("/api/presence/heartbeat/").status_code == 401


@pytest.mark.django_db
def test_never_seen_user_is_reported_offline_without_a_last_seen(pair):
    me, _ = pair
    details = _other_details(me)
    assert details["is_online"] is False
    assert details["last_seen_at"] is None


@pytest.mark.django_db
def test_heartbeat_makes_user_show_online_to_the_other_participant(pair):
    me, other = pair
    assert _auth_client(other).post("/api/presence/heartbeat/").status_code == 204
    details = _other_details(me)
    assert details["is_online"] is True
    assert details["last_seen_at"] is not None


@pytest.mark.django_db
def test_stale_heartbeat_shows_offline_with_a_real_last_seen(pair):
    me, other = pair
    _auth_client(other).post("/api/presence/heartbeat/")
    stale = timezone.now() - timedelta(minutes=30)
    UserPresence.objects.filter(user=other).update(last_seen_at=stale)
    details = _other_details(me)
    assert details["is_online"] is False
    assert details["last_seen_at"] is not None


@pytest.mark.django_db
def test_explicit_offline_endpoint_marks_user_offline(pair):
    me, other = pair
    _auth_client(other).post("/api/presence/heartbeat/")
    assert _auth_client(other).post("/api/presence/offline/").status_code == 204
    assert _other_details(me)["is_online"] is False


@pytest.mark.django_db
def test_hidden_online_status_leaks_neither_online_nor_last_seen(pair):
    me, other = pair
    _auth_client(other).post("/api/presence/heartbeat/")
    UserPresence.objects.filter(user=other).update(show_online_status=False)
    details = _other_details(me)
    assert details["is_online"] is False
    assert details["last_seen_at"] is None
