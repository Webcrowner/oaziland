"""
trust_safety.moderation_providers — the ContentModerationProvider
interface, following the exact same pattern as payments.gateways.
PaymentGateway: nothing else in this codebase should call OpenAI or
Google Cloud Vision directly — everything talks to 'a
ContentModerationProvider', so swapping or adding a provider later never
requires touching the code that calls it.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal


@dataclass
class ModerationScore:
    category: str            # a ModerationCategory value
    confidence_score: Decimal  # 0.000 - 1.000
    action: str               # a ModerationAction value


class ContentModerationProvider(ABC):
    @abstractmethod
    def analyze_text(self, text: str) -> list:
        """Returns a list of ModerationScore — a single piece of text can
        trigger more than one category (e.g. both profanity AND spam)."""
        raise NotImplementedError

    @abstractmethod
    def analyze_image(self, image_url: str) -> list:
        raise NotImplementedError


# A basic, deliberately simple word list — real production moderation
# should NOT rely on this; it exists purely so the sandbox provider below
# is a genuine, working implementation for tests and local development,
# not a provider that always says "everything's fine."
_TEST_PROFANITY_WORDS = {"scamword", "badword", "profanitytest"}


class SandboxModerationProvider(ContentModerationProvider):
    """A working, deterministic stand-in — flags text containing an
    obvious test trigger word, and flags any image URL containing
    'nudetest' in it. Good enough to prove the ENFORCEMENT logic works
    correctly; not a substitute for a real AI moderation call."""

    def analyze_text(self, text: str) -> list:
        from .models import ModerationCategory, ModerationAction
        lowered = text.lower()
        if any(word in lowered for word in _TEST_PROFANITY_WORDS):
            return [ModerationScore(
                category=ModerationCategory.TEXT_PROFANITY,
                confidence_score=Decimal("0.950"),
                action=ModerationAction.AUTO_REMOVE,
            )]
        return [ModerationScore(
            category=ModerationCategory.SPAM,
            confidence_score=Decimal("0.010"),
            action=ModerationAction.ALLOW,
        )]

    def analyze_image(self, image_url: str) -> list:
        from .models import ModerationCategory, ModerationAction
        if "nudetest" in image_url.lower():
            return [ModerationScore(
                category=ModerationCategory.IMAGE_NUDITY,
                confidence_score=Decimal("0.970"),
                action=ModerationAction.AUTO_REMOVE,
            )]
        return [ModerationScore(
            category=ModerationCategory.IMAGE_NUDITY,
            confidence_score=Decimal("0.005"),
            action=ModerationAction.ALLOW,
        )]


class OpenAIModerationProvider(ContentModerationProvider):
    """NOT YET CONNECTED — needs OPENAI_API_KEY. See .env.example."""

    def analyze_text(self, text: str) -> list:
        raise NotImplementedError("OpenAI moderation integration not yet built — requires real API credentials.")

    def analyze_image(self, image_url: str) -> list:
        raise NotImplementedError("OpenAI does not perform image moderation — use GoogleVisionModerationProvider.")


class GoogleVisionModerationProvider(ContentModerationProvider):
    """NOT YET CONNECTED — needs GOOGLE_CLOUD_VISION_API_KEY."""

    def analyze_text(self, text: str) -> list:
        raise NotImplementedError("Google Cloud Vision does not perform text moderation — use OpenAIModerationProvider.")

    def analyze_image(self, image_url: str) -> list:
        raise NotImplementedError("Google Cloud Vision integration not yet built — requires real API credentials.")


def get_active_moderation_provider() -> ContentModerationProvider:
    """The ONE place that decides which provider is in use — mirrors
    payments.gateways.get_active_gateway(). Always sandbox for now."""
    return SandboxModerationProvider()
