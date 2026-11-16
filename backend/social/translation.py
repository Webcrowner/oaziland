"""
social.translation — translating a chat message into the reader's language, on request.

A paid provider does the work, chosen by environment variables (like the payment and notification providers):
  * Google Cloud Translation: GOOGLE_TRANSLATE_API_KEY
  * Azure AI Translator:      AZURE_TRANSLATOR_KEY (+ AZURE_TRANSLATOR_REGION)
  * TRANSLATION_PROVIDER=GOOGLE|AZURE|SANDBOX picks one explicitly; without it the first one with credentials wins.
SANDBOX is a free stand-in for development: it "translates" by prefixing the text, so the feature can be tried
without an account. With no provider at all the feature is not available and users never see it, whatever the admin
switch says (see notifications.features.translation_available).

Only the text of the one message the reader asked about is sent to the provider. Results are stored
(MessageTranslation), so a message is translated at most once per language, however many people read it.
"""
import os
from abc import ABC, abstractmethod

LANGUAGES = ("en", "fr")
MAX_CHARACTERS = 2000
TIMEOUT_SECONDS = 10


class TranslationError(Exception):
    """The provider failed or refused; the message says what to show the user."""


class Translator(ABC):
    name = ""
    test_mode = False

    @classmethod
    @abstractmethod
    def is_configured(cls) -> bool: ...

    @abstractmethod
    def translate(self, text: str, target: str) -> tuple[str, str]:
        """Returns (translated text, the detected source language code, lower case, e.g. "en")."""


def _short(code: str) -> str:
    return (code or "").split("-")[0].lower()


class SandboxTranslator(Translator):
    name = "SANDBOX"
    test_mode = True

    @classmethod
    def is_configured(cls) -> bool:
        return os.environ.get("TRANSLATION_PROVIDER", "").strip().upper() == "SANDBOX"

    def translate(self, text: str, target: str) -> tuple[str, str]:
        # Pretends the message was in the other language, so both the "translated" and the "same language" paths work.
        return f"[{target}] {text}", "fr" if target == "en" else "en"


class GoogleTranslator(Translator):
    name = "GOOGLE"

    @classmethod
    def is_configured(cls) -> bool:
        return bool(os.environ.get("GOOGLE_TRANSLATE_API_KEY", "").strip())

    def translate(self, text: str, target: str) -> tuple[str, str]:
        import requests
        try:
            response = requests.post(
                "https://translation.googleapis.com/language/translate/v2",
                params={"key": os.environ["GOOGLE_TRANSLATE_API_KEY"].strip()},
                json={"q": text, "target": target, "format": "text"},
                timeout=TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            item = response.json()["data"]["translations"][0]
            return item["translatedText"], _short(item.get("detectedSourceLanguage", ""))
        except (requests.RequestException, KeyError, IndexError, ValueError) as error:
            raise TranslationError("The translation service did not answer.") from error


class AzureTranslator(Translator):
    name = "AZURE"

    @classmethod
    def is_configured(cls) -> bool:
        return bool(os.environ.get("AZURE_TRANSLATOR_KEY", "").strip())

    def translate(self, text: str, target: str) -> tuple[str, str]:
        import requests
        headers = {"Ocp-Apim-Subscription-Key": os.environ["AZURE_TRANSLATOR_KEY"].strip(), "Content-Type": "application/json"}
        region = os.environ.get("AZURE_TRANSLATOR_REGION", "").strip()
        if region:
            headers["Ocp-Apim-Subscription-Region"] = region
        try:
            response = requests.post(
                "https://api.cognitive.microsofttranslator.com/translate",
                params={"api-version": "3.0", "to": target}, headers=headers, json=[{"Text": text}], timeout=TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            item = response.json()[0]
            return item["translations"][0]["text"], _short(item.get("detectedLanguage", {}).get("language", ""))
        except (requests.RequestException, KeyError, IndexError, ValueError) as error:
            raise TranslationError("The translation service did not answer.") from error


PROVIDERS = {"GOOGLE": GoogleTranslator, "AZURE": AzureTranslator, "SANDBOX": SandboxTranslator}


def active_provider() -> Translator | None:
    chosen = os.environ.get("TRANSLATION_PROVIDER", "").strip().upper()
    if chosen:
        provider = PROVIDERS.get(chosen)
        return provider() if provider and provider.is_configured() else None
    for provider in (GoogleTranslator, AzureTranslator):
        if provider.is_configured():
            return provider()
    return None


def provider_is_ready() -> bool:
    return active_provider() is not None


def provider_status() -> dict:
    provider = active_provider()
    return {"provider": provider.name if provider else "NONE", "ready": provider is not None, "test_mode": bool(provider and provider.test_mode)}


DAILY_LIMIT = 100  # provider calls per reader per day; a cached translation costs nothing and doesn't count


class TranslationUnavailable(Exception):
    """Switched off by an admin, or no provider is connected."""


class TranslationRefused(Exception):
    """The request can't be served (empty or too long text, or the daily limit); the message is shown to the user."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _use_daily_allowance(user) -> bool:
    from django.core.cache import cache
    from django.utils import timezone
    key = f"translate:{user.pk}:{timezone.localdate().isoformat()}"
    cache.add(key, 0, 24 * 60 * 60)
    return cache.incr(key) <= DAILY_LIMIT


def translate_message(message, target: str, user) -> dict:
    """The message's text in `target` for `user`, from the saved copy when there is one. Raises TranslationUnavailable,
    TranslationRefused or TranslationError."""
    from notifications.features import translation_available
    from .models import MessageTranslation

    if not translation_available():
        raise TranslationUnavailable()
    if target not in LANGUAGES:
        raise TranslationRefused("Choose English or French.")
    text = (message.text or "").strip()
    if not text:
        raise TranslationRefused("This message has no text to translate.")
    if len(text) > MAX_CHARACTERS:
        raise TranslationRefused(f"Messages longer than {MAX_CHARACTERS} characters can't be translated.")

    saved = MessageTranslation.objects.filter(message=message, target=target).first()
    if saved is not None:
        return _payload(saved.text, saved.source_language, target, saved.provider, cached=True)

    if not _use_daily_allowance(user):
        raise TranslationRefused("You have reached today's translation limit. Try again tomorrow.", status_code=429)
    provider = active_provider()
    translated, source = provider.translate(text, target)
    saved, _ = MessageTranslation.objects.get_or_create(
        message=message, target=target, defaults={"text": translated, "source_language": source, "provider": provider.name},
    )
    return _payload(saved.text, saved.source_language, target, saved.provider, cached=False)


def _payload(text: str, source: str, target: str, provider: str, *, cached: bool) -> dict:
    return {"text": text, "source_language": source, "target": target, "same_language": bool(source) and source == target, "provider": provider, "cached": cached}
