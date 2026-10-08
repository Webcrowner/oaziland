"""
oaziland.permissions — shared Role-Based Access Control classes, per
the Pre-Development Design Package's RBAC matrix. Kept in one shared
module (not duplicated per app) so the actual permission RULES are
defined once and every app's API applies them identically.
"""
from rest_framework import permissions


class IsAdminRole(permissions.BasePermission):
    """Only a User with an AdminProfile — e.g. approving a listing,
    reviewing a moderation queue, resolving a dispute."""
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and hasattr(request.user, "admin_profile"))


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Anyone can read; only the object's own listed_by/owner/requester
    can modify it. WHY a shared class checks several possible field
    names: different models use different field names for 'who this
    belongs to' (listed_by on Listing, owner on PropertyAsset, requester
    on Booking) — this avoids writing near-identical permission classes
    per model."""
    owner_fields = ("listed_by", "owner", "requester", "created_by", "reported_by", "posted_by")

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        for field in self.owner_fields:
            if hasattr(obj, field):
                return getattr(obj, field) == request.user
        return False


class IsAgencyMemberForOwnAgencyData(permissions.BasePermission):
    """An Agency's own agents can see the agency's roster/commission
    data; nobody else can — 'an Agency only sees its own agents' data',
    per the RBAC matrix's explicit rule."""
    def has_object_permission(self, request, view, obj):
        user = request.user
        if not hasattr(user, "agent_profile"):
            return False
        agency = getattr(obj, "agency", None) or getattr(obj, "manager", None)
        return agency is not None and user.agent_profile.agency_id == getattr(agency, "id", agency)


class IsKycVerified(permissions.BasePermission):
    """Gates sensitive actions (making a booking, publishing a listing)
    behind KYC — identity verification must at least be SUBMITTED
    (not necessarily approved yet). WHY MFA is no longer part of this
    check: MFA is now a purely OPTIONAL security feature a user can
    turn on for themselves from their account/dashboard settings
    (/mfa-setup), not a mandatory gate blocking sensitive actions — a
    deliberate platform-wide policy change (previously MFA+KYC were
    both required here). Sets a specific, actionable self.message
    (rather than DRF's generic 403 text) so the frontend can tell a
    customer EXACTLY what's missing, instead of a dead-end "permission
    denied" at the exact moment they're trying to convert (list
    something or check out)."""
    def has_permission(self, request, view):
        from identity.services import user_has_submitted_kyc
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if not user_has_submitted_kyc(user):
            self.message = "Please complete identity verification (KYC) before continuing."
            return False
        return True


# Backward-compatible alias — every other app still imports this exact
# name; keeping it means those 8+ files don't each need a rename too.
IsVerifiedAndMfaEnabled = IsKycVerified
