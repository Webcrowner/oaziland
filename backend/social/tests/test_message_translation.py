"""Chat translation: on request, saved after the first time, hidden when off, capped per reader."""
import pytest
from rest_framework.test import APIClient

from identity.models import User
from notifications.models import FeatureSettings
from social import translation
from social.models import Conversation, MessageTranslation
from social.services import send_message_now


def _user(name, **extra):
    return User.objects.create(username=name, phone=f"+2376{abs(hash(name)) % 10**8:08d}", **extra)


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture(autouse=True)
def sandbox_provider(monkeypatch):
    monkeypatch.setenv("TRANSLATION_PROVIDER", "SANDBOX")


@pytest.fixture
def chat():
    sender, reader = _user("tr_sender"), _user("tr_reader", preferred_language="FR")
    conversation = Conversation.objects.create()
    conversation.participants.add(sender, reader)
    return sender, reader, conversation


def _say(conversation, sender, text="Is the room still available?"):
    return send_message_now(conversation=conversation, sender=sender, text=text)


def _translate(client, conversation, message, **body):
    return client.post(f"/api/conversations/{conversation.pk}/messages/{message.pk}/translate/", body, format="json")


@pytest.mark.django_db
def test_a_message_is_translated_into_the_readers_language_by_default(chat):
    sender, reader, conversation = chat
    message = _say(conversation, sender)
    response = _translate(_client(reader), conversation, message)  # the reader's account is set to French
    assert response.status_code == 200
    assert response.data["target"] == "fr" and response.data["text"] == "[fr] Is the room still available?"
    assert response.data["same_language"] is False and response.data["cached"] is False and response.data["provider"] == "SANDBOX"
    assert _translate(_client(reader), conversation, message, target="en").data["target"] == "en"


@pytest.mark.django_db
def test_a_translation_is_paid_for_once_however_many_people_ask(chat, monkeypatch):
    sender, reader, conversation = chat
    message = _say(conversation, sender)
    calls = []
    real = translation.SandboxTranslator.translate
    monkeypatch.setattr(translation.SandboxTranslator, "translate", lambda self, text, target: calls.append(target) or real(self, text, target))

    first = _translate(_client(reader), conversation, message)
    again = _translate(_client(reader), conversation, message)
    by_sender = _translate(_client(sender), conversation, message, target="fr")
    assert first.data["cached"] is False and again.data["cached"] is True and by_sender.data["cached"] is True
    assert calls == ["fr"] and MessageTranslation.objects.count() == 1


@pytest.mark.django_db
def test_a_message_already_in_the_readers_language_is_reported_as_such(chat, monkeypatch):
    sender, reader, conversation = chat
    message = _say(conversation, sender, "Bonjour, la chambre est-elle libre ?")
    monkeypatch.setattr(translation.SandboxTranslator, "translate", lambda self, text, target: (text, target))
    response = _translate(_client(reader), conversation, message, target="fr")
    assert response.data["same_language"] is True and response.data["text"] == message.text


@pytest.mark.django_db
def test_it_is_hidden_when_an_admin_switches_it_off_or_no_provider_is_connected(chat, monkeypatch):
    sender, reader, conversation = chat
    message = _say(conversation, sender)
    row = FeatureSettings.get_settings()
    row.chat_translation_enabled = False
    row.save()
    assert _translate(_client(reader), conversation, message).status_code == 404

    row.chat_translation_enabled = True
    row.save()
    monkeypatch.delenv("TRANSLATION_PROVIDER")
    monkeypatch.delenv("GOOGLE_TRANSLATE_API_KEY", raising=False)
    monkeypatch.delenv("AZURE_TRANSLATOR_KEY", raising=False)
    assert _translate(_client(reader), conversation, message).status_code == 404
    assert MessageTranslation.objects.count() == 0


@pytest.mark.django_db
def test_only_the_people_in_the_conversation_can_translate_its_messages(chat):
    sender, _, conversation = chat
    message = _say(conversation, sender)
    assert _translate(_client(_user("tr_stranger")), conversation, message).status_code == 404
    other = Conversation.objects.create()
    other.participants.add(sender)
    assert _translate(_client(sender), other, message).status_code == 404  # a message from a different thread


