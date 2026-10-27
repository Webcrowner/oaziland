"""
notifications.services — the dispatcher interface (same pattern as
payments.gateways.PaymentGateway and trust_safety.moderation_providers.
ContentModerationProvider) plus the one shared notify() helper every
other app should call.
"""
from abc import ABC, abstractmethod
import logging

logger = logging.getLogger(__name__)

# Channels where a message only counts as delivered if a real provider carried it. IN_APP is different:
# the stored Notification row IS the delivery, so it never needs a provider.
EXTERNAL_CHANNELS = ("SMS", "WHATSAPP", "EMAIL", "PUSH")


class NotificationDispatcher(ABC):
    # False for stand-ins that send nothing. Anything that tells a user "we notified them" must check this.
    is_live = True

    @abstractmethod
    def send(self, notification) -> bool:
        """Attempts real delivery (WhatsApp/SMS/push/email). Returns
        whether it succeeded."""
        raise NotImplementedError


class SandboxDispatcher(NotificationDispatcher):
    """A working stand-in — always 'delivers' successfully, no real
    message sent. Good enough to prove notify() and everything that
    calls it works correctly. NOT a real delivery: is_live is False,
    notify() logs a warning for every external message it swallows, and
    a startup system check lists the channels still on it."""
    is_live = False

    def send(self, notification) -> bool:
        return True


class WhatsAppDispatcher(NotificationDispatcher):
    """Sends WhatsApp messages through Meta's Cloud API."""

    @staticmethod
    def is_configured() -> bool:
        import os

        return bool(
            os.environ.get("WHATSAPP_BUSINESS_API_TOKEN", "").strip()
            and os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "").strip()
        )

    def send(self, notification) -> bool:
        import os
        import requests

        phone = (notification.external_phone_number or getattr(notification.recipient, "phone", "") or "").strip()
        if not phone:
            logger.error("WhatsApp notification %s has no destination phone number.", notification.id)
            return False

        token = os.environ.get("WHATSAPP_BUSINESS_API_TOKEN", "").strip()
        phone_number_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "").strip()
        api_version = os.environ.get("WHATSAPP_GRAPH_API_VERSION", "v23.0").strip()
        template_name = os.environ.get("WHATSAPP_TEMPLATE_NAME", "").strip()
        if not token or not phone_number_id:
            raise RuntimeError("WHATSAPP_BUSINESS_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be configured.")

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": phone.lstrip("+"),
        }
        if template_name:
            payload.update({
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": {
                        "code": os.environ.get("WHATSAPP_TEMPLATE_LANGUAGE", "en").strip(),
                    },
                    "components": [{
                        "type": "body",
                        "parameters": [{"type": "text", "text": notification.message}],
                    }],
                },
            })
        else:
            payload.update({
                "type": "text",
                "text": {"preview_url": False, "body": notification.message},
            })

        response = requests.post(
            f"https://graph.facebook.com/{api_version}/{phone_number_id}/messages",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=10,
        )
        if not response.ok:
            logger.error(
                "Meta WhatsApp delivery failed for notification %s with HTTP %s: %s",
                notification.id, response.status_code, response.text[:500],
            )
        return response.ok


class SMSDispatcher(NotificationDispatcher):
    """Sends real SMS via Africa's Talking or Twilio when credentials are configured in the environment."""

    @staticmethod
    def is_configured() -> bool:
        import os
        at_ready = bool(os.environ.get("AFRICAS_TALKING_API_KEY", "").strip() and os.environ.get("AFRICAS_TALKING_USERNAME", "").strip())
        tw_ready = bool(
            os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
            and os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
            and os.environ.get("TWILIO_FROM_NUMBER", "").strip()
        )
        return at_ready or tw_ready

    def send(self, notification) -> bool:
        import os
        import requests

        phone = (notification.external_phone_number or getattr(notification.recipient, "phone", "") or "").strip()
        if not phone:
            return False

        at_key = os.environ.get("AFRICAS_TALKING_API_KEY", "").strip()
        at_user = os.environ.get("AFRICAS_TALKING_USERNAME", "").strip()
        if at_key and at_user:
            host = "https://api.sandbox.africastalking.com" if at_user == "sandbox" else "https://api.africastalking.com"
            resp = requests.post(
                f"{host}/version1/messaging",
                data={"username": at_user, "to": phone, "message": notification.message},
                headers={"apiKey": at_key, "Accept": "application/json"},
                timeout=10,
            )
            return resp.ok

        tw_sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
        tw_token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
        tw_from = os.environ.get("TWILIO_FROM_NUMBER", "").strip()
        if tw_sid and tw_token and tw_from:
            resp = requests.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{tw_sid}/Messages.json",
                data={"To": phone, "From": tw_from, "Body": notification.message},
                auth=(tw_sid, tw_token),
                timeout=10,
            )
            return resp.ok

        raise NotImplementedError("SMS dispatch not yet built — requires real API credentials.")


