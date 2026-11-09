"""
identity.staff_access — owners letting staff work on their account, with limits.

How it works
- The owner invites an existing account (by username or phone) and ticks what that person may do
  (StaffPermission). The staff member accepts. Either side can end it at any time; it can also expire.
- The staff member keeps signing in as themselves. To work for the owner they ask for a short-lived "staff
  session" token (1 hour, no refresh): it acts as the owner, but carries who the staff member is.
- DelegatedJWTAuthentication checks every request made with such a token against check_staff_request():
  money, security, ID checks, account settings and staff management are never allowed; other changes need the
  matching permission; reading elsewhere is allowed. Because DRF authenticates every API request, no endpoint
  can be missed — anything not listed below is read-only for staff.
- StaffActivityMiddleware records every change made in a staff session, for the owner to review.
"""
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import exceptions
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import AccessToken

from .models import StaffAccess, StaffAccessStatus, StaffActionLog, StaffPermission

SESSION_LIFETIME = timedelta(hours=1)
MAX_OPEN_GRANTS = 10
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

# Always fine in a staff session, whatever was granted.
ALWAYS_ALLOWED = (
    ("GET", "auth/me/"), ("GET", "staff-access/session/"), ("*", "my-notifications/"), ("*", "presence/"),
)
# Never allowed in a staff session (any method): money, security, identity, account and staff management.
NEVER_ALLOWED_PREFIXES = (
    "admin/", "auth/", "account/", "staff-access/", "wallet/withdraw", "wallet/recharge", "gifts/", "data-exports/",
    "consent/", "my-creator-premium/", "ad-campaigns/", "my-ad-campaigns/", "social-accounts/", "my-parent-access-grants/",
    "my-guardian-accesses/", "my-emergency-contact/", "my-blocked-users/", "verification-requests/", "my-driver-profile/",
    "my-vehicles/", "rides/", "my-technician-", "my-referrals/", "my-presence-settings/", "my-agency-dashboard/add-agent",
    "my-agency-dashboard/remove-agent", "data/", "webhooks/",
)
# Actions that move money or commit the owner to pay, matched as whole path segments.
NEVER_ALLOWED_ACTIONS = {
    "pay", "pay-balance", "pay-deposit", "fund", "withdraw", "recharge", "payout", "convert", "confirm", "release",
    "approve-quote", "block", "boost",
}
# Creating one of these spends the owner's money (it starts a payment), so staff can manage them but not start them.
PURCHASE_COLLECTIONS = ("bookings/", "marketplace-orders/", "marketplace-offers/", "reservations/", "event-bookings/", "service-requests/")

SCOPES = {
    StaffPermission.LISTINGS: (
        "listings/", "my-listings/", "houses/", "lands/", "shops/", "stores/", "warehouses/", "businesses/", "cars/", "goods/",
        "hotels/", "venues/", "guest-houses/", "student-hostels/", "hostel-rooms/", "my-landlord-portfolio/", "wanted-listings/",
        "media/upload/",
    ),
    StaffPermission.MESSAGES: ("conversations/", "disputes/"),
    StaffPermission.BOOKINGS: (
        "bookings/", "reservations/", "event-bookings/", "marketplace-orders/", "marketplace-offers/", "service-requests/", "tenant-screenings/",
        "leases/", "maintenance-requests/", "project-cases/", "facility-contracts/",
    ),
    StaffPermission.POSTS: ("posts/", "comments/", "flyers/", "my-agent-profile/", "media/upload/"),
    StaffPermission.REVIEWS: ("reviews/", "ratings/", "my-ratings/"),
    StaffPermission.EARNINGS_VIEW: ("wallet/", "my-earnings-report/", "my-agent-dashboard/", "my-agency-dashboard/"),
}
READ_ONLY_SCOPES = {StaffPermission.REVIEWS, StaffPermission.EARNINGS_VIEW}


class StaffAccessError(Exception):
    pass


def _api_path(path: str) -> str:
    return path.split("/api/", 1)[1] if "/api/" in path else path.lstrip("/")


def check_staff_request(grant: StaffAccess, method: str, path: str) -> str | None:
    """None when a staff session may make this request, else why not."""
    method = method.upper()
    rel = _api_path(path)
    for allowed_method, prefix in ALWAYS_ALLOWED:
        if rel.startswith(prefix) and allowed_method in ("*", method):
            return None
    segments = rel.lower().strip("/").split("/")
    if rel.startswith(NEVER_ALLOWED_PREFIXES) or NEVER_ALLOWED_ACTIONS.intersection(segments):
        return "Staff can't do this on someone else's account. Ask the account owner."
    if method == "POST" and rel in PURCHASE_COLLECTIONS:
        return "Staff can't make purchases or bookings that charge the owner. Ask the account owner."
    granted = set(grant.permissions or [])
    matching = [scope for scope, prefixes in SCOPES.items() if rel.startswith(prefixes)]
    if matching:
        usable = [scope for scope in matching if scope in granted]
        if not usable:
            return "Your staff access doesn't include this. Ask the account owner to add it."
        if method not in SAFE_METHODS and all(scope in READ_ONLY_SCOPES for scope in usable):
            return "Your staff access lets you see this, not change it."
        return None
    if method in SAFE_METHODS:
        return None
    return "Staff can't do this on someone else's account. Ask the account owner."


