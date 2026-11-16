"""
identity.platform_account — what Oaziland itself offers (its own hotels, guest houses, hostels, property listings,
venues, store and technician services) belongs to one platform account, not to a staff member's personal account.

How it works
- get_platform_account() is that account (username "oaziland"). It has no password and can't be signed into:
  DelegatedJWTAuthentication refuses any token for it except a platform session.
- An admin with the right (a full admin, or a limited admin granted PLATFORM_PERMISSION) switches into a short-lived
  platform session (1 hour, no refresh). The site then works as the platform account, so every normal create and
  manage page serves Oaziland's own offers with no separate admin screens; the token carries which admin it is.
- check_platform_request() keeps a platform session to running the business: no admin console, security, identity
  or personal settings, no buying, and only a full admin may withdraw the platform's earnings.
- Every change made in a platform session goes to the admin audit log under the admin's own name.
"""
from datetime import timedelta

from django.db import transaction
from rest_framework_simplejwt.tokens import AccessToken

PLATFORM_USERNAME = "oaziland"
PLATFORM_PHONE = "+237000000000"
PLATFORM_PERMISSION = "platform_listings"
SESSION_LIFETIME = timedelta(hours=1)
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

NEVER_ALLOWED_PREFIXES = (
    "admin/", "account/", "staff-access/", "consent/", "data-exports/", "verification-requests/", "social-accounts/",
    "my-parent-access-grants/", "my-guardian-accesses/", "my-emergency-contact/", "my-referrals/", "webhooks/", "gifts/",
    "wallet/recharge", "my-blocked-users/",
)
# Paying for something: the platform sells and hosts, it doesn't buy.
SPENDING_ACTIONS = {"pay", "pay-balance", "pay-deposit", "fund", "recharge", "convert", "boost", "approve-quote"}
PURCHASE_COLLECTIONS = ("bookings/", "marketplace-orders/", "marketplace-offers/", "reservations/", "event-bookings/", "service-requests/")
WITHDRAW_SEGMENTS = {"withdraw", "withdrawals", "payout"}


class PlatformAccountError(Exception):
    pass


@transaction.atomic
def get_platform_account():
    from .models import KYCProfile, User, VerificationStatus

    account = User.objects.filter(is_platform_account=True).first()
    if account is not None:
        return account
    account = User.objects.filter(username=PLATFORM_USERNAME).first()
    if account is None:
        account = User(username=PLATFORM_USERNAME, phone=PLATFORM_PHONE, first_name="Oaziland")
        account.set_unusable_password()
    account.is_platform_account = True
    account.verification_status = VerificationStatus.VERIFIED
    account.save()
    # Oaziland is a known business, so its own listings pass the identity check sellers and hosts need.
    KYCProfile.objects.get_or_create(user=account, defaults={
        "legal_full_name": "Oaziland", "date_of_birth": "2024-01-01", "national_id_number": "OAZILAND-PLATFORM",
        "residential_address": "Messassi, Yaoundé, Cameroon", "kyc_status": VerificationStatus.VERIFIED,
    })
    return account


def is_platform_account(user) -> bool:
    return bool(getattr(user, "is_platform_account", False))


def can_act_as_platform(user) -> bool:
    from .services import is_super_admin

    if not (user and user.is_authenticated and user.is_active) or is_platform_account(user):
        return False
    if is_super_admin(user):
        return True
    profile = getattr(user, "admin_profile", None)
    return profile is not None and PLATFORM_PERMISSION in (profile.permissions or [])


def start_platform_session(admin) -> dict:
    if not can_act_as_platform(admin):
        raise PlatformAccountError("Only admins allowed to manage Oaziland's own offers can do this.")
    account = get_platform_account()
    token = AccessToken.for_user(account)
    token.set_exp(lifetime=SESSION_LIFETIME)
    token["act_platform_admin"] = str(admin.pk)
    return {
        "access": str(token), "expires_in": int(SESSION_LIFETIME.total_seconds()),
        "account": {"id": str(account.pk), "username": account.username, "name": account.full_name or account.username},
    }


def _api_path(path: str) -> str:
    return path.split("/api/", 1)[1] if "/api/" in path else path.lstrip("/")


def check_platform_request(admin, method: str, path: str) -> str | None:
    """None when a platform session may make this request, else why not."""
    from .services import is_super_admin

    method = method.upper()
    rel = _api_path(path)
    segments = set(rel.lower().strip("/").split("/"))
    if rel.startswith("auth/"):
        return None if (method, rel) == ("GET", "auth/me/") else "Switch back to your own account for this."
    if rel.startswith(NEVER_ALLOWED_PREFIXES):
        return "This can't be done on Oaziland's own account. Switch back to your own account."
    if method in SAFE_METHODS:
        return None
    if WITHDRAW_SEGMENTS & segments:
        return None if is_super_admin(admin) else "Only a full admin can withdraw Oaziland's earnings."
    if SPENDING_ACTIONS & segments or (method == "POST" and rel in PURCHASE_COLLECTIONS):
        return "Oaziland's own account sells and hosts; it doesn't buy or pay. Use your own account."
    return None


def admin_for_session(token):
    """The admin a platform-session token belongs to, if they may still act as the platform; else None."""
    from .models import User

    admin_id = token.get("act_platform_admin")
    admin = User.objects.select_related("admin_profile").filter(pk=admin_id).first() if admin_id else None
    return admin if admin is not None and can_act_as_platform(admin) else None


def record_platform_action(request, response) -> None:
    from trust_safety.models import AuditLog

    admin = request.platform_admin
    AuditLog.objects.create(
        actor=admin, actor_username=admin.username, action=f"platform-account {request.method} {_api_path(request.path)}"[:120],
        target_type="platform_account", target_id=str(request.user.pk) if getattr(request, "user", None) else "",
        target_label="Oaziland", status_code=response.status_code,
        ip_address=request.META.get("REMOTE_ADDR") or None,
    )