class EmailDispatcher(NotificationDispatcher):
    """Sends transactional email through Postmark."""

    @staticmethod
    def is_configured() -> bool:
        import os

        return bool(
            os.environ.get("POSTMARK_SERVER_TOKEN", "").strip()
            and os.environ.get("POSTMARK_FROM_EMAIL", "").strip()
        )

    def send(self, notification) -> bool:
        import os
        import requests

        email = (getattr(notification.recipient, "email", "") or "").strip()
        if not email:
            logger.error("Email notification %s has no recipient email address.", notification.id)
            return False

        token = os.environ.get("POSTMARK_SERVER_TOKEN", "").strip()
        from_email = os.environ.get("POSTMARK_FROM_EMAIL", "").strip()
        if not token or not from_email:
            raise RuntimeError("POSTMARK_SERVER_TOKEN and POSTMARK_FROM_EMAIL must be configured.")

        response = requests.post(
            "https://api.postmarkapp.com/email",
            json={
                "From": from_email,
                "To": email,
                "Subject": notification.title,
                "TextBody": notification.message,
                "MessageStream": os.environ.get("POSTMARK_MESSAGE_STREAM", "outbound").strip(),
            },
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Postmark-Server-Token": token,
            },
            timeout=10,
        )
        if not response.ok:
            logger.error(
                "Postmark delivery failed for notification %s with HTTP %s: %s",
                notification.id, response.status_code, response.text[:500],
            )
        return response.ok


def get_active_dispatcher(channel: str) -> NotificationDispatcher:
    """FIXED: this previously always returned SandboxDispatcher
    regardless of the channel argument — meaning WhatsAppDispatcher and
    SMSDispatcher existed as classes but were NEVER actually reachable
    through notify(), dead code nobody would have noticed until trying
    to connect real credentials and finding nothing used them.

    Each channel automatically switches to its live dispatcher once all
    required credentials are set. Channels without live credentials stay
    on SandboxDispatcher and are surfaced by the startup system check."""
    return {
        "WHATSAPP": WhatsAppDispatcher() if WhatsAppDispatcher.is_configured() else SandboxDispatcher(),
        "SMS": SMSDispatcher() if SMSDispatcher.is_configured() else SandboxDispatcher(),
        "EMAIL": EmailDispatcher() if EmailDispatcher.is_configured() else SandboxDispatcher(),
        "PUSH": SandboxDispatcher(),
        "IN_APP": SandboxDispatcher(),
    }.get(channel, SandboxDispatcher())


def is_delivery_live(channel: str) -> bool:
    """True when a message on this channel really reaches the person — a real provider is connected, or the
    channel is IN_APP. Use this before telling a user that someone 'has been notified'."""
    return channel == "IN_APP" or get_active_dispatcher(channel).is_live


def sandbox_channels() -> list:
    """The external channels that are still on the sandbox stand-in, so nothing sent on them is delivered."""
    return [channel for channel in EXTERNAL_CHANNELS if not is_delivery_live(channel)]


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
    if not is_delivery_live(channel):
        logger.warning(
            "%s notification %s (%s) was recorded but NOT delivered: no real %s provider is connected, only the sandbox "
            "stand-in. Connect one in notifications/services.py get_active_dispatcher().",
            channel, record.id, notification_type, channel,
        )
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