class DelegatedJWTAuthentication(JWTAuthentication):
    """The normal JWT login check, plus the staff-session rules for tokens issued by start_staff_session()."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result
        grant_id = token.get("act_grant")
        if not grant_id:
            return result
        grant = StaffAccess.objects.select_related("staff", "owner").filter(pk=grant_id, owner=user, staff_id=token.get("act_staff")).first()
        if grant is None or not grant.is_usable():
            raise exceptions.AuthenticationFailed("This staff session has ended. Switch back to your own account.", code="staff_session_ended")
        problem = check_staff_request(grant, request.method, request.path)
        if problem:
            raise exceptions.PermissionDenied(problem)
        request._request.staff_grant = grant
        user.acting_staff = grant.staff
        return user, token


class StaffActivityMiddleware:
    """Writes one StaffActionLog row for every change made in a staff session (whatever the outcome)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        grant = getattr(request, "staff_grant", None)
        if grant is not None and request.method not in SAFE_METHODS:
            try:
                StaffActionLog.objects.create(access=grant, method=request.method, path=request.path[:255], status_code=response.status_code)
            except Exception:  # never let logging break the response
                pass
        return response


# ---------------------------------------------------------------------------
# The workflow
# ---------------------------------------------------------------------------
def _notify(user, title: str, message: str, grant) -> None:
    from notifications.services import notify

    notify(recipient=user, notification_type="STAFF_ACCESS", title=title, message=message, related_reference=str(grant.pk))


def _name(user) -> str:
    return user.full_name or user.username


def _clean_permissions(values) -> list:
    values = list(dict.fromkeys(values or []))
    unknown = [value for value in values if value not in StaffPermission.values]
    if unknown:
        raise StaffAccessError(f"Unknown permission: {unknown[0]}.")
    if not values:
        raise StaffAccessError("Choose at least one thing this person may do.")
    return values


def _clean_expiry(value):
    if value in (None, ""):
        return None
    from datetime import date

    try:
        expiry = date.fromisoformat(str(value))
    except ValueError:
        raise StaffAccessError("The end date isn't a valid date.")
    if expiry < timezone.localdate():
        raise StaffAccessError("The end date must be today or later.")
    return expiry


def can_have_staff(user) -> bool:
    profile = getattr(user, "kyc_profile", None)
    return bool(profile and profile.kyc_status == "VERIFIED")


def invite_staff(*, owner, identifier: str, permissions, title: str = "", expires_on=None) -> StaffAccess:
    from .models import User

    if not can_have_staff(owner):
        raise StaffAccessError("Verify your identity (KYC) before giving anyone access to your account.")
    identifier = (identifier or "").strip()
    staff = User.objects.filter(Q(username__iexact=identifier) | Q(phone=identifier), is_active=True, deleted_at__isnull=True).first()
    if staff is None:
        raise StaffAccessError("No Oaziland account has that username or phone number. Ask them to sign up first.")
    if staff.pk == owner.pk:
        raise StaffAccessError("You can't add yourself as staff.")
    title = (title or "").strip()
    if len(title) > 80:
        raise StaffAccessError("The role name must be 80 characters or fewer.")
    permissions = _clean_permissions(permissions)
    expiry = _clean_expiry(expires_on)
    open_grants = StaffAccess.objects.filter(owner=owner, status__in=[StaffAccessStatus.PENDING, StaffAccessStatus.ACTIVE])
    if open_grants.filter(staff=staff).exists():
        raise StaffAccessError("This person already has, or has been invited to, access to your account.")
    if open_grants.count() >= MAX_OPEN_GRANTS:
        raise StaffAccessError(f"You can have at most {MAX_OPEN_GRANTS} staff members.")
    grant = StaffAccess.objects.create(owner=owner, staff=staff, title=title, permissions=permissions, expires_on=expiry)
    _notify(staff, "You've been invited to help manage an account",
            f"{_name(owner)} invited you to help manage their Oaziland account" + (f" as {title}" if title else "") + ". Open Staff & team access to accept.", grant)
    return grant


