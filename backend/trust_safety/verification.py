"""
trust_safety.verification — what an admin needs in front of them to judge a verification request.

A request only stores a content type and an id for the thing being verified, which on its own says nothing.
This module resolves the subject (title, owner, page), summarises the requester (identity check, strikes,
history), and raises plain warning flags: the requester is not the owner, there is no document, the
requester has been rejected for this before, and so on. The reviewer still decides; nothing is blocked.
"""
from datetime import timedelta
from urllib.parse import urlparse

from django.db.models import Q
from django.utils import timezone

from engagement.models import VerificationRequest, VerificationRequestStatus, VerificationRequestType
from engagement.services import _is_own_upload
from identity.models import AccountStatus
from identity.services import get_user_kyc_status

STATES = ("pending", "approved", "rejected", "all")
WAITING_LONG = timedelta(hours=72)
# Verifications of these things are meaningless without a document to look at.
DOCUMENT_REQUIRED = tuple(kind for kind in VerificationRequestType.values if kind != VerificationRequestType.IDENTITY_VERIFICATION)
# Request types about the requester's own account, and the profile they must actually hold.
ROLE_PROFILES = {
    VerificationRequestType.AGENT_VERIFICATION: "agent_profile",
    VerificationRequestType.AGENCY_VERIFICATION: "agency_profile",
    VerificationRequestType.LANDLORD_VERIFICATION: "landlord_profile",
}


def _name(user) -> str:
    return (user.full_name or user.username) if user else ""


def _snippet(text: str, limit: int = 140) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "\u2026"


def verification_queryset(*, state: str = "pending", request_type: str = "", query: str = ""):
    qs = VerificationRequest.objects.select_related("requester", "reviewed_by", "requester__kyc_profile")
    if state != "all":
        qs = qs.filter(status=state.upper())
    if request_type:
        qs = qs.filter(request_type=request_type)
    for term in query.split()[:4]:
        qs = qs.filter(
            Q(requester__username__icontains=term) | Q(requester__first_name__icontains=term)
            | Q(requester__last_name__icontains=term) | Q(requester__phone__icontains=term)
            | Q(supporting_document_url__icontains=term)
        )
    return qs.order_by("submitted_at") if state == "pending" else qs.order_by("-submitted_at")


def describe_subject(content_type: str, subject_id, request_type: str = "") -> dict:
    """What is being verified: {"kind", "title", "excerpt", "owner" ({id,name,username} or None), "path", "found",
    "facts"} where facts are role details worth knowing (an agency's registration number, an agent's agency...)."""
    missing = {"kind": content_type, "title": "", "excerpt": "", "owner": None, "path": "", "found": False, "facts": {}}
    try:
        subject = _describe_subject(content_type, subject_id, missing)
        subject.setdefault("facts", {})
        if subject["found"] and content_type == "identity.User":
            subject["facts"] = _role_facts(subject_id, request_type)
        return subject
    except Exception:  # an odd or deleted subject must never hide the request itself
        return missing


def _role_facts(user_id, request_type: str) -> dict:
    from identity.models import User

    user = User.objects.select_related("agent_profile__agency__user", "agency_profile", "landlord_profile").filter(pk=user_id).first()
    if user is None:
        return {}
    if request_type == VerificationRequestType.AGENCY_VERIFICATION and hasattr(user, "agency_profile"):
        profile = user.agency_profile
        return {"registration_number": profile.registration_number, "agents": profile.agents.count(), "commission_percent": f"{profile.agency_commission_percent:.2f}"}
    if request_type == VerificationRequestType.AGENT_VERIFICATION and hasattr(user, "agent_profile"):
        profile = user.agent_profile
        return {"agency": _name(profile.agency.user) if profile.agency_id else "", "commission_percent": f"{profile.agent_commission_percent:.2f}"}
    if request_type == VerificationRequestType.LANDLORD_VERIFICATION and hasattr(user, "landlord_profile"):
        from property.models import PropertyAsset
        return {"properties": PropertyAsset.objects.filter(owner=user).count()}
    return {}


def _person(user):
    return {"id": str(user.pk), "name": _name(user), "username": user.username} if user else None


