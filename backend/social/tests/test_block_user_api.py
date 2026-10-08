"""Blocking a user over HTTP, and that it is actually enforced."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from social.models import Conversation


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def pair(db):
    me = User.objects.create(username="block_me", phone="+237699555501")
    other = User.objects.create(username="block_other", phone="+237699555502")
    conv = Conversation.objects.create()
    conv.participants.add(me, other)
    return me, other, conv


@pytest.mark.django_db
def test_block_and_unblock_round_trip(pair):
    me, other, _ = pair
    c = _client(me)
    assert c.get(f"/api/users/{other.id}/block/").data["is_blocked"] is False
    assert c.post(f"/api/users/{other.id}/block/").data["is_blocked"] is True
    assert c.get(f"/api/users/{other.id}/block/").data["is_blocked"] is True
    listed = c.get("/api/my-blocked-users/").data
    assert listed["count"] == 1 and listed["results"][0]["id"] == str(other.id)
    assert c.delete(f"/api/users/{other.id}/block/").data["is_blocked"] is False
    assert c.get("/api/my-blocked-users/").data["count"] == 0


@pytest.mark.django_db
def test_cannot_block_yourself(pair):
    me, _, _ = pair
    assert _client(me).post(f"/api/users/{me.id}/block/").status_code == 400


@pytest.mark.django_db
def test_block_requires_authentication(pair):
    _, other, _ = pair
    assert APIClient().post(f"/api/users/{other.id}/block/").status_code == 401


@pytest.mark.django_db
def test_blocking_stops_messages_in_both_directions_without_revealing_who_blocked(pair):
    me, other, conv = pair
    assert _client(me).post(f"/api/conversations/{conv.id}/send/", {"text": "hi"}, format="json").status_code == 201
    _client(me).post(f"/api/users/{other.id}/block/")
    from_blocker = _client(me).post(f"/api/conversations/{conv.id}/send/", {"text": "hi"}, format="json")
    from_blocked = _client(other).post(f"/api/conversations/{conv.id}/send/", {"text": "hi"}, format="json")
    assert from_blocker.status_code == 403
    assert from_blocked.status_code == 403
    assert from_blocker.data["detail"] == from_blocked.data["detail"]


@pytest.mark.django_db
def test_unblocking_restores_messaging(pair):
    me, other, conv = pair
    _client(me).post(f"/api/users/{other.id}/block/")
    _client(me).delete(f"/api/users/{other.id}/block/")
    assert _client(other).post(f"/api/conversations/{conv.id}/send/", {"text": "back"}, format="json").status_code == 201


@pytest.mark.django_db
def test_blocked_user_cannot_start_a_new_conversation(db):
    blocker = User.objects.create(username="blocker_x", phone="+237699555503")
    blocked = User.objects.create(username="blocked_x", phone="+237699555504")
    _client(blocker).post(f"/api/users/{blocked.id}/block/")
    response = _client(blocked).post("/api/conversations/", {"participant_id": str(blocker.id)}, format="json")
    assert response.status_code == 403


@pytest.mark.django_db
def test_conversation_list_flags_who_the_caller_blocked(pair):
    me, other, _ = pair
    _client(me).post(f"/api/users/{other.id}/block/")
    mine = _client(me).get("/api/conversations/").data["results"][0]["participants_details"][0]
    theirs = _client(other).get("/api/conversations/").data["results"][0]["participants_details"][0]
    assert mine["is_blocked"] is True
    assert theirs["is_blocked"] is False
