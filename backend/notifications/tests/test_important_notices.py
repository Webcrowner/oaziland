"""Money and booking notices reach people outside the app when a real provider is connected."""
import pytest

from identity.models import User
from notifications import services
from notifications.models import Notification
from notifications.services import NotificationDispatcher, notify_important


class _Live(NotificationDispatcher):
    is_live = True

    def __init__(self, ok=True):
        self.ok = ok
        self.sent = []

    def send(self, notification):
        self.sent.append(notification.channel)
        return self.ok


def _install(monkeypatch, **channels):
    """channels: name -> dispatcher; a channel left out is on the sandbox stand-in."""
    def pick(channel):
        return channels.get(channel) or services.SandboxDispatcher()
    monkeypatch.setattr(services, "get_active_dispatcher", pick)


@pytest.fixture
def person(db):
    return User.objects.create(username="np_person", phone="+237699900001", email="np@example.com")


def _rows(person):
    return list(Notification.objects.filter(recipient=person).order_by("created_at").values_list("channel", flat=True))


@pytest.mark.django_db
def test_with_no_provider_connected_only_the_in_app_notice_is_recorded(monkeypatch, person):
    _install(monkeypatch)
    notify_important(recipient=person, notification_type="X", title="t", message="m")
    assert _rows(person) == ["IN_APP"]


@pytest.mark.django_db
def test_whatsapp_is_preferred_and_one_external_copy_is_enough(monkeypatch, person):
    whatsapp, sms, email = _Live(), _Live(), _Live()
    _install(monkeypatch, WHATSAPP=whatsapp, SMS=sms, EMAIL=email)
    notify_important(recipient=person, notification_type="X", title="t", message="m")
    assert _rows(person) == ["IN_APP", "WHATSAPP"] and sms.sent == [] and email.sent == []


@pytest.mark.django_db
def test_it_falls_back_to_the_next_channel_when_one_fails(monkeypatch, person):
    _install(monkeypatch, WHATSAPP=_Live(ok=False), SMS=_Live(), EMAIL=_Live())
    notify_important(recipient=person, notification_type="X", title="t", message="m")
    assert _rows(person) == ["IN_APP", "WHATSAPP", "SMS"]


@pytest.mark.django_db
def test_email_is_used_when_only_email_is_live_and_a_crashing_provider_never_breaks_the_action(monkeypatch, person):
    class Crashing(_Live):
        def send(self, notification):
            raise RuntimeError("provider down")

    _install(monkeypatch, WHATSAPP=Crashing(), EMAIL=_Live())
    record = notify_important(recipient=person, notification_type="X", title="t", message="m")
    assert record.channel == "IN_APP" and "EMAIL" in _rows(person)
