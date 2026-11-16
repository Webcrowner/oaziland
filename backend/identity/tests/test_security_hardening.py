"""Account-security rules: strong passwords, one-time codes that can't be brute-forced, sign-out of other devices on a
password change, and recorded agreement to the Terms and Privacy Policy at sign-up."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from compliance.models import ConsentRecord, PolicyDocument
from identity.models import MfaChallenge, MfaMethod, MfaType, User
from identity.services import confirm_password_reset, request_password_reset


def _register(**extra):
    payload = {"username": "sec_user", "phone": "+237699770001", "password": "Str0ng-and-unusual-pass", "accept_terms": True, **extra}
    return APIClient().post("/api/auth/register/", payload, format="json")


@pytest.mark.django_db
def test_signing_up_needs_agreement_and_records_the_policy_versions():
    PolicyDocument.objects.create(document_type="TERMS_OF_SERVICE", version="2.0", body_text="t", is_current=True)

    refused = _register(accept_terms=False)
    missing = APIClient().post("/api/auth/register/", {"username": "x_user", "phone": "+237699770009", "password": "Str0ng-and-unusual-pass"}, format="json")
    accepted = _register()

    assert refused.status_code == 400 and "accept_terms" in refused.data
    assert missing.status_code == 400
    assert accepted.status_code == 201
    consents = {c.consent_type: c.version for c in ConsentRecord.objects.filter(user__username="sec_user")}
    assert consents == {"TERMS_OF_SERVICE": "2.0", "PRIVACY_POLICY": "unpublished"}


@pytest.mark.django_db
def test_weak_passwords_are_refused_at_signup_and_reset():
    assert _register(password="12345678").status_code == 400
    assert _register(password="password").status_code == 400

    user = User.objects.create(username="weak_reset", phone="+237699770002")
    token = request_password_reset(user)
    response = APIClient().post("/api/auth/password-reset/confirm/", {"token": token.token, "new_password": "11111111"}, format="json")
    assert response.status_code == 400 and "new_password" in response.data


@pytest.mark.django_db
def test_a_code_dies_after_five_wrong_guesses():
    user = User.objects.create(username="otp_guess", phone="+237699770003")
    method = MfaMethod.objects.create(user=user, mfa_type=MfaType.SMS_OTP, destination=user.phone)
    challenge = MfaChallenge.objects.create(mfa_method=method, code="123456", expires_at=timezone.now() + timedelta(minutes=10))

    assert [challenge.verify("000000") for _ in range(5)] == [False] * 5
    assert challenge.verify("123456") is False  # the right code no longer works
    fresh = MfaChallenge.objects.create(mfa_method=method, code="654321", expires_at=timezone.now() + timedelta(minutes=10))
    assert fresh.verify("654321") is True


@pytest.mark.django_db
def test_codes_are_six_digits_from_a_secure_source(monkeypatch):
    from identity.services import issue_mfa_challenge

    user = User.objects.create(username="otp_gen", phone="+237699770004")
    method = MfaMethod.objects.create(user=user, mfa_type=MfaType.SMS_OTP, destination=user.phone)
    codes = {issue_mfa_challenge(method).code for _ in range(5)}
    assert all(len(c) == 6 and c.isdigit() for c in codes)


@pytest.mark.django_db
def test_changing_or_resetting_a_password_signs_out_other_devices():
    assert _register(username="sec_signout", phone="+237699770005").status_code == 201
    client = APIClient()
    tokens = client.post("/api/auth/login/", {"username": "sec_signout", "password": "Str0ng-and-unusual-pass"}, format="json").data

    assert client.post("/api/auth/login/refresh/", {"refresh": tokens["refresh"]}, format="json").status_code == 200

    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    changed = client.post(
        "/api/auth/change-password/", {"current_password": "Str0ng-and-unusual-pass", "new_password": "An0ther-unusual-pass"}, format="json",
    )
    assert changed.status_code == 200
    assert APIClient().post("/api/auth/login/refresh/", {"refresh": tokens["refresh"]}, format="json").status_code == 401

    other = APIClient().post("/api/auth/login/", {"username": "sec_signout", "password": "An0ther-unusual-pass"}, format="json").data
    confirm_password_reset(token_value=request_password_reset(User.objects.get(username="sec_signout")).token, new_password="Yet-an0ther-pass-9")
    assert APIClient().post("/api/auth/login/refresh/", {"refresh": other["refresh"]}, format="json").status_code == 401
