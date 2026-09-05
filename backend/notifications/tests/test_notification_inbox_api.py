"""
Tests for the real Notifications inbox API — a genuine gap this
closes: every notification gets sent via WhatsApp/SMS/email/in-app,
but a user had no way to see their own notification history inside
the app at all.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from notifications.services import notify


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_my_notifications_are_scoped_to_the_requester():
    user_a = User.objects.create(username="notification_inbox_a", phone="+237699777701")
    user_b = User.objects.create(username="notification_inbox_b", phone="+237699777702")
    notify(recipient=user_a, notification_type="TEST_NOTIFICATION", title="Hello A", message="A message for user A.")

    a_response = _auth_client(user_a).get("/api/my-notifications/")
    b_response = _auth_client(user_b).get("/api/my-notifications/")

    assert a_response.data["count"] == 1
    assert b_response.data["count"] == 0


@pytest.mark.django_db
def test_mark_read_and_unread_count():
    user = User.objects.create(username="notification_read_user", phone="+237699777703")
    notification_a = notify(recipient=user, notification_type="TEST_A", title="A", message="First")
    notify(recipient=user, notification_type="TEST_B", title="B", message="Second")

    client = _auth_client(user)
    unread_before = client.get("/api/my-notifications/unread-count/")
    assert unread_before.data["unread_count"] == 2

    mark_response = client.post(f"/api/my-notifications/{notification_a.id}/mark_read/")
    assert mark_response.status_code == 200
    assert mark_response.data["read_at"] is not None

    unread_after = client.get("/api/my-notifications/unread-count/")
    assert unread_after.data["unread_count"] == 1


@pytest.mark.django_db
def test_mark_all_read():
    user = User.objects.create(username="notification_mark_all_user", phone="+237699777704")
    for i in range(3):
        notify(recipient=user, notification_type=f"TEST_{i}", title=f"Notification {i}", message="A message.")

    client = _auth_client(user)
    response = client.post("/api/my-notifications/mark-all-read/")
    assert response.data["marked_read"] == 3

    unread_after = client.get("/api/my-notifications/unread-count/")
    assert unread_after.data["unread_count"] == 0


@pytest.mark.django_db
def test_notifications_require_authentication():
    response = APIClient().get("/api/my-notifications/")
    assert response.status_code == 401
