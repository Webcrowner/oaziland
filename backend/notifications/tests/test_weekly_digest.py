"""Tests for the weekly digest — the email use-case this prompt adds."""
import pytest
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from notifications.services import generate_weekly_digest_data, send_weekly_digest_email, notify
from notifications.models import Notification


@pytest.mark.django_db
def test_digest_counts_recent_saved_search_matches():
    user = User.objects.create(username="digest_user_1", phone="+237699999401")
    notify(recipient=user, notification_type="SAVED_SEARCH_MATCH", title="Match!", message="A new listing matches.")
    notify(recipient=user, notification_type="SAVED_SEARCH_MATCH", title="Match!", message="Another match.")

    digest = generate_weekly_digest_data(user)
    assert digest["saved_search_matches"] == 2
    assert digest["total_notifications"] == 2


@pytest.mark.django_db
def test_digest_ignores_notifications_older_than_the_period():
    user = User.objects.create(username="digest_user_2", phone="+237699999402")
    old_notification = notify(recipient=user, notification_type="SAVED_SEARCH_MATCH", title="Old match", message="Should not count")
    Notification.objects.filter(id=old_notification.id).update(created_at=timezone.now() - timedelta(days=30))

    digest = generate_weekly_digest_data(user)
    assert digest["total_notifications"] == 0


@pytest.mark.django_db
def test_digest_email_is_not_sent_when_there_is_nothing_to_report():
    """Avoiding an empty, pointless weekly email — the actual reason
    this check exists."""
    user = User.objects.create(username="digest_user_3", phone="+237699999403")
    result = send_weekly_digest_email(user)
    assert result is None
    assert Notification.objects.filter(recipient=user, notification_type="WEEKLY_DIGEST").exists() is False


@pytest.mark.django_db
def test_digest_email_is_sent_when_there_is_real_activity():
    user = User.objects.create(username="digest_user_4", phone="+237699999404")
    notify(recipient=user, notification_type="SAVED_SEARCH_MATCH", title="Match!", message="A new listing matches.")

    result = send_weekly_digest_email(user)
    assert result is not None
    digest_email = Notification.objects.filter(recipient=user, notification_type="WEEKLY_DIGEST", channel="EMAIL")
    assert digest_email.exists()
    assert "1 new listing" in digest_email.first().message
