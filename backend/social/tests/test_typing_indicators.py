"""
Tests for typing indicators — heartbeat-based (this is a REST backend,
not WebSocket), with a per-user privacy toggle mirroring UserPresence.
show_online_status exactly: visible by default, hideable, and hiding
it never breaks the underlying detection.
"""
import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from social.models import Conversation, TypingIndicator, UserPresence
from social.services import send_typing_heartbeat, get_typing_users


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def conversation(db):
    user_a = User.objects.create(username="typing_user_a", phone="+237699333301")
    user_b = User.objects.create(username="typing_user_b", phone="+237699333302")
    conv = Conversation.objects.create()
    conv.participants.add(user_a, user_b)
    return conv, user_a, user_b


@pytest.mark.django_db
def test_typing_heartbeat_is_visible_to_the_other_participant(conversation):
    conv, user_a, user_b = conversation
    send_typing_heartbeat(conversation=conv, user=user_a)

    typing_for_b = get_typing_users(conversation=conv, viewer=user_b)
    assert user_a in typing_for_b

    # The typist never sees themselves in their own typing list.
    typing_for_a = get_typing_users(conversation=conv, viewer=user_a)
    assert user_a not in typing_for_a


@pytest.mark.django_db
def test_a_stale_heartbeat_no_longer_counts_as_typing(conversation):
    """The real enforcement: silence (a closed tab, lost connection,
    or someone just stopping) must correctly stop showing 'typing...'
    after a short timeout, not forever."""
    conv, user_a, user_b = conversation
    indicator = send_typing_heartbeat(conversation=conv, user=user_a)
    # Simulate a heartbeat from 30 seconds ago — well past the timeout.
    TypingIndicator.objects.filter(id=indicator.id).update(last_heartbeat_at=timezone.now() - timedelta(seconds=30))

    typing_for_b = get_typing_users(conversation=conv, viewer=user_b)
    assert user_a not in typing_for_b


@pytest.mark.django_db
def test_hiding_typing_indicator_actually_hides_it_from_others(conversation):
    """The literal feature request: a user can turn this off, and it
    genuinely stops showing to the other person."""
    conv, user_a, user_b = conversation
    UserPresence.objects.create(user=user_a, show_typing_indicator=False)

    send_typing_heartbeat(conversation=conv, user=user_a)
    typing_for_b = get_typing_users(conversation=conv, viewer=user_b)
    assert user_a not in typing_for_b  # correctly hidden, per user_a's own preference


@pytest.mark.django_db
def test_hiding_typing_indicator_does_not_break_the_underlying_heartbeat():
    """WHY this matters, mirroring show_online_status's own design:
    hiding is a DISPLAY-ONLY choice — the real TypingIndicator row
    still gets written normally; only what OTHER people are shown changes."""
    user_a = User.objects.create(username="typing_hidden_user", phone="+237699333303")
    user_b = User.objects.create(username="typing_viewer_user", phone="+237699333304")
    conv = Conversation.objects.create()
    conv.participants.add(user_a, user_b)
    UserPresence.objects.create(user=user_a, show_typing_indicator=False)

    send_typing_heartbeat(conversation=conv, user=user_a)
    assert TypingIndicator.objects.filter(conversation=conv, user=user_a).exists()  # the real signal still exists


@pytest.mark.django_db
def test_a_user_with_no_presence_row_yet_defaults_to_visible(conversation):
    """A user who's never touched their presence settings at all
    (no UserPresence row exists) must still default to VISIBLE, per
    the founder's explicit 'shows by default' requirement."""
    conv, user_a, user_b = conversation
    assert hasattr(user_a, "presence") is False  # confirms no row exists yet

    send_typing_heartbeat(conversation=conv, user=user_a)
    typing_for_b = get_typing_users(conversation=conv, viewer=user_b)
    assert user_a in typing_for_b


@pytest.mark.django_db
def test_full_typing_flow_over_the_real_api(conversation):
    conv, user_a, user_b = conversation

    heartbeat_response = _auth_client(user_a).post(f"/api/conversations/{conv.id}/typing/")
    assert heartbeat_response.status_code == 204

    status_response = _auth_client(user_b).get(f"/api/conversations/{conv.id}/typing-status/")
    assert status_response.status_code == 200
    assert len(status_response.data["typing_usernames"]) == 1


@pytest.mark.django_db
def test_presence_settings_api_get_and_patch():
    user = User.objects.create(username="presence_settings_user", phone="+237699333305")
    client = _auth_client(user)

    get_response = client.get("/api/my-presence-settings/")
    assert get_response.status_code == 200
    assert get_response.data["show_typing_indicator"] is True  # correct default
    assert get_response.data["show_online_status"] is True

    patch_response = client.patch("/api/my-presence-settings/", {"show_typing_indicator": False})
    assert patch_response.status_code == 200
    assert patch_response.data["show_typing_indicator"] is False
    assert patch_response.data["show_online_status"] is True  # untouched by the partial update

    presence = UserPresence.objects.get(user=user)
    assert presence.show_typing_indicator is False


@pytest.mark.django_db
def test_presence_settings_requires_authentication():
    response = APIClient().get("/api/my-presence-settings/")
    assert response.status_code == 401
