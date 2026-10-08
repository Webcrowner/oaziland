import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from oaziland.error_translation import FRENCH_ERRORS


def _client(user, language=None):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    if language:
        client.defaults["HTTP_ACCEPT_LANGUAGE"] = language
    return client


@pytest.mark.django_db
def test_known_error_messages_are_returned_in_french_only_when_asked():
    user = User.objects.create(username="i18n_user", phone="+237699555001")

    english = _client(user).put("/api/my-technician-documents/", {"credential_urls": [], "portfolio_urls": []}, format="json")
    french = _client(user, "fr-FR,fr;q=0.9").put("/api/my-technician-documents/", {"credential_urls": [], "portfolio_urls": []}, format="json")

    assert english.status_code == 403
    assert english.json()["detail"] == "You have not registered as a technician yet."
    assert french.json()["detail"] == FRENCH_ERRORS["You have not registered as a technician yet."]


@pytest.mark.django_db
def test_validation_errors_in_lists_are_translated_and_success_responses_are_untouched():
    user = User.objects.create(username="i18n_user2", phone="+237699555002")
    client = _client(user, "fr")

    ok = client.post("/api/my-technician-profile/", {"specialties": ["PLUMBING"]}, format="json")
    again = client.post("/api/my-technician-profile/", {"specialties": ["PLUMBING"]}, format="json")

    assert ok.status_code == 201
    assert ok.json()["specialties"] == ["PLUMBING"]
    assert again.status_code == 400
    assert again.json()["detail"] == FRENCH_ERRORS["You are already registered as a technician."]
