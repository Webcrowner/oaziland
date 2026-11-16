"""
notifications.push — sends a user's notifications to their phones and browsers.

Two delivery paths, both free:
- Web Push (browsers): needs a VAPID key pair in the environment, VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY,
  plus VAPID_SUBJECT (a mailto: or https: contact). Generate them with `manage.py generate_vapid_keys`.
- Expo push (the mobile app): no server key needed. The app can only get a token once it is built with an
  Expo (EAS) project ID. EXPO_ACCESS_TOKEN is optional, for projects with enhanced push security turned on.

Sends are best-effort: a push failure is logged and never breaks the action that caused the notification.
"""
import json
import logging
import os

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
SEND_TIMEOUT_SECONDS = 5

# Where tapping the notification takes the person.
URL_FOR_TYPE = {
    "RIDE_OFFER": "/oazigo",
    "RIDE_UPDATE": "/oazigo/trips",
    "RIDE_MESSAGE": "/oazigo/trips",
    "RIDE_SOS": "/admin?tab=sos",
    "RIDE_ISSUE": "/admin?tab=rides",
}
DEFAULT_URL = "/notifications"

# Offers are worthless once they expire, so the push service may drop them after that.
TTL_FOR_TYPE = {"RIDE_OFFER": 20}
DEFAULT_TTL_SECONDS = 24 * 60 * 60
URGENT_TYPES = {"RIDE_OFFER", "RIDE_SOS"}


def web_push_configured() -> bool:
    return bool(os.environ.get("VAPID_PUBLIC_KEY", "").strip() and os.environ.get("VAPID_PRIVATE_KEY", "").strip())


def web_push_public_key() -> str:
    return os.environ.get("VAPID_PUBLIC_KEY", "").strip()


def _payload(notification) -> dict:
    kind = notification.notification_type
    return {
        "title": notification.title,
        "body": notification.message[:240],
        "url": URL_FOR_TYPE.get(kind, DEFAULT_URL),
        "type": kind,
        "reference": notification.related_reference,
        # Same tag replaces an older notification about the same thing instead of stacking up.
        "tag": f"{kind}:{notification.related_reference}" if notification.related_reference else kind,
    }


def _send_web(device, payload: dict, ttl: int, urgent: bool) -> bool:
    """True when delivered; deletes the device when the browser's subscription is gone."""
    from pywebpush import webpush, WebPushException

    try:
        webpush(
            subscription_info={"endpoint": device.token, "keys": {"p256dh": device.web_p256dh, "auth": device.web_auth}},
            data=json.dumps(payload),
            vapid_private_key=os.environ["VAPID_PRIVATE_KEY"].strip(),
            vapid_claims={"sub": os.environ.get("VAPID_SUBJECT", "mailto:support@oaziland.com").strip()},
            ttl=ttl,
            headers={"Urgency": "high" if urgent else "normal"},
            timeout=SEND_TIMEOUT_SECONDS,
        )
        return True
    except WebPushException as exc:
        status_code = getattr(exc.response, "status_code", None)
        if status_code in (404, 410):
            device.delete()
        else:
            logger.warning("Web push to device %s failed (HTTP %s): %s", device.pk, status_code, exc)
        return False


def _send_expo(devices: list, payload: dict, ttl: int, urgent: bool) -> int:
    """Sends one message per Expo token in a single request; returns how many were accepted."""
    import requests

    messages = [
        {
            "to": device.token, "title": payload["title"], "body": payload["body"], "sound": "default",
            "priority": "high" if urgent else "default", "ttl": ttl, "channelId": "default",
            "data": {"url": payload["url"], "type": payload["type"], "reference": payload["reference"]},
        }
        for device in devices
    ]
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    access_token = os.environ.get("EXPO_ACCESS_TOKEN", "").strip()
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    response = requests.post(EXPO_PUSH_URL, json=messages, headers=headers, timeout=SEND_TIMEOUT_SECONDS)
    if not response.ok:
        logger.warning("Expo push failed with HTTP %s: %s", response.status_code, response.text[:300])
        return 0
    accepted = 0
    for device, ticket in zip(devices, response.json().get("data", [])):
        if ticket.get("status") == "ok":
            accepted += 1
        elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
            device.delete()
        else:
            logger.warning("Expo push to device %s was rejected: %s", device.pk, ticket.get("message"))
    return accepted


def push_notification(notification) -> int:
    """Pushes one notification to every device of its recipient. Returns how many devices accepted it."""
    from django.utils import timezone
    from .models import PushDevice, PushPlatform

    if notification.recipient_id is None:
        return 0
    devices = list(PushDevice.objects.filter(user_id=notification.recipient_id))
    if not devices:
        return 0
    kind = notification.notification_type
    payload = _payload(notification)
    ttl = TTL_FOR_TYPE.get(kind, DEFAULT_TTL_SECONDS)
    urgent = kind in URGENT_TYPES
    delivered_web = []
    if web_push_configured():
        for device in (d for d in devices if d.platform == PushPlatform.WEB):
            try:
                if _send_web(device, payload, ttl, urgent):
                    delivered_web.append(device.pk)
            except Exception:
                logger.exception("Web push to device %s crashed", device.pk)

    expo_devices = [d for d in devices if d.platform == PushPlatform.EXPO]
    sent_expo = 0
    if expo_devices:
        try:
            sent_expo = _send_expo(expo_devices, payload, ttl, urgent)
        except Exception:
            logger.exception("Expo push for notification %s crashed", notification.pk)

    used = delivered_web + ([d.pk for d in expo_devices if d.pk is not None] if sent_expo else [])
    if used:
        PushDevice.objects.filter(pk__in=used).update(last_used_at=timezone.now())
    return len(delivered_web) + sent_expo
