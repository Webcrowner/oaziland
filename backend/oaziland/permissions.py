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


class IsVerifiedAndMfaEnabled(permissions.BasePermission):
    """Gates sensitive actions (listing a property, making a payment)
    behind the same MFA/KYC rules already enforced at the service layer
    (identity.services) — this is the API-layer mirror of that
    enforcement, so a request never reaches the service layer at all if
    it would just be rejected there."""
    def has_permission(self, request, view):
        from identity.services import user_has_verified_mfa, user_has_submitted_kyc
        user = request.user
        return bool(user and user.is_authenticated and user_has_verified_mfa(user) and user_has_submitted_kyc(user))
