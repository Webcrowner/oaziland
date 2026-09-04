"""
Tests proving WhatsApp-style delivery ticks (sent/delivered/seen, with
tick count and color) and the one-tap follow/unfollow toggle.
"""
import pytest

from identity.models import User
from social.models import Conversation, MessageReceipt
from social.services import (
    send_message_now, mark_message_delivered, mark_message_seen, get_message_tick_status,
    record_heartbeat, follow_user, unfollow_user, is_following, toggle_follow, is_mutual_follow,
)


@pytest.mark.django_db
def test_freshly_sent_message_shows_one_grey_tick():
    sender = User.objects.create(username="tick_sender_1", phone="+237699970001")
    recipient = User.objects.create(username="tick_recipient_1", phone="+237699970002")
    conversation = Conversation.objects.create()
    conversation.participants.set([sender, recipient])

    message = send_message_now(conversation=conversation, sender=sender, text="Hello")
    status = get_message_tick_status(message)

    assert status == {"ticks": 1, "color": "GREY", "label": "Sent"}


@pytest.mark.django_db
def test_message_to_an_online_recipient_shows_delivered_immediately():
    sender = User.objects.create(username="tick_sender_2", phone="+237699970003")
    recipient = User.objects.create(username="tick_recipient_2", phone="+237699970004")
    record_heartbeat(recipient)  # recipient is online at send time
    conversation = Conversation.objects.create()
    conversation.participants.set([sender, recipient])

    message = send_message_now(conversation=conversation, sender=sender, text="You're online!")
    status = get_message_tick_status(message)

    assert status == {"ticks": 2, "color": "GREY", "label": "Delivered"}


@pytest.mark.django_db
def test_seen_message_shows_two_blue_ticks():
    sender = User.objects.create(username="tick_sender_3", phone="+237699970005")
    recipient = User.objects.create(username="tick_recipient_3", phone="+237699970006")
    conversation = Conversation.objects.create()
    conversation.participants.set([sender, recipient])

    message = send_message_now(conversation=conversation, sender=sender, text="Did you see this?")
    mark_message_seen(message=message, recipient=recipient)
    status = get_message_tick_status(message)

    assert status == {"ticks": 2, "color": "BLUE", "label": "Seen"}

    receipt = MessageReceipt.objects.get(message=message, recipient=recipient)
    assert receipt.delivered_at is not None  # seeing implies delivered, even though never explicitly marked


@pytest.mark.django_db
def test_group_message_only_shows_seen_once_everyone_has_seen_it():
    """The group-chat case: ticks reflect the SLOWEST recipient, not
    the fastest."""
    sender = User.objects.create(username="tick_sender_4", phone="+237699970007")
    recipient_a = User.objects.create(username="tick_recipient_4a", phone="+237699970008")
    recipient_b = User.objects.create(username="tick_recipient_4b", phone="+237699970009")
    conversation = Conversation.objects.create()
    conversation.participants.set([sender, recipient_a, recipient_b])

    message = send_message_now(conversation=conversation, sender=sender, text="Group update")
    mark_message_seen(message=message, recipient=recipient_a)
    # recipient_b hasn't seen it yet.

    status = get_message_tick_status(message)
    assert status["label"] == "Sent"  # not ALL recipients have seen it — still shows the lower state

    mark_message_seen(message=message, recipient=recipient_b)
    status = get_message_tick_status(message)
    assert status["label"] == "Seen"  # now everyone has


@pytest.mark.django_db
def test_marking_delivered_twice_does_not_overwrite_the_original_timestamp():
    sender = User.objects.create(username="tick_sender_5", phone="+237699970010")
    recipient = User.objects.create(username="tick_recipient_5", phone="+237699970011")
    conversation = Conversation.objects.create()
    conversation.participants.set([sender, recipient])
    message = send_message_now(conversation=conversation, sender=sender, text="Idempotent delivery test")

    first = mark_message_delivered(message=message, recipient=recipient)
    first_timestamp = first.delivered_at
    second = mark_message_delivered(message=message, recipient=recipient)

    assert second.delivered_at == first_timestamp  # unchanged, not overwritten


@pytest.mark.django_db
def test_one_tap_follow_toggle():
    follower = User.objects.create(username="toggle_follower", phone="+237699970012")
    followee = User.objects.create(username="toggle_followee", phone="+237699970013")

    assert is_following(follower=follower, followee=followee) is False

    now_following = toggle_follow(follower=follower, followee=followee)
    assert now_following is True
    assert is_following(follower=follower, followee=followee) is True

    now_following_again = toggle_follow(follower=follower, followee=followee)
    assert now_following_again is False
    assert is_following(follower=follower, followee=followee) is False


@pytest.mark.django_db
def test_cannot_follow_yourself():
    user = User.objects.create(username="self_follow_user", phone="+237699970014")
    with pytest.raises(ValueError):
        follow_user(follower=user, followee=user)


@pytest.mark.django_db
def test_mutual_follow_detection():
    user_a = User.objects.create(username="mutual_a", phone="+237699970015")
    user_b = User.objects.create(username="mutual_b", phone="+237699970016")

    follow_user(follower=user_a, followee=user_b)
    assert is_mutual_follow(user_a=user_a, user_b=user_b) is False  # only one-directional so far

    follow_user(follower=user_b, followee=user_a)
    assert is_mutual_follow(user_a=user_a, user_b=user_b) is True
