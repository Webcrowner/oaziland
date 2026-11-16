from django.conf import settings
from django.core.checks import Warning, register


@register()
def warn_about_sandbox_moderation(app_configs, **kwargs):
    """Without OPENAI_API_KEY the stand-in provider runs: it only reacts to a few test words, so nothing real is checked."""
    if settings.DEBUG or getattr(settings, "OPENAI_API_KEY", ""):
        return []
    return [
        Warning(
            "Content moderation is NOT checking posts: OPENAI_API_KEY is not set, so the sandbox stand-in is in use.",
            hint="Set OPENAI_API_KEY (see backend/.env.example) so captions, tags and photos are checked and videos are queued for review.",
            id="trust_safety.W001",
        )
    ]