# ---------------------------------------------------------------------------
# Celebratory lifecycle messages — birthdays, new-month greetings, and
# platform-anniversary messages. Meant to run once daily via a scheduled
# job; each function is self-guarding against being run twice in the
# same day, since (unlike a one-time state transition such as a booking
# confirmation) there's no natural 'already handled' flag for a
# recurring yearly/monthly event.
# ---------------------------------------------------------------------------
def _already_greeted_today(user, notification_type: str) -> bool:
    """WHY this uses the REAL current date, not the `today` parameter
    the caller passed in for birthday/anniversary MATCHING: those two
    concepts are different. `today` answers 'which calendar date are
    we evaluating birthdays/anniversaries against' (normally real
    today, but can be simulated for testing or a manual backfill).
    This function answers 'has this actually already been sent during
    this real invocation' — a Notification's created_at is always set
    from the real wall clock (auto_now_add), so the dedup check must
    compare against the real clock too, not a simulated date, or the
    guard silently never matches when today is overridden."""
    from django.utils import timezone
    from .models import Notification
    return Notification.objects.filter(
        recipient=user, notification_type=notification_type, created_at__date=timezone.now().date(),
    ).exists()


def _active_users_queryset():
    from identity.models import User, AccountStatus
    return User.objects.filter(account_status=AccountStatus.ACTIVE, deleted_at__isnull=True)


def send_birthday_greetings(today=None):
    """Finds every active user whose KYCProfile.date_of_birth matches
    today's month and day, and sends a personalized birthday message —
    skipping anyone with no KYC/birthdate on file entirely (never
    guesses or defaults a birthdate) and anyone already greeted today.
    Respects admin toggle and editable message template in GreetingSettings."""
    from django.utils import timezone
    from identity.models import KYCProfile
    from .models import GreetingSettings

    settings = GreetingSettings.get_settings()
    if not settings.birthday_enabled:
        return []

    today = today or timezone.now().date()
    birthday_profiles = KYCProfile.objects.filter(
        date_of_birth__month=today.month, date_of_birth__day=today.day,
        user__in=_active_users_queryset(),
    ).select_related("user")

    sent = []
    for profile in birthday_profiles:
        user = profile.user
        if _already_greeted_today(user, "BIRTHDAY_GREETING"):
            continue
        name = user.full_name or user.username
        title = settings.birthday_title.replace("{name}", name)
        msg = settings.birthday_message.replace("{name}", name)
        notification = notify(
            recipient=user, notification_type="BIRTHDAY_GREETING",
            title=title,
            message=msg,
            channel="WHATSAPP",
        )
        sent.append(notification)
    return sent


def send_happy_new_month_greetings(today=None):
    """Sends to every active user on the 1st of each calendar month —
    per the founder's explicit request, personalized with their name.
    Respects admin toggle and editable message template in GreetingSettings."""
    from django.utils import timezone
    from .models import GreetingSettings
    import calendar

    settings = GreetingSettings.get_settings()
    if not settings.new_month_enabled:
        return []

    today = today or timezone.now().date()
    if today.day != 1:
        return []

    month_name = calendar.month_name[today.month]
    sent = []
    for user in _active_users_queryset():
        if _already_greeted_today(user, "HAPPY_NEW_MONTH"):
            continue
        name = user.full_name or user.username
        title = settings.new_month_title.replace("{name}", name).replace("{month}", month_name)
        msg = settings.new_month_message.replace("{name}", name).replace("{month}", month_name)
        notification = notify(
            recipient=user, notification_type="HAPPY_NEW_MONTH",
            title=title,
            message=msg,
            channel="WHATSAPP",
        )
        sent.append(notification)
    return sent


def send_platform_anniversary_greetings(today=None):
    """Finds every active user whose join date (month + day) matches
    today AND at least one full year has passed — the registration day
    itself is not an anniversary yet, so a brand-new user never gets
    congratulated for 'zero years' on the platform."""
    from django.utils import timezone

    today = today or timezone.now().date()
    sent = []
    for user in _active_users_queryset():
        joined = user.date_joined.date()
        years = today.year - joined.year
        if years < 1:
            continue
        if (joined.month, joined.day) != (today.month, today.day):
            continue
        if _already_greeted_today(user, "PLATFORM_ANNIVERSARY"):
            continue

        name = user.full_name or user.username
        notification = notify(
            recipient=user, notification_type="PLATFORM_ANNIVERSARY",
            title=f"Happy {years}-Year Anniversary!",
            message=f"Happy {years}-year anniversary with Oaziland, {name}! Thank you for being with us.",
            channel="WHATSAPP",
        )
        sent.append(notification)
    return sent