def _describe_subject(content_type: str, subject_id, missing: dict) -> dict:
    if content_type.startswith("marketplace."):
        from marketplace.models import MarketplaceListingBase
        from marketplace.services import category_models

        base = MarketplaceListingBase.objects.select_related("lister_user").filter(pk=subject_id).first()
        if base:
            category = next((name for name, model in category_models().items() if model.objects.filter(pk=subject_id).exists()), "")
            return {
                "kind": "marketplace_listing", "title": base.title, "excerpt": _snippet(base.description),
                "owner": _person(base.lister_user), "path": f"/marketplace/{category}/{base.pk}" if category else "", "found": True,
            }
    elif content_type == "student_hostels.StudentHostel":
        from student_hostels.models import StudentHostel

        hostel = StudentHostel.objects.select_related("owner", "quarter").filter(pk=subject_id).first()
        if hostel:
            return {
                "kind": "student_hostel", "title": f"Student hostel \u00b7 {hostel.quarter.name}", "excerpt": _snippet(hostel.description),
                "owner": _person(hostel.owner), "path": f"/student-hostels/{hostel.pk}", "found": True,
            }
    elif content_type == "property.GuestHouseLodge":
        from property.models import GuestHouseLodge

        house = GuestHouseLodge.objects.select_related("owner", "quarter").filter(pk=subject_id).first()
        if house:
            return {
                "kind": "guest_house", "title": f"Guest house \u00b7 {house.quarter.name}", "excerpt": _snippet(house.description),
                "owner": _person(house.owner), "path": f"/guest-houses/{house.pk}", "found": True,
            }
    elif content_type == "property.Listing":
        from property.models import Listing

        listing = Listing.objects.select_related("property_asset__quarter", "listed_by").filter(pk=subject_id).first()
        if listing:
            asset = listing.property_asset
            return {
                "kind": "property_listing", "title": f"{asset.get_type_display()} \u00b7 {asset.quarter.name}",
                "excerpt": _snippet(asset.description), "owner": _person(listing.listed_by), "path": f"/listing/{listing.pk}", "found": True,
            }
    elif content_type == "identity.User":
        from identity.models import User

        user = User.objects.filter(pk=subject_id).first()
        if user:
            return {"kind": "user", "title": _name(user), "excerpt": f"@{user.username}", "owner": _person(user), "path": f"/user/{user.pk}", "found": True}
    elif content_type == "social.Post":
        from social.models import Post

        post = Post.objects.select_related("author").filter(pk=subject_id).first()
        if post:
            has_video = post.media.filter(media_type="VIDEO").exists()
            return {
                "kind": "video" if has_video else "post", "title": _snippet(post.caption, 80) or "(no caption)", "excerpt": "",
                "owner": _person(post.author), "path": f"/videos/{post.pk}" if has_video else "", "found": True,
            }
    return missing


def _requester_summary(user, history: dict) -> dict:
    return {
        "id": str(user.pk), "name": _name(user), "username": user.username, "phone": user.phone, "email": user.email,
        "kyc_status": get_user_kyc_status(user), "strikes": user.warnings.count(), "account_status": user.account_status,
        "joined_at": user.date_joined, "requests_total": history["total"], "requests_approved": history["approved"],
        "requests_rejected": history["rejected"],
    }


def _history(user) -> dict:
    rows = VerificationRequest.objects.filter(requester=user)
    return {
        "total": rows.count(),
        "approved": rows.filter(status=VerificationRequestStatus.APPROVED).count(),
        "rejected": rows.filter(status=VerificationRequestStatus.REJECTED).count(),
    }


def _flags(verification_request, requester: dict, subject: dict, prior_rejections: int) -> list[str]:
    flags = []
    if not subject["found"]:
        flags.append("subject_missing")
    elif subject["owner"] and subject["owner"]["id"] != str(verification_request.requester_id):
        flags.append("not_owner")
    required_profile = ROLE_PROFILES.get(verification_request.request_type)
    if required_profile and not hasattr(verification_request.requester, required_profile):
        flags.append("role_missing")
    if verification_request.request_type in DOCUMENT_REQUIRED and not verification_request.supporting_document_url:
        flags.append("no_document")
    document = verification_request.supporting_document_url
    if document and not document.lower().startswith("https://") and not _is_own_upload(document):
        flags.append("insecure_document")
    if requester["kyc_status"] != "VERIFIED":
        flags.append("id_not_verified")
    if requester["strikes"] > 0:
        flags.append("has_strikes")
    if requester["account_status"] != AccountStatus.ACTIVE:
        flags.append("account_restricted")
    if prior_rejections:
        flags.append("previously_rejected")
    if verification_request.status == VerificationRequestStatus.PENDING and timezone.now() - verification_request.submitted_at > WAITING_LONG:
        flags.append("waiting_long")
    return flags


def describe_requests(requests) -> list[dict]:
    """Admin-facing rows for a page of VerificationRequests."""
    rows = []
    histories = {}
    for item in requests:
        requester = item.requester
        if requester.pk not in histories:
            histories[requester.pk] = _history(requester)
        requester_info = _requester_summary(requester, histories[requester.pk])
        subject = describe_subject(item.subject_content_type, item.subject_id, item.request_type)
        prior_rejections = VerificationRequest.objects.filter(
            requester=requester, subject_content_type=item.subject_content_type, subject_id=item.subject_id,
            request_type=item.request_type, status=VerificationRequestStatus.REJECTED,
        ).exclude(pk=item.pk).count()
        document = item.supporting_document_url
        rows.append({
            "id": str(item.pk), "request_type": item.request_type, "status": item.status, "submitted_at": item.submitted_at,
            "reviewed_at": item.reviewed_at, "reviewed_by": item.reviewed_by.username if item.reviewed_by else "",
            "rejection_reason": item.rejection_reason,
            "document": {"url": document, "host": urlparse(document).hostname or ""} if document else None,
            "requester": requester_info, "subject": subject,
            "flags": _flags(item, requester_info, subject, prior_rejections),
        })
    return rows
