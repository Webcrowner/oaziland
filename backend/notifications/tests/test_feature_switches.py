"""Admin switches for chat translation, SMS and email: what users can see, and what the platform stops sending."""
import pytest
from rest_framework.test import APIClient

from identity.models import AdminProfile, User
from notifications import services
from notifications.features import channel_enabled, public_features
from notifications.models import FeatureSettings, Notification


def _user(name, **extra):
    return User.objects.create(username=name, phone=f"+2376{abs(hash(name)) % 10**8:08d}", email=f"{name}@example.com", **extra)


def _client(user=None):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


@pytest.fixture
def admin():
    user = _user("sw_admin", is_staff=True)
    AdminProfile.objects.create(user=user, permissions=[])
    return user


def _switch(**values):
    row = FeatureSettings.get_settings()
    for key, value in values.items():
        setattr(row, key, value)
    row.save()


class _Counting:
    """A dispatcher that records what it was asked to send."""
    is_live = True

    def __init__(self):
        self.sent = []

    def send(self, notification):
        self.sent.append(notification.channel)
        return True


@pytest.fixture
def dispatcher(monkeypatch):
    counting = _Counting()
    monkeypatch.setattr(services, "get_active_dispatcher", lambda channel: counting)
    return counting


@pytest.mark.django_db
def test_everything_is_on_by_default_but_translation_needs_a_connected_provider(monkeypatch):
    for name in ("TRANSLATION_PROVIDER", "GOOGLE_TRANSLATE_API_KEY", "AZURE_TRANSLATOR_KEY"):
        monkeypatch.delenv(name, raising=False)
    assert _client().get("/api/features/").data == {"chat_translation": False, "sms": True, "email": True}

    monkeypatch.setenv("TRANSLATION_PROVIDER", "SANDBOX")
    assert _client().get("/api/features/").data["chat_translation"] is True
    _switch(chat_translation_enabled=False)
    assert _client().get("/api/features/").data["chat_translation"] is False  # an admin can still hide it


@pytest.mark.django_db
def test_only_admins_change_the_switches_and_the_change_is_seen_at_once(admin):
    assert _client(_user("sw_plain")).get("/api/admin/feature-settings/").status_code == 403
    assert _client(_user("sw_plain2")).patch("/api/admin/feature-settings/", {"sms_enabled": False}, format="json").status_code == 403
    assert _client().patch("/api/admin/feature-settings/", {"sms_enabled": False}, format="json").status_code in (401, 403)

    assert public_features()["sms"] is True  # warms the cache
    response = _client(admin).patch("/api/admin/feature-settings/", {"sms_enabled": False, "email_enabled": False}, format="json")
    assert response.status_code == 200 and response.data["sms_enabled"] is False and response.data["email_enabled"] is False
    assert _client().get("/api/features/").data["sms"] is False and public_features()["email"] is False
    assert FeatureSettings.get_settings().updated_by == admin
    assert "provider" in response.data["translation"] and "sms_connected" in response.data


@pytest.mark.django_db
def test_the_admin_endpoint_rejects_unknown_settings_and_non_boolean_values(admin):
    assert _client(admin).patch("/api/admin/feature-settings/", {"sms_enabled": "no"}, format="json").status_code == 400
    assert _client(admin).patch("/api/admin/feature-settings/", {"is_staff": True}, format="json").status_code == 400
    assert FeatureSettings.get_settings().sms_enabled is True


@pytest.mark.django_db
def test_a_switched_off_channel_sends_nothing_but_keeps_the_record(dispatcher):
    user = _user("sw_recipient")
    _switch(sms_enabled=False)
    record = services.notify(recipient=user, notification_type="X", title="t", message="m", channel="SMS")
    assert record.delivered is False and Notification.objects.filter(pk=record.pk).exists()
    assert dispatcher.sent == []  # no provider call, so no bill

    services.notify(recipient=user, notification_type="X", title="t", message="m", channel="EMAIL")
    assert dispatcher.sent == ["EMAIL"]  # the other channel still works
    services.notify(recipient=user, notification_type="X", title="t", message="m")
    assert dispatcher.sent[-1] == "IN_APP"  # in-app notices are never switched off


@pytest.mark.django_db
def test_emergency_alerts_and_password_resets_ignore_the_switches(dispatcher):
    _switch(sms_enabled=False, email_enabled=False)
    services.notify(external_phone_number="+237600000001", notification_type="SOS", title="t", message="m", channel="SMS")
    assert dispatcher.sent == ["SMS"]  # an emergency contact must still be reached

    from identity.services import request_password_reset
    request_password_reset(_user("sw_forgot"))
    assert dispatcher.sent == ["SMS", "EMAIL"]  # nobody gets locked out of their account


@pytest.mark.django_db
def test_important_notices_skip_a_channel_that_is_switched_off(dispatcher):
    user = _user("sw_money")
    _switch(sms_enabled=False)
    services.notify_important(recipient=user, notification_type="REFUND", title="t", message="m")
    # In-app always; then the first channel that is live AND on: WhatsApp here (the stand-in says it is live).
    assert "SMS" not in dispatcher.sent and "IN_APP" in dispatcher.sent


@pytest.mark.django_db
def test_two_factor_setup_refuses_a_channel_an_admin_switched_off(dispatcher):
    user = _user("sw_mfa")
    _switch(sms_enabled=False)
    refused = _client(user).post("/api/auth/mfa/setup/", {"mfa_type": "SMS_OTP", "destination": user.phone}, format="json")
    assert refused.status_code == 400 and "not available" in refused.data["detail"]
    allowed = _client(user).post("/api/auth/mfa/setup/", {"mfa_type": "EMAIL_OTP", "destination": user.email}, format="json")
    assert allowed.status_code == 201

    _switch(sms_enabled=True)
    assert _client(user).post("/api/auth/mfa/setup/", {"mfa_type": "SMS_OTP", "destination": user.phone}, format="json").status_code == 201
    assert channel_enabled("SMS") is True