def update_staff(*, grant: StaffAccess, owner, permissions=None, title=None, expires_on="unchanged") -> StaffAccess:
    _require(grant.owner_id == owner.pk, "Only the account owner can change this.")
    _require(grant.status in (StaffAccessStatus.PENDING, StaffAccessStatus.ACTIVE), "This access has ended.")
    fields = []
    if permissions is not None:
        grant.permissions = _clean_permissions(permissions)
        fields.append("permissions")
    if title is not None:
        title = title.strip()
        _require(len(title) <= 80, "The role name must be 80 characters or fewer.")
        grant.title = title
        fields.append("title")
    if expires_on != "unchanged":
        grant.expires_on = _clean_expiry(expires_on)
        fields.append("expires_on")
    if fields:
        grant.save(update_fields=fields)
        _notify(grant.staff, "Your staff access changed", f"{_name(owner)} changed what you can do on their account.", grant)
    return grant


def respond_to_invitation(*, grant: StaffAccess, staff, accept: bool) -> StaffAccess:
    _require(grant.staff_id == staff.pk, "This invitation isn't for you.")
    _require(grant.status == StaffAccessStatus.PENDING, "This invitation is no longer open.")
    now = timezone.now()
    if accept:
        grant.status, grant.accepted_at = StaffAccessStatus.ACTIVE, now
        grant.save(update_fields=["status", "accepted_at"])
        _notify(grant.owner, "Staff invitation accepted", f"{_name(staff)} can now help manage your account.", grant)
    else:
        grant.status, grant.ended_at, grant.ended_by = StaffAccessStatus.DECLINED, now, staff
        grant.save(update_fields=["status", "ended_at", "ended_by"])
        _notify(grant.owner, "Staff invitation declined", f"{_name(staff)} declined your invitation.", grant)
    return grant


def end_staff_access(*, grant: StaffAccess, by) -> StaffAccess:
    """The owner removes a staff member, or a staff member leaves. Any open staff session stops at once."""
    _require(by.pk in (grant.owner_id, grant.staff_id), "You aren't part of this access.")
    _require(grant.status in (StaffAccessStatus.PENDING, StaffAccessStatus.ACTIVE), "This access has already ended.")
    grant.status, grant.ended_at, grant.ended_by = StaffAccessStatus.REVOKED, timezone.now(), by
    grant.save(update_fields=["status", "ended_at", "ended_by"])
    if by.pk == grant.owner_id:
        _notify(grant.staff, "Your staff access was removed", f"{_name(grant.owner)} removed your access to their account.", grant)
    else:
        _notify(grant.owner, "A staff member left", f"{_name(grant.staff)} no longer helps manage your account.", grant)
    return grant


def start_staff_session(*, grant: StaffAccess, staff) -> dict:
    """A short-lived token that acts as the owner within the granted permissions."""
    _require(grant.staff_id == staff.pk, "This access isn't yours.")
    _require(grant.is_usable(), "This access isn't active.")
    token = AccessToken.for_user(grant.owner)
    lifetime = SESSION_LIFETIME
    if grant.expires_on is not None:
        from datetime import datetime, time

        end_of_access = timezone.make_aware(datetime.combine(grant.expires_on, time.max))
        lifetime = min(lifetime, end_of_access - timezone.now())
    token.set_exp(lifetime=lifetime)
    token["act_grant"] = str(grant.pk)
    token["act_staff"] = str(staff.pk)
    return {"access": str(token), "expires_in": int(lifetime.total_seconds()), **grant_payload(grant, staff)}


def _require(condition, message: str) -> None:
    if not condition:
        raise StaffAccessError(message)


def _person(user) -> dict:
    return {"id": str(user.pk), "username": user.username, "name": _name(user), "profile_image_url": user.profile_image_url}


def grant_payload(grant: StaffAccess, viewer) -> dict:
    return {
        "id": str(grant.pk), "owner": _person(grant.owner), "staff": _person(grant.staff), "title": grant.title,
        "permissions": grant.permissions, "status": grant.status, "expires_on": grant.expires_on,
        "invited_at": grant.invited_at, "accepted_at": grant.accepted_at, "ended_at": grant.ended_at,
        "usable": grant.is_usable(), "i_am_owner": grant.owner_id == viewer.pk,
    }


def my_staff_overview(user) -> dict:
    with transaction.atomic():
        as_owner = StaffAccess.objects.filter(owner=user).select_related("owner", "staff").order_by("-invited_at")[:50]
        as_staff = StaffAccess.objects.filter(staff=user).exclude(status=StaffAccessStatus.DECLINED).select_related("owner", "staff").order_by("-invited_at")[:50]
    return {
        "can_have_staff": can_have_staff(user),
        "my_staff": [grant_payload(g, user) for g in as_owner],
        "i_help": [grant_payload(g, user) for g in as_staff],
    }


def activity(grant: StaffAccess, owner, limit: int = 100) -> list[dict]:
    _require(grant.owner_id == owner.pk, "Only the account owner can see this.")
    return [
        {"method": row.method, "path": row.path, "status_code": row.status_code, "at": row.created_at}
        for row in grant.actions.all()[:limit]
    ]
