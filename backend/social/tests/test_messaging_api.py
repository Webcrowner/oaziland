"""
Tests for the real messaging/inbox API — send_message_now(),
mark_message_seen(), and get_message_tick_status() all existed and
were tested at the service layer, but nothing exposed any of them
over HTTP, meaning no real inbox was possible.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from social.models import Conversation, Message


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_starting_a_conversation_reuses_an_existing_one_with_the_same_participant():
    """WHY this matters: messaging the same person twice must not
    fragment history across two separate conversations."""
    user_a = User.objects.create(username="messaging_user_a", phone="+237699222201")
    user_b = User.objects.create(username="messaging_user_b", phone="+237699222202")

    first_response = _auth_client(user_a).post("/api/conversations/", {"participant_id": str(user_b.id)})
    assert first_response.status_code == 201
    conversation_id = first_response.data["id"]

    second_response = _auth_client(user_a).post("/api/conversations/", {"participant_id": str(user_b.id)})
    assert second_response.status_code == 200  # found the existing one, didn't create a duplicate
    assert second_response.data["id"] == conversation_id
    assert Conversation.objects.count() == 1


@pytest.mark.django_db
def test_full_messaging_flow_send_receive_and_mark_seen():
    user_a = User.objects.create(username="messaging_flow_a", phone="+237699222203")
    user_b = User.objects.create(username="messaging_flow_b", phone="+237699222204")

    conv_response = _auth_client(user_a).post("/api/conversations/", {"participant_id": str(user_b.id)})
    conversation_id = conv_response.data["id"]

    send_response = _auth_client(user_a).post(f"/api/conversations/{conversation_id}/send/", {"text": "Hello, is this still available?"})
    assert send_response.status_code == 201
    assert send_response.data["text"] == "Hello, is this still available?"

    # user_b sees the real message and an accurate unread count.
    b_conversations = _auth_client(user_b).get("/api/conversations/")
    assert b_conversations.data["results"][0]["unread_count"] == 1
    assert b_conversations.data["results"][0]["last_message"]["text"] == "Hello, is this still available?"

    messages_response = _auth_client(user_b).get(f"/api/conversations/{conversation_id}/messages/")
    assert len(messages_response.data) == 1

    seen_response = _auth_client(user_b).post(f"/api/conversations/{conversation_id}/mark_seen/")
    assert seen_response.data["marked_seen"] == 1

    b_conversations_after = _auth_client(user_b).get("/api/conversations/")
    assert b_conversations_after.data["results"][0]["unread_count"] == 0


@pytest.mark.django_db
def test_sending_with_a_client_message_id_is_idempotent_over_the_real_api():
    """The literal reason client_message_id exists: a mobile client
    retrying a send after losing the success response must not create
    a duplicate message."""
    user_a = User.objects.create(username="messaging_idempotent_a", phone="+237699222205")
    user_b = User.objects.create(username="messaging_idempotent_b", phone="+237699222206")
    conv_response = _auth_client(user_a).post("/api/conversations/", {"participant_id": str(user_b.id)})
    conversation_id = conv_response.data["id"]

    client = _auth_client(user_a)
    first = client.post(f"/api/conversations/{conversation_id}/send/", {"text": "Retry-safe message", "client_message_id": "mobile-retry-key-1"})
    second = client.post(f"/api/conversations/{conversation_id}/send/", {"text": "Retry-safe message", "client_message_id": "mobile-retry-key-1"})

    assert first.data["id"] == second.data["id"]
    assert Message.objects.filter(client_message_id="mobile-retry-key-1").count() == 1


@pytest.mark.django_db
def test_a_stranger_cannot_see_or_act_on_someone_elses_conversation():
    user_a = User.objects.create(username="messaging_private_a", phone="+237699222207")
    user_b = User.objects.create(username="messaging_private_b", phone="+237699222208")
    stranger = User.objects.create(username="messaging_stranger", phone="+237699222209")

    conv_response = _auth_client(user_a).post("/api/conversations/", {"participant_id": str(user_b.id)})
    conversation_id = conv_response.data["id"]

    stranger_client = _auth_client(stranger)
    list_response = stranger_client.get("/api/conversations/")
    assert list_response.data["results"] == []  # never sees a_a/b's conversation in their own list

    detail_response = stranger_client.get(f"/api/conversations/{conversation_id}/messages/")
    assert detail_response.status_code == 404  # get_queryset scoping means get_object() can't find it at all


@pytest.mark.django_db
def test_messaging_requires_authentication():
    response = APIClient().get("/api/conversations/")
    assert response.status_code == 401
