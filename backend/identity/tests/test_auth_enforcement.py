"""
Tests proving the MFA and KYC rules from Prompt 2 are actually enforced,
not just modeled. WHY this matters: a rule that only exists as a comment
or a docstring protects nobody — these tests fail loudly if the
enforcement logic is ever accidentally removed later.
"""
import pytest
from django.utils import timezone
from datetime import timedelta

from identity.models import User, MfaMethod, MfaType, KYCProfile
from identity.services import (
    user_has_verified_mfa, require_mfa_for_sensitive_action, MfaRequiredError,
    user_has_submitted_kyc, require_kyc_submitted_for_registration, KycNotSubmittedError,
)


@pytest.mark.django_db
def test_new_user_has_no_mfa_by_default():
    user = User.objects.create(username="new_user", phone="+237699100001")
    assert user_has_verified_mfa(user) is False


@pytest.mark.django_db
def test_sensitive_action_blocked_without_verified_mfa():
    user = User.objects.create(username="no_mfa_user", phone="+237699100002")
    with pytest.raises(MfaRequiredError):
        require_mfa_for_sensitive_action(user, action_description="list a property")


@pytest.mark.django_db
def test_unverified_mfa_method_still_blocks_sensitive_actions():
    """Adding an MFA method isn't enough on its own — it has to actually
    be VERIFIED (a real code was entered successfully at setup time)."""
    user = User.objects.create(username="unverified_mfa_user", phone="+237699100003")
    MfaMethod.objects.create(
        user=user, mfa_type=MfaType.SMS_OTP, destination=user.phone,
        is_primary=True, verified=False,
    )
    assert user_has_verified_mfa(user) is False
    with pytest.raises(MfaRequiredError):
        require_mfa_for_sensitive_action(user, action_description="make a payment")


@pytest.mark.django_db
def test_verified_mfa_allows_sensitive_actions():
    user = User.objects.create(username="verified_mfa_user", phone="+237699100004")
    MfaMethod.objects.create(
        user=user, mfa_type=MfaType.SMS_OTP, destination=user.phone,
        is_primary=True, verified=True,
    )
    assert user_has_verified_mfa(user) is True
    require_mfa_for_sensitive_action(user, action_description="list a property")  # should not raise


@pytest.mark.django_db
def test_registration_blocked_without_kyc_submission():
    user = User.objects.create(username="no_kyc_user", phone="+237699100005")
    assert user_has_submitted_kyc(user) is False
    with pytest.raises(KycNotSubmittedError):
        require_kyc_submitted_for_registration(user)


@pytest.mark.django_db
def test_submitted_kyc_unblocks_registration_even_while_pending():
    """Per the acceptance criteria: SUBMITTING is enough to complete
    registration — admin approval is a separate, later step."""
    user = User.objects.create(username="pending_kyc_user", phone="+237699100006")
    KYCProfile.objects.create(
        user=user, legal_full_name="Test User", date_of_birth="1990-01-01",
        national_id_number="CM-TEST-999", residential_address="Test Address",
    )
    assert user_has_submitted_kyc(user) is True
    require_kyc_submitted_for_registration(user)  # should not raise
    user.refresh_from_db()
    assert user.kyc_profile.kyc_status == "PENDING"  # not yet approved, and that's fine