@pytest.mark.django_db
def test_empty_long_and_wrongly_targeted_messages_are_refused_without_calling_the_provider(chat, monkeypatch):
    sender, reader, conversation = chat
    monkeypatch.setattr(translation.SandboxTranslator, "translate", lambda *a: pytest.fail("the provider must not be called"))
    assert _translate(_client(reader), conversation, _say(conversation, sender, "")).status_code == 400
    assert _translate(_client(reader), conversation, _say(conversation, sender, "x" * (translation.MAX_CHARACTERS + 1))).status_code == 400
    assert _translate(_client(reader), conversation, _say(conversation, sender, "hello"), target="de").status_code == 400


@pytest.mark.django_db
def test_a_reader_has_a_daily_allowance_and_saved_translations_do_not_use_it(chat, monkeypatch):
    sender, reader, conversation = chat
    monkeypatch.setattr(translation, "DAILY_LIMIT", 2)
    messages = [_say(conversation, sender, f"message {n}") for n in range(3)]
    client = _client(reader)
    assert [_translate(client, conversation, m).status_code for m in messages] == [200, 200, 429]
    assert _translate(client, conversation, messages[0]).status_code == 200  # already saved: free, so still allowed
    assert MessageTranslation.objects.count() == 2


@pytest.mark.django_db
def test_a_provider_failure_is_a_clean_error_and_nothing_is_saved(chat, monkeypatch):
    sender, reader, conversation = chat
    message = _say(conversation, sender)

    def broken(self, text, target):
        raise translation.TranslationError("The translation service did not answer.")

    monkeypatch.setattr(translation.SandboxTranslator, "translate", broken)
    response = _translate(_client(reader), conversation, message)
    assert response.status_code == 502 and "did not answer" in response.data["detail"]
    assert MessageTranslation.objects.count() == 0


def test_the_provider_is_chosen_from_the_environment(monkeypatch):
    for name in ("TRANSLATION_PROVIDER", "GOOGLE_TRANSLATE_API_KEY", "AZURE_TRANSLATOR_KEY"):
        monkeypatch.delenv(name, raising=False)
    assert translation.active_provider() is None and translation.provider_status()["ready"] is False
    monkeypatch.setenv("AZURE_TRANSLATOR_KEY", "k")
    assert translation.active_provider().name == "AZURE"
    monkeypatch.setenv("GOOGLE_TRANSLATE_API_KEY", "k")
    assert translation.active_provider().name == "GOOGLE"  # Google wins when both are set
    monkeypatch.setenv("TRANSLATION_PROVIDER", "AZURE")
    assert translation.active_provider().name == "AZURE"
    monkeypatch.setenv("TRANSLATION_PROVIDER", "NOPE")
    assert translation.active_provider() is None


def test_google_and_azure_answers_are_read_correctly(monkeypatch):
    import requests

    class Reply:
        def __init__(self, body):
            self.body = body

        def raise_for_status(self):
            pass

        def json(self):
            return self.body

    sent = {}

    def fake_post(url, **kwargs):
        sent["url"], sent["kwargs"] = url, kwargs
        if "googleapis" in url:
            return Reply({"data": {"translations": [{"translatedText": "Bonjour", "detectedSourceLanguage": "en"}]}})
        return Reply([{"detectedLanguage": {"language": "en-US"}, "translations": [{"text": "Bonjour", "to": "fr"}]}])

    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setenv("GOOGLE_TRANSLATE_API_KEY", "g-key")
    monkeypatch.setenv("AZURE_TRANSLATOR_KEY", "a-key")
    monkeypatch.setenv("AZURE_TRANSLATOR_REGION", "westeurope")

    assert translation.GoogleTranslator().translate("Hello", "fr") == ("Bonjour", "en")
    assert sent["kwargs"]["params"]["key"] == "g-key" and sent["kwargs"]["json"]["q"] == "Hello"
    assert translation.AzureTranslator().translate("Hello", "fr") == ("Bonjour", "en")
    assert sent["kwargs"]["headers"]["Ocp-Apim-Subscription-Region"] == "westeurope"

    def failing(url, **kwargs):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(requests, "post", failing)
    with pytest.raises(translation.TranslationError):
        translation.GoogleTranslator().translate("Hello", "fr")
