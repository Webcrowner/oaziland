"""
notifications.services — the dispatcher interface (same pattern as
payments.gateways.PaymentGateway and trust_safety.moderation_providers.
ContentModerationProvider) plus the one shared notify() helper every
other app should call.
"""
from abc import ABC, abstractmethod


class NotificationDispatcher(ABC):
    @abstractmethod
    def send(self, notification) -> bool:
        """Attempts real delivery (WhatsApp/SMS/push/email). Returns
        whether it succeeded."""
        raise NotImplementedError


class SandboxDispatcher(NotificationDispatcher):
    """A working stand-in — always 'delivers' successfully, no real
    message sent. Good enough to prove notify() and everything that
    calls it works correctly."""
    def send(self, notification) -> bool:
        return True


class WhatsAppDispatcher(NotificationDispatcher):
    """NOT YET CONNECTED — needs WHATSAPP_BUSINESS_API_TOKEN (Twilio/360dialog)."""
    def send(self, notification) -> bool:
        raise NotImplementedError("WhatsApp dispatch not yet built — requires real API credentials.")


class SMSDispatcher(NotificationDispatcher):
    """NOT YET CONNECTED — needs an Africa's Talking/Twilio SMS account."""
    def send(self, notification) -> bool:
        raise NotImplementedError("SMS dispatch not yet built — requires real API credentials.")


def get_active_dispatcher(channel: str) -> NotificationDispatcher:
    """The one place deciding which dispatcher handles a channel. Always
    sandbox for now — mirrors get_active_gateway() and
    get_active_moderation_provider()."""
    return SandboxDispatcher()


def notify(*, recipient, notification_type: str, title: str, message: str, channel="IN_APP", related_reference: str = ""):
    """The ONE shared way any part of the platform sends someone a
    notification. Creates the record, attempts delivery through the
    active dispatcher for that channel, and marks the real outcome —
    never assumes success just because the record was created."""
    from .models import Notification

    record = Notification.objects.create(
        recipient=recipient, notification_type=notification_type, title=title,
        message=message, channel=channel, related_reference=related_reference,
    )
    dispatcher = get_active_dispatcher(channel)
    record.delivered = dispatcher.send(record)
    record.save(update_fields=["delivered"])
    return record
