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
