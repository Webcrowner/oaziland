"""Engineers must be able to tell that SMS, WhatsApp, email and push are not really being sent yet."""
import logging
import pytest

import notifications.services as services
from notifications.checks import warn_about_sandbox_notification_channels
from identity.models import User


class _LiveDispatcher(services.NotificationDispatcher):
    def send(self, notification) -> bool:
        return True


def test_the_sandbox_is_not_live_but_in_app_always_is():
    assert services.SandboxDispatcher().is_live is False
    assert services.is_delivery_live("IN_APP") is True
    assert services.is_delivery_live("SMS") is False
    assert services.sandbox_channels() == ["SMS", "WHATSAPP", "EMAIL", "PUSH"]


def test_the_startup_check_names_the_channels_and_where_to_fix_it():
    (warning,) = warn_about_sandbox_notification_channels(None)
    assert warning.id == "notifications.W001"
    assert "SMS, WHATSAPP, EMAIL, PUSH" in warning.msg and "NOT being delivered" in warning.msg
    assert ".env.example" in warning.hint and "emergency contact" in warning.hint


def test_the_check_goes_quiet_once_real_providers_are_connected(monkeypatch):
    monkeypatch.setattr(services, "get_active_dispatcher", lambda channel: _LiveDispatcher())
    assert services.sandbox_channels() == []
    assert warn_about_sandbox_notification_channels(None) == []


@pytest.mark.django_db
def test_sending_an_sms_logs_a_loud_warning_but_an_in_app_message_does_not(caplog):
    user = User.objects.create(username="sandbox_user", phone="+237699200001")
    with caplog.at_level(logging.WARNING, logger="notifications.services"):
        services.notify(recipient=user, notification_type="TEST", title="Hi", message="in app")
        assert caplog.records == []
        services.notify(external_phone_number="+237677000111", notification_type="TEST", title="Hi", message="by sms", channel="SMS")
    (record,) = caplog.records
    assert "NOT delivered" in record.getMessage() and "SMS" in record.getMessage() and "get_active_dispatcher" in record.getMessage()


@pytest.mark.django_db
def test_sms_dispatcher_activates_automatically_when_credentials_are_configured(monkeypatch):
    import requests
    sent_requests = []

    class _DummyResponse:
        ok = True

    def fake_post(url, **kwargs):
        sent_requests.append((url, kwargs))
        return _DummyResponse()

    monkeypatch.setenv("AFRICAS_TALKING_API_KEY", "at-live-key")
    monkeypatch.setenv("AFRICAS_TALKING_USERNAME", "oaziland")
    monkeypatch.setattr(requests, "post", fake_post)

    assert services.is_delivery_live("SMS") is True
    assert "SMS" not in services.sandbox_channels()
    record = services.notify(external_phone_number="+237677000111", notification_type="RIDE_SOS", title="SOS", message="Help needed", channel="SMS")
    assert record.delivered is True
    assert len(sent_requests) == 1 and sent_requests[0][1]["data"]["to"] == "+237677000111"


@pytest.mark.django_db
def test_whatsapp_dispatcher_uses_meta_cloud_api_when_configured(monkeypatch):
    import requests
    sent_requests = []

    class _DummyResponse:
        ok = True
        status_code = 200
        text = ""

    def fake_post(url, **kwargs):
        sent_requests.append((url, kwargs))
        return _DummyResponse()

    monkeypatch.setenv("WHATSAPP_BUSINESS_API_TOKEN", "meta-token")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "123456")
    monkeypatch.setenv("WHATSAPP_GRAPH_API_VERSION", "v23.0")
    monkeypatch.delenv("WHATSAPP_TEMPLATE_NAME", raising=False)
    monkeypatch.setattr(requests, "post", fake_post)

    record = services.notify(
        external_phone_number="+237677000111",
        notification_type="ORDER_CREATED",
        title="New order",
        message="You have a new order.",
        channel="WHATSAPP",
    )

    assert record.delivered is True
    assert sent_requests[0][0] == "https://graph.facebook.com/v23.0/123456/messages"
    assert sent_requests[0][1]["json"]["to"] == "237677000111"
    assert sent_requests[0][1]["json"]["text"]["body"] == "You have a new order."
    assert sent_requests[0][1]["headers"]["Authorization"] == "Bearer meta-token"


@pytest.mark.django_db
def test_whatsapp_dispatcher_uses_approved_template_when_configured(monkeypatch):
    import requests
    sent_requests = []

    class _DummyResponse:
        ok = True
        status_code = 200
        text = ""

    def fake_post(url, **kwargs):
        sent_requests.append((url, kwargs))
        return _DummyResponse()

    monkeypatch.setenv("WHATSAPP_BUSINESS_API_TOKEN", "meta-token")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "123456")
    monkeypatch.setenv("WHATSAPP_TEMPLATE_NAME", "oaziland_notification")
    monkeypatch.setenv("WHATSAPP_TEMPLATE_LANGUAGE", "en")
    monkeypatch.setattr(requests, "post", fake_post)

    services.notify(
        external_phone_number="+237677000111",
        notification_type="ORDER_CREATED",
        title="New order",
        message="You have a new order.",
        channel="WHATSAPP",
    )

    payload = sent_requests[0][1]["json"]
    assert payload["type"] == "template"
    assert payload["template"]["name"] == "oaziland_notification"
    assert payload["template"]["components"][0]["parameters"][0]["text"] == "You have a new order."


@pytest.mark.django_db
def test_email_dispatcher_uses_postmark_when_configured(monkeypatch):
    import requests
    sent_requests = []

    class _DummyResponse:
        ok = True
        status_code = 200
        text = ""

    def fake_post(url, **kwargs):
        sent_requests.append((url, kwargs))
        return _DummyResponse()

    monkeypatch.setenv("POSTMARK_SERVER_TOKEN", "postmark-token")
    monkeypatch.setenv("POSTMARK_FROM_EMAIL", "notifications@oaziland.com")
    monkeypatch.setattr(requests, "post", fake_post)
    user = User.objects.create(username="email_user", phone="+237699200002", email="buyer@example.com")

    record = services.notify(
        recipient=user,
        notification_type="BOOKING_RECEIPT",
        title="Your receipt",
        message="Payment received.",
        channel="EMAIL",
    )

    assert record.delivered is True
    assert sent_requests[0][0] == "https://api.postmarkapp.com/email"
    assert sent_requests[0][1]["json"] == {
        "From": "notifications@oaziland.com",
        "To": "buyer@example.com",
        "Subject": "Your receipt",
        "TextBody": "Payment received.",
        "MessageStream": "outbound",
    }
    assert sent_requests[0][1]["headers"]["X-Postmark-Server-Token"] == "postmark-token"
