import os

from django.conf import settings
from django.core.checks import Warning, register


@register()
def warn_about_incomplete_payment_setup(app_configs, **kwargs):
    """Shown by runserver, migrate and `manage.py check`: names what still stops live marketplace payments working."""
    provider = os.environ.get("PAYMENT_GATEWAY_PROVIDER", "").strip().upper()
    problems = []

    if provider in ("", "SANDBOX"):
        problems.append("PAYMENT_GATEWAY_PROVIDER is " + (provider or "unset") + ", so no real payment can be taken")
    elif provider == "FAPSHI":
        if not (os.environ.get("FAPSHI_API_USER", "").strip() and os.environ.get("FAPSHI_API_KEY", "").strip()):
            problems.append("FAPSHI_API_USER / FAPSHI_API_KEY are not set")
        if "sandbox" in os.environ.get("FAPSHI_BASE_URL", "https://live.fapshi.com").lower():
            problems.append("FAPSHI_BASE_URL points at the Fapshi sandbox")
        if os.environ.get("FAPSHI_ALLOW_TEST_FALLBACK", "").lower() in ("true", "1"):
            problems.append("FAPSHI_ALLOW_TEST_FALLBACK is enabled, so failed payments are faked as successful")

    if not os.environ.get("REDIS_URL", "").strip():
        problems.append("REDIS_URL is not set, so booking and marketplace payments cannot take their locks")

    if settings.DEBUG or not problems:
        return []
    return [
        Warning(
            "Live payments are not ready: " + "; ".join(problems) + ".",
            hint=(
                "See backend/.env.example, and register https://<your-domain>/api/webhooks/payment/ as the webhook URL "
                "in the Fapshi dashboard."
            ),
            id="payments.W001",
        )
    ]
