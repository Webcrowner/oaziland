"""
Tests proving: online status is VISIBLE by default, a user can hide it
from others, hiding it never affects their own view of their own
status, and — critically — hiding it does NOT break the actual
functional presence detection message delivery ticks rely on.
"""
import pytest
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from social.models import Conversation, UserPresence
from social.services import (
    record_heartbeat, set_presence_visibility, get_presence_display,
    is_user_online, send_message_now, get_message_tick_status,
)


@pytest.mark.django_db
def test_online_status_is_visible_by_default():
    """The founder's explicit default: 'by default it shows when you
    are online.'"""
    user = User.objects.create(username="privacy_default_user", phone="+237699999101")
    record_heartbeat(user)

    presence = UserPresence.objects.get(user=user)
    assert presence.show_online_status is True  # true without anyone setting it explicitly

    other_viewer = User.objects.create(username="privacy_other_viewer", phone="+237699999102")
    assert get_presence_display(user, viewer=other_viewer) == "Online"


@pytest.mark.django_db
def test_hiding_online_status_shows_offline_to_others():
    user = User.objects.create(username="privacy_hider", phone="+237699999103")
    other_viewer = User.objects.create(username="privacy_viewer_2", phone="+237699999104")
    record_heartbeat(user)
    assert get_presence_display(user, viewer=other_viewer) == "Online"

    set_presence_visibility(user=user, visible=False)
    assert get_presence_display(user, viewer=other_viewer) == "Offline"  # hidden from others


@pytest.mark.django_db
def test_hiding_online_status_does_not_hide_it_from_yourself():
    """Checking your OWN status must always show the truth — hiding it
    from yourself would just be confusing, not private."""
    user = User.objects.create(username="privacy_self_check", phone="+237699999105")
    record_heartbeat(user)
    set_presence_visibility(user=user, visible=False)

    assert get_presence_display(user, viewer=user) == "Online"  # you see your real status
    other_viewer = User.objects.create(username="privacy_viewer_3", phone="+237699999106")
    assert get_presence_display(user, viewer=other_viewer) == "Offline"  # others don't


@pytest.mark.django_db
def test_re_showing_status_after_hiding_it():
    user = User.objects.create(username="privacy_toggle_user", phone="+237699999107")
    viewer = User.objects.create(username="privacy_toggle_viewer", phone="+237699999108")
    record_heartbeat(user)

    set_presence_visibility(user=user, visible=False)
    assert get_presence_display(user, viewer=viewer) == "Offline"

    set_presence_visibility(user=user, visible=True)
    assert get_presence_display(user, viewer=viewer) == "Online"  # visible again


@pytest.mark.django_db
def test_hiding_status_does_not_break_message_delivery_ticks():
    """The critical functional requirement: hiding your DISPLAYED
    online status must NOT change how message delivery actually works
    — is_user_online() (used internally for delivery ticks) must keep
    reporting the true state regardless of this privacy setting."""
    sender = User.objects.create(username="privacy_tick_sender", phone="+237699999109")
    recipient = User.objects.create(username="privacy_tick_recipient", phone="+237699999110")
    record_heartbeat(recipient)
    set_presence_visibility(user=recipient, visible=False)  # hides DISPLAY only

    # The underlying functional check must still see them as online.
    assert is_user_online(recipient) is True

    conversation = Conversation.objects.create()
    conversation.participants.set([sender, recipient])
    message = send_message_now(conversation=conversation, sender=sender, text="Testing delivery despite hidden status")

    # Delivery should still happen immediately, exactly as if status
    # visibility were untouched — hiding DISPLAY never breaks FUNCTION.
    status = get_message_tick_status(message)
    assert status["label"] == "Delivered"


@pytest.mark.django_db
def test_a_never_seen_user_shows_offline_regardless_of_privacy_setting():
    user = User.objects.create(username="privacy_never_seen", phone="+237699999111")
    viewer = User.objects.create(username="privacy_never_seen_viewer", phone="+237699999112")
    # No UserPresence row exists at all yet.
    assert get_presence_display(user, viewer=viewer) == "Offline"
