"""Two-factor sign-in: a person with a verified SMS/email method needs the password AND the code."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from identity.models import User, MfaMethod, MfaChallenge
from notifications.models import FeatureSettings

PASSWORD = "Str0ng-and-unusual-pass"


def _user(name="mfa_login_user", **method):
    user = User.objects.create_user(username=name, password=PASSWORD, phone="+237699777701")
    if method:
        MfaMethod.objects.create(user=user, verified=True, **method)
    return user


def _login(name="mfa_login_user"):
    return APIClient().post("/api/auth/login/", {"username": name, "password": PASSWORD}, format="json")


@pytest.mark.django_db
def test_without_two_factor_login_returns_tokens_as_before():
    _user()
    response = _login()
    assert response.status_code == 200
    assert {"access", "refresh"} <= set(response.data)


@pytest.mark.django_db
def test_with_two_factor_password_alone_gets_no_tokens():
    _user(mfa_type="SMS_OTP", destination="+237699777701")
    response = _login()
    assert response.status_code == 202
    assert response.data["mfa_required"] is True
    assert response.data["method"] == "SMS_OTP"
    assert "access" not in response.data and "refresh" not in response.data
    assert "699777701" not in response.data["destination_hint"]


@pytest.mark.django_db
def test_wrong_password_never_sends_a_code():
    _user(mfa_type="EMAIL_OTP", destination="a@b.com")
    response = APIClient().post("/api/auth/login/", {"username": "mfa_login_user", "password": "nope"}, format="json")
    assert response.status_code == 401
    assert MfaChallenge.objects.count() == 0


@pytest.mark.django_db
def test_code_completes_sign_in_once():
    user = _user(mfa_type="EMAIL_OTP", destination="a@b.com")
    challenge_id = _login().data["challenge_id"]
    code = MfaChallenge.objects.get(id=challenge_id).code

    done = APIClient().post("/api/auth/mfa/login/", {"challenge_id": challenge_id, "code": code}, format="json")
    assert done.status_code == 200
    assert str(AccessToken(done.data["access"])["user_id"]) == str(user.pk)

    replay = APIClient().post("/api/auth/mfa/login/", {"challenge_id": challenge_id, "code": code}, format="json")
    assert replay.status_code == 400


@pytest.mark.django_db
def test_wrong_code_and_unknown_challenge_are_refused():
    _user(mfa_type="SMS_OTP", destination="+237699777701")
    challenge_id = _login().data["challenge_id"]
    client = APIClient()
    assert client.post("/api/auth/mfa/login/", {"challenge_id": challenge_id, "code": "000000x"}, format="json").status_code == 400
    assert client.post("/api/auth/mfa/login/", {"challenge_id": "not-a-uuid", "code": "123456"}, format="json").status_code == 400
    assert client.post("/api/auth/mfa/login/", {}, format="json").status_code == 400


@pytest.mark.django_db
def test_unverified_method_cannot_finish_a_sign_in():
    user = User.objects.create_user(username="half_setup", password=PASSWORD)
    method = MfaMethod.objects.create(user=user, mfa_type="SMS_OTP", destination="+237699777702", verified=False)
    challenge = MfaChallenge.objects.create(mfa_method=method, code="123456", expires_at="2999-01-01T00:00:00Z")
    response = APIClient().post("/api/auth/mfa/login/", {"challenge_id": str(challenge.id), "code": "123456"}, format="json")
    assert response.status_code == 400
    assert _login("half_setup").status_code == 200  # nothing verified, so the password alone signs in


@pytest.mark.django_db
def test_switched_off_channel_does_not_lock_the_user_out():
    _user(mfa_type="SMS_OTP", destination="+237699777701")
    row = FeatureSettings.get_settings()
    row.sms_enabled = False
    row.save()
    assert _login().status_code == 200


@pytest.mark.django_db
def test_another_working_method_is_used_when_one_channel_is_off():
    user = _user(mfa_type="SMS_OTP", destination="+237699777701")
    MfaMethod.objects.create(user=user, mfa_type="EMAIL_OTP", destination="a@b.com", verified=True)
    row = FeatureSettings.get_settings()
    row.sms_enabled = False
    row.save()
    response = _login()
    assert response.status_code == 202 and response.data["method"] == "EMAIL_OTP"
