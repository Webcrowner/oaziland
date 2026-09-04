"""
Tests proving: real online/offline presence (including a crashed-app
timeout, not just an explicit logout), idempotent offline-safe message
sending, and offline recipients getting a real notification.
"""
import pytest
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from social.models import Conversation, Message, UserPresence, PresenceStatus
from social.services import (
    record_heartbeat, set_explicitly_offline, is_user_online, get_presence_display,
    send_message_now,
)
from notifications.models import Notification


@pytest.mark.django_db
def test_never_seen_user_is_offline():
    user = User.objects.create(username="never_seen_user", phone="+237699950001")
    assert is_user_online(user) is False
    assert get_presence_display(user) == "Offline"


@pytest.mark.django_db
def test_heartbeat_marks_user_online():
    user = User.objects.create(username="heartbeat_user", phone="+237699950002")
    record_heartbeat(user)
    assert is_user_online(user) is True
    assert get_presence_display(user) == "Online"


@pytest.mark.django_db
def test_explicit_logout_marks_offline_immediately():
    user = User.objects.create(username="logout_user", phone="+237699950003")
    record_heartbeat(user)
    assert is_user_online(user) is True
    set_explicitly_offline(user)
    assert is_user_online(user) is False


@pytest.mark.django_db
def test_stale_heartbeat_is_treated_as_offline_even_without_explicit_logout():
    """The crashed-app case: status says ONLINE but last_seen is stale."""
    user = User.objects.create(username="crashed_app_user", phone="+237699950004")
    presence = record_heartbeat(user)

    # Simulate 10 minutes of silence (beyond the 5-minute timeout) without
    # ever calling set_explicitly_offline.
    UserPresence.objects.filter(user=user).update(last_seen_at=timezone.now() - timedelta(minutes=10))

    assert is_user_online(user) is False
    assert "Last seen" in get_presence_display(user)


@pytest.mark.django_db
def test_retrying_the_same_offline_message_does_not_duplicate():
    """The core of 'offline messaging': a client retry with the same
    client_message_id must return the ORIGINAL message, not create a
    second one."""
    sender = User.objects.create(username="offline_sender", phone="+237699950005")
    recipient = User.objects.create(username="offline_recipient", phone="+237699950006")
    conversation = Conversation.objects.create()
    conversation.participants.set([sender, recipient])

    first_attempt = send_message_now(conversation=conversation, sender=sender, text="Composed while offline", client_message_id="local-uuid-abc123")
    # Simulates the device retrying after regaining connectivity, unaware
    # the first attempt actually succeeded.
    second_attempt = send_message_now(conversation=conversation, sender=sender, text="Composed while offline", client_message_id="local-uuid-abc123")

    assert first_attempt.id == second_attempt.id
    assert Message.objects.filter(conversation=conversation).count() == 1


@pytest.mark.django_db
def test_sending_to_an_offline_recipient_triggers_a_real_notification():
    sender = User.objects.create(username="notify_sender", phone="+237699950007")
    offline_recipient = User.objects.create(username="notify_offline_recipient", phone="+237699950008")
    conversation = Conversation.objects.create()
    conversation.participants.set([sender, offline_recipient])
    # offline_recipient has never sent a heartbeat — correctly treated as offline.

    send_message_now(conversation=conversation, sender=sender, text="Are you there?")

    assert Notification.objects.filter(recipient=offline_recipient, notification_type="NEW_MESSAGE_WHILE_OFFLINE").exists()


@pytest.mark.django_db
def test_sending_to_an_online_recipient_does_not_spam_a_notification():
    sender = User.objects.create(username="notify_sender_2", phone="+237699950009")
    online_recipient = User.objects.create(username="notify_online_recipient", phone="+237699950010")
    record_heartbeat(online_recipient)
    conversation = Conversation.objects.create()
    conversation.participants.set([sender, online_recipient])

    send_message_now(conversation=conversation, sender=sender, text="Hey, you're online!")

    assert Notification.objects.filter(recipient=online_recipient, notification_type="NEW_MESSAGE_WHILE_OFFLINE").exists() is False
