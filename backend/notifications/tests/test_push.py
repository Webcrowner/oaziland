"""Push notifications: devices register, every in-app notification is pushed to them, dead devices are dropped."""
from unittest import mock

import pytest
from rest_framework.test import APIClient

from identity.models import User
from notifications.models import PushDevice
from notifications.services import notify

WEB_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123"
EXPO_TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _web_device(user, endpoint=WEB_ENDPOINT):
    return PushDevice.objects.create(user=user, platform="WEB", token=endpoint, web_p256dh="key", web_auth="auth")


@pytest.fixture
def vapid(monkeypatch):
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "public-key")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "private-key")


@pytest.mark.django_db
def test_devices_register_validate_and_move_to_whoever_signs_in(vapid):
    first = User.objects.create(username="push_a", phone="+237699600001")
    second = User.objects.create(username="push_b", phone="+237699600002")
    assert APIClient().post("/api/push/devices/", {"platform": "EXPO", "token": EXPO_TOKEN}, format="json").status_code == 401
    bad_web = {"platform": "WEB", "token": "http://insecure", "web_p256dh": "k", "web_auth": "a"}
    assert _client(first).post("/api/push/devices/", bad_web, format="json").status_code == 400
    assert _client(first).post("/api/push/devices/", {"platform": "WEB", "token": WEB_ENDPOINT}, format="json").status_code == 400
    assert _client(first).post("/api/push/devices/", {"platform": "EXPO", "token": "not-a-token"}, format="json").status_code == 400

    web = {"platform": "WEB", "token": WEB_ENDPOINT, "web_p256dh": "k", "web_auth": "a"}
    assert _client(first).post("/api/push/devices/", web, format="json").status_code == 201
    # The same browser signing in as someone else now gets their notifications instead.
    assert _client(second).post("/api/push/devices/", web, format="json").status_code == 200
    assert PushDevice.objects.get(token=WEB_ENDPOINT).user == second

    assert _client(first).post("/api/push/devices/remove/", {"token": WEB_ENDPOINT}, format="json").data["removed"] == 0
    assert _client(second).post("/api/push/devices/remove/", {"token": WEB_ENDPOINT}, format="json").data["removed"] == 1

    config = APIClient().get("/api/push/config/").data
    assert config == {"web_push_enabled": True, "web_push_public_key": "public-key"}


@pytest.mark.django_db
def test_an_in_app_notification_is_pushed_to_every_device(vapid):
    user = User.objects.create(username="push_c", phone="+237699600003")
    _web_device(user)
    PushDevice.objects.create(user=user, platform="EXPO", token=EXPO_TOKEN)
    expo_ok = mock.Mock(ok=True, json=lambda: {"data": [{"status": "ok"}]})
    with mock.patch("pywebpush.webpush") as webpush, mock.patch("requests.post", return_value=expo_ok) as post:
        notify(recipient=user, notification_type="RIDE_OFFER", title="New ride offer", message="Bastos → Airport", related_reference="r1")

    web_call = webpush.call_args.kwargs
    assert web_call["subscription_info"]["endpoint"] == WEB_ENDPOINT
    assert web_call["ttl"] == 20 and web_call["headers"] == {"Urgency": "high"}
    assert '"url": "/oazigo"' in web_call["data"]
    expo_message = post.call_args.kwargs["json"][0]
    assert expo_message["to"] == EXPO_TOKEN and expo_message["priority"] == "high" and expo_message["ttl"] == 20
    assert expo_message["data"]["url"] == "/oazigo"
    assert PushDevice.objects.filter(last_used_at__isnull=False).count() == 2


@pytest.mark.django_db
def test_devices_the_push_service_says_are_gone_are_removed(vapid):
    from pywebpush import WebPushException

    user = User.objects.create(username="push_d", phone="+237699600004")
    _web_device(user)
    PushDevice.objects.create(user=user, platform="EXPO", token=EXPO_TOKEN)
    gone = WebPushException("Gone", response=mock.Mock(status_code=410))
    expo_gone = mock.Mock(ok=True, json=lambda: {"data": [{"status": "error", "details": {"error": "DeviceNotRegistered"}}]})
    with mock.patch("pywebpush.webpush", side_effect=gone), mock.patch("requests.post", return_value=expo_gone):
        record = notify(recipient=user, notification_type="RIDE_UPDATE", title="Driver pulled out", message="...")
    assert PushDevice.objects.count() == 0
    assert record.pk is not None


@pytest.mark.django_db
def test_a_broken_push_service_never_breaks_the_notification(vapid):
    user = User.objects.create(username="push_e", phone="+237699600005")
    _web_device(user)
    PushDevice.objects.create(user=user, platform="EXPO", token=EXPO_TOKEN)
    with mock.patch("pywebpush.webpush", side_effect=RuntimeError("network down")), \
            mock.patch("requests.post", side_effect=RuntimeError("network down")):
        record = notify(recipient=user, notification_type="RIDE_MESSAGE", title="New message", message="Hello")
    assert record.pk is not None and PushDevice.objects.count() == 2


@pytest.mark.django_db
def test_without_vapid_keys_browsers_are_skipped(monkeypatch):
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    user = User.objects.create(username="push_f", phone="+237699600006")
    _web_device(user)
    with mock.patch("pywebpush.webpush") as webpush:
        notify(recipient=user, notification_type="RIDE_UPDATE", title="x", message="y")
    webpush.assert_not_called()
    assert APIClient().get("/api/push/config/").data["web_push_enabled"] is False
