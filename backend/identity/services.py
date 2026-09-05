"""
identity.services — the enforcement rules that make MFA and KYC actually
mean something.

WHY this file exists: having MfaMethod and KYCProfile as database models
does nothing on its own — nothing stops a user without either from
listing a property or paying for a booking unless something actively
checks for them at the right moment. This file is that check, written
ONCE here so every part of the app (web, mobile, admin) enforces the
same rule the same way, instead of each feature re-implementing (and
possibly getting wrong) its own version of "is this user allowed to do
sensitive things yet."
"""


class MfaRequiredError(Exception):
    """Raised when a user tries to do something sensitive (list a
    property, make a payment) without having set up MFA yet."""


class KycNotSubmittedError(Exception):
    """Raised when a user tries to complete registration without having
    at least submitted their KYC information (it doesn't need to be
    APPROVED yet — just submitted)."""


def user_has_verified_mfa(user) -> bool:
    """True if this user has at least one MFA method that has been set
    up and confirmed working (not just added, but actually verified with
    a real code at setup time)."""
    return user.mfa_methods.filter(verified=True).exists()


def require_mfa_for_sensitive_action(user, action_description: str = "perform this action"):
    """Call this at the START of any sensitive action (listing a
    property, making a payment) before doing anything else. Read-only
    browsing should NEVER call this — only actions that create or move
    something of value."""
    if not user_has_verified_mfa(user):
        raise MfaRequiredError(
            f"You must set up multi-factor authentication before you can "
            f"{action_description}. Please add and verify an MFA method first."
        )


def user_has_submitted_kyc(user) -> bool:
    """True the moment KYC has been SUBMITTED, regardless of whether an
    admin has approved it yet — registration only requires submission,
    not approval, per Prompt 2's acceptance criteria."""
    return hasattr(user, "kyc_profile")


def require_kyc_submitted_for_registration(user):
    """Call this at the point registration is considered 'complete' —
    e.g. right before granting full account access."""
    if not user_has_submitted_kyc(user):
        raise KycNotSubmittedError(
            "Registration cannot complete until KYC information has been "
            "submitted (national ID, date of birth, and address)."
        )


# ---------------------------------------------------------------------------
# OTP issuance — a real gap this closes: MfaChallenge could always be
# CREATED, but nothing ever actually sent the code anywhere.
# ---------------------------------------------------------------------------
OTP_LENGTH = 6
OTP_VALIDITY_MINUTES = 10


def issue_mfa_challenge(mfa_method):
    """Generates a real random code, creates the MfaChallenge record,
    and actually sends it — via SMS or Email depending on the method's
    type — through the shared notify() function. AUTHENTICATOR_APP
    methods generate their code locally (TOTP) and never reach this
    function at all; only SMS_OTP/EMAIL_OTP need a code dispatched."""
    import random
    from django.utils import timezone
    from datetime import timedelta
    from .models import MfaChallenge, MfaType
    from notifications.services import notify

    code = "".join(random.choices("0123456789", k=OTP_LENGTH))
    challenge = MfaChallenge.objects.create(
        mfa_method=mfa_method, code=code,
        expires_at=timezone.now() + timedelta(minutes=OTP_VALIDITY_MINUTES),
    )

    channel = "SMS" if mfa_method.mfa_type == MfaType.SMS_OTP else "EMAIL"
    notify(
        recipient=mfa_method.user, notification_type="MFA_CODE",
        title="Your Oaziland verification code",
        message=f"Your verification code is {code}. It expires in {OTP_VALIDITY_MINUTES} minutes.",
        channel=channel, related_reference=str(challenge.id),
    )

    return challenge


# ---------------------------------------------------------------------------
# Password reset — a real gap this closes: no reset flow existed at all.
# ---------------------------------------------------------------------------
PASSWORD_RESET_VALIDITY_MINUTES = 30


class InvalidResetTokenError(Exception):
    pass


def request_password_reset(user):
    """Generates a real, single-use token and emails it — never reveals
    whether a given username/email actually exists to the caller of
    this function (that check belongs at the view/API layer, which
    should return the same generic response either way to avoid
    leaking which accounts exist)."""
    import secrets
    from django.utils import timezone
    from datetime import timedelta
    from .models import PasswordResetToken
    from notifications.services import notify

    token_value = secrets.token_urlsafe(32)
    reset_token = PasswordResetToken.objects.create(
        user=user, token=token_value,
        expires_at=timezone.now() + timedelta(minutes=PASSWORD_RESET_VALIDITY_MINUTES),
    )

    notify(
        recipient=user, notification_type="PASSWORD_RESET",
        title="Reset your Oaziland password",
        message=f"Use this code to reset your password: {token_value}. It expires in {PASSWORD_RESET_VALIDITY_MINUTES} minutes.",
        channel="EMAIL", related_reference=str(reset_token.id),
    )
    return reset_token


def confirm_password_reset(*, token_value: str, new_password: str):
    from django.utils import timezone
    from .models import PasswordResetToken

    try:
        reset_token = PasswordResetToken.objects.get(token=token_value)
    except PasswordResetToken.DoesNotExist:
        raise InvalidResetTokenError("This reset link is invalid.")

    if not reset_token.is_valid():
        raise InvalidResetTokenError("This reset link has expired or was already used.")

    user = reset_token.user
    user.set_password(new_password)
    user.save(update_fields=["password"])

    reset_token.consumed_at = timezone.now()
    reset_token.save(update_fields=["consumed_at"])
    return user


# ---------------------------------------------------------------------------
# Referral codes — a real, persistent, shareable code per user, not
# just an implicit referrer/referred_user pairing with nothing a
# person can actually hand out.
# ---------------------------------------------------------------------------
def get_or_create_referral_code(user) -> str:
    """Generates a real, unique, human-shareable code the FIRST time
    it's needed, and returns the SAME code every time after — a user's
    referral code must be stable, or a link they already shared would
    silently stop working."""
    if user.referral_code:
        return user.referral_code

    import random
    import string
    from .models import User

    while True:
        candidate = (user.username[:4].upper().ljust(4, "X") if user.username else "USER") + \
            "".join(random.choices(string.digits, k=4))
        if not User.objects.filter(referral_code=candidate).exists():
            user.referral_code = candidate
            user.save(update_fields=["referral_code"])
            return candidate
