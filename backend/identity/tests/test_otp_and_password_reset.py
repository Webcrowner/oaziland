"""
Tests proving two real gaps this prompt closed: MfaChallenge codes are
now actually SENT (not just created), and a full password reset flow
now exists where none did before.
"""
import pytest
from datetime import timedelta
from django.utils import timezone

from identity.models import User, MfaMethod, MfaType, PasswordResetToken
from identity.services import issue_mfa_challenge, request_password_reset, confirm_password_reset, InvalidResetTokenError
from notifications.models import Notification


@pytest.mark.django_db
def test_sms_otp_is_actually_sent_not_just_created():
    user = User.objects.create(username="otp_sms_user", phone="+237699999301")
    method = MfaMethod.objects.create(user=user, mfa_type=MfaType.SMS_OTP, destination="+237699999301")

    challenge = issue_mfa_challenge(method)

    assert len(challenge.code) == 6
    notification = Notification.objects.filter(recipient=user, notification_type="MFA_CODE", channel="SMS")
    assert notification.exists()
    assert challenge.code in notification.first().message


@pytest.mark.django_db
def test_email_otp_routes_to_the_email_channel():
    user = User.objects.create(username="otp_email_user", phone="+237699999302", email="otp@example.com")
    method = MfaMethod.objects.create(user=user, mfa_type=MfaType.EMAIL_OTP, destination="otp@example.com")

    issue_mfa_challenge(method)

    assert Notification.objects.filter(recipient=user, notification_type="MFA_CODE", channel="EMAIL").exists()
    assert Notification.objects.filter(recipient=user, notification_type="MFA_CODE", channel="SMS").exists() is False


@pytest.mark.django_db
def test_password_reset_full_flow():
    user = User.objects.create(username="reset_user", phone="+237699999303", email="reset@example.com")
    user.set_password("original_password_123")
    user.save()

    reset_token = request_password_reset(user)
    email_notification = Notification.objects.filter(recipient=user, notification_type="PASSWORD_RESET", channel="EMAIL")
    assert email_notification.exists()
    assert reset_token.token in email_notification.first().message

    confirm_password_reset(token_value=reset_token.token, new_password="a_new_password_456")
    user.refresh_from_db()
    assert user.check_password("a_new_password_456") is True
    assert user.check_password("original_password_123") is False


@pytest.mark.django_db
def test_password_reset_token_cannot_be_reused():
    user = User.objects.create(username="reset_user_2", phone="+237699999304")
    reset_token = request_password_reset(user)

    confirm_password_reset(token_value=reset_token.token, new_password="first_new_password")

    with pytest.raises(InvalidResetTokenError):
        confirm_password_reset(token_value=reset_token.token, new_password="second_new_password")


@pytest.mark.django_db
def test_expired_password_reset_token_is_rejected():
    user = User.objects.create(username="reset_user_3", phone="+237699999305")
    reset_token = PasswordResetToken.objects.create(
        user=user, token="an-expired-test-token", expires_at=timezone.now() - timedelta(minutes=1),
    )

    with pytest.raises(InvalidResetTokenError):
        confirm_password_reset(token_value="an-expired-test-token", new_password="doesnt_matter")


@pytest.mark.django_db
def test_invalid_reset_token_is_rejected():
    with pytest.raises(InvalidResetTokenError):
        confirm_password_reset(token_value="this-token-does-not-exist", new_password="doesnt_matter")
