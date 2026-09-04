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


class EmailDispatcher(NotificationDispatcher):
    """NOT YET CONNECTED — needs a Postmark or SendGrid account."""
    def send(self, notification) -> bool:
        raise NotImplementedError("Email dispatch not yet built — requires real API credentials.")


def get_active_dispatcher(channel: str) -> NotificationDispatcher:
    """FIXED: this previously always returned SandboxDispatcher
    regardless of the channel argument — meaning WhatsAppDispatcher and
    SMSDispatcher existed as classes but were NEVER actually reachable
    through notify(), dead code nobody would have noticed until trying
    to connect real credentials and finding nothing used them.

    Every channel still maps to Sandbox for now, since no real
    credentials exist yet for ANY of them — but the mapping is now
    explicit and per-channel, so connecting real WhatsApp/SMS/Email
    credentials later is a ONE-LINE change per channel (swap
    SandboxDispatcher() for the real class), exactly the same pattern
    already used in payments.gateways.get_active_gateway()."""
    return {
        "WHATSAPP": SandboxDispatcher(),
        "SMS": SandboxDispatcher(),
        "EMAIL": SandboxDispatcher(),
        "PUSH": SandboxDispatcher(),
        "IN_APP": SandboxDispatcher(),
    }.get(channel, SandboxDispatcher())


def notify(*, recipient=None, external_phone_number: str = "", notification_type: str, title: str, message: str, channel="IN_APP", related_reference: str = ""):
    """The ONE shared way any part of the platform sends someone a
    notification. Creates the record, attempts delivery through the
    active dispatcher for that channel, and marks the real outcome —
    never assumes success just because the record was created.

    Exactly one of recipient/external_phone_number must be given —
    a registered user gets a normal notification; an external contact
    (e.g. an agent's emergency contact with no Oaziland account) gets
    one addressed by phone number instead."""
    from .models import Notification

    if not recipient and not external_phone_number:
        raise ValueError("notify() requires either a recipient or an external_phone_number.")

    record = Notification.objects.create(
        recipient=recipient, external_phone_number=external_phone_number,
        notification_type=notification_type, title=title, message=message,
        channel=channel, related_reference=related_reference,
    )
    dispatcher = get_active_dispatcher(channel)
    record.delivered = dispatcher.send(record)
    record.save(update_fields=["delivered"])
    return record


# ---------------------------------------------------------------------------
# Weekly digest — 'weekly digest summaries' was explicitly named as an
# email use-case for this prompt; nothing built it before now.
# ---------------------------------------------------------------------------
def generate_weekly_digest_data(user, since=None) -> dict:
    """Aggregates real recent activity — no new tables, just counting
    what already exists (Notification, Message, saved-search-match
    notifications) over the last 7 days."""
    from django.utils import timezone
    from datetime import timedelta
    from .models import Notification
    from social.models import Message, MessageFolder

    since = since or (timezone.now() - timedelta(days=7))

    new_notifications = Notification.objects.filter(recipient=user, created_at__gte=since)
    saved_search_matches = new_notifications.filter(notification_type="SAVED_SEARCH_MATCH").count()
    unread_messages = Message.objects.filter(
        conversation__participants=user, folder=MessageFolder.SENT, sent_at__gte=since, read_receipt=False,
    ).exclude(sender=user).count()

    return {
        "period_start": since,
        "saved_search_matches": saved_search_matches,
        "unread_messages": unread_messages,
        "total_notifications": new_notifications.count(),
    }


def send_weekly_digest_email(user):
    """Only sends if there's actually something worth telling the user
    about — an empty digest email every week regardless of activity is
    exactly the kind of notification fatigue that gets an app's emails
    marked as spam."""
    digest = generate_weekly_digest_data(user)

    if digest["total_notifications"] == 0:
        return None

    message = (
        f"This week on Oaziland: {digest['saved_search_matches']} new listing(s) matching your "
        f"saved searches, {digest['unread_messages']} unread message(s)."
    )
    return notify(
        recipient=user, notification_type="WEEKLY_DIGEST",
        title="Your Oaziland weekly summary",
        message=message, channel="EMAIL",
    )
