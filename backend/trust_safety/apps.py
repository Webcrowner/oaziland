from django.apps import AppConfig


class TrustSafetyConfig(AppConfig):
    name = 'trust_safety'

    def ready(self):
        from . import checks  # noqa: F401  (registers the moderation-provider warning)
