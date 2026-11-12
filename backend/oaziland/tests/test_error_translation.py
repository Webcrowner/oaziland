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


@pytest.mark.django_db
def test_course_errors_with_a_variable_part_are_translated_for_french_learners():
    from careers.models import CourseModule, Lesson, TrainingCategory, TrainingProgram
    from careers.services import enroll_in_training

    learner = User.objects.create(username="i18n_learner", phone="+237699555003")
    program = TrainingProgram.objects.create(provider=learner, title="Lease Law", category=TrainingCategory.TENANT_LAW)
    lesson = Lesson.objects.create(module=CourseModule.objects.create(program=program, title="M"), title="Read")
    enrollment = enroll_in_training(program=program, student=learner)
    enrollment.status = "DROPPED"
    enrollment.save(update_fields=["status"])
    url = f"/api/my-enrollments/{enrollment.id}/lessons/{lesson.id}/complete/"

    assert _client(learner).post(url).json()["detail"] == "Cannot make progress on an enrollment that is dropped."
    assert _client(learner, "fr").post(url).json()["detail"] == "Impossible d'avancer : cette inscription est abandonnée."


def test_patterns_translate_whole_messages_only():
    from oaziland.error_translation import _translate

    assert _translate("This course costs 25000 XAF. Pay for it to enroll.") == "Cette formation coûte 25000 XAF. Payez-la pour vous inscrire."
    assert _translate("Cannot complete an enrollment that is in progress.") == "Impossible de terminer : cette inscription est en cours."
    assert _translate("The reply must be 5000 characters or fewer.") == "La réponse doit comporter 5000 caractères au maximum."
    assert _translate("Write a title.") == "Écrivez un titre."
    assert _translate({"detail": ["Add at least one question to every quiz first. Without questions: “Final quiz”."]}) == {
        "detail": ["Ajoutez d'abord au moins une question à chaque quiz. Sans question : “Final quiz”."],
    }
    # A message that merely contains a known pattern (e.g. user text) is left alone.
    assert _translate("My note: Write a title. Thanks") == "My note: Write a title. Thanks"
