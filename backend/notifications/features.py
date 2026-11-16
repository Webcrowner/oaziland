"""
notifications.features — which paid features the admins have switched on.

Three switches live in FeatureSettings (chat translation, SMS, email). Reading them is cached for a short time and
the cache is cleared whenever an admin saves, so a switch takes effect for everyone at once without a database read
on every notification.

SMS and email are switched off per *channel*: nothing is sent through them (so no provider bill) and the sign-up
choices that rely on them are hidden. Two kinds of message are always sent because losing them would lock someone
out or put them at risk: password-reset emails and emergency (SOS) alerts to a contact's phone.
"""
from django.core.cache import cache

CACHE_KEY = "feature_settings"
CACHE_SECONDS = 60
SWITCHABLE_CHANNELS = {"SMS": "sms_enabled", "EMAIL": "email_enabled"}


def _values() -> dict:
    values = cache.get(CACHE_KEY)
    if values is None:
        from .models import FeatureSettings
        row = FeatureSettings.get_settings()
        values = {
            "chat_translation_enabled": row.chat_translation_enabled,
            "sms_enabled": row.sms_enabled, "email_enabled": row.email_enabled,
        }
        cache.set(CACHE_KEY, values, CACHE_SECONDS)
    return values


def clear_cache() -> None:
    cache.delete(CACHE_KEY)


def channel_enabled(channel: str) -> bool:
    """False only for an external channel an admin has switched off; every other channel is always on."""
    field = SWITCHABLE_CHANNELS.get(channel)
    return True if field is None else bool(_values()[field])


def translation_switched_on() -> bool:
    return bool(_values()["chat_translation_enabled"])


def translation_available() -> bool:
    """Shown to users only when an admin has it on AND a translation provider is really connected."""
    from social.translation import provider_is_ready
    return translation_switched_on() and provider_is_ready()


def public_features() -> dict:
    """What the apps may offer right now. sms/email say whether people may pick that channel (for two-factor codes)."""
    return {
        "chat_translation": translation_available(),
        "sms": channel_enabled("SMS"),
        "email": channel_enabled("EMAIL"),
    }
