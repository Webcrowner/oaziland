"""
trust_safety.ai_flags — the queue of content the automated moderation flagged for a person to look at.

Content that scores FLAG_FOR_REVIEW or ESCALATE_ADMIN is still published (only AUTO_REMOVE blocks it), so
without this queue nobody would ever see it. Results are grouped per item. An admin either keeps the item
(the flags are marked reviewed) or removes it through the same takedown used for the Published content tab.
"""
from django.db import transaction
from django.db.models import Count, Max, Q
from django.utils import timezone

from .content_moderation import (
    ContentActionError, ContentNotFound, ContentTakedown, _load, describe_content, remove_content,
)
from .models import AIModerationResult, ModerationAction

FLAGGED_ACTIONS = (ModerationAction.FLAG_FOR_REVIEW, ModerationAction.ESCALATE_ADMIN)
STATES = ("pending", "reviewed")
STRIKE_REASON = "AI-flagged content removed"


def _existing_targets() -> Q:
    """Only results about items that still exist (a listing that failed to save leaves orphan results)."""
    from marketplace.models import MarketplaceListingBase
    from property.models import Listing

    return (
        Q(target_post__isnull=False)
        | Q(target_listing_id__in=MarketplaceListingBase.objects.values("id"))
        | Q(target_listing_id__in=Listing.objects.values("id"))
    )


def _results(state: str):
    qs = AIModerationResult.objects.filter(action__in=FLAGGED_ACTIONS, target_comment__isnull=True).filter(_existing_targets())
    return qs.filter(reviewed_at__isnull=True) if state == "pending" else qs.filter(reviewed_at__isnull=False)


def pending_flag_count() -> int:
    return flagged_groups("pending").count()


def flagged_groups(state: str = "pending"):
    """One row per flagged item, most recently flagged first (still lazy, so it can be paged)."""
    return (
        _results(state).values("target_post_id", "target_listing_id")
        .annotate(
            latest=Max("scored_at"), top_confidence=Max("confidence_score"), flags=Count("id"),
            escalated=Count("id", filter=Q(action=ModerationAction.ESCALATE_ADMIN)),
        )
        .order_by("-latest", "target_post_id", "target_listing_id")
    )


def _kind_of(group) -> tuple[str, object]:
    """Which kind of content a group is about, and its id."""
    if group["target_post_id"]:
        return ContentTakedown.ContentType.POST, group["target_post_id"]
    from marketplace.models import MarketplaceListingBase

    listing_id = group["target_listing_id"]
    if MarketplaceListingBase.objects.filter(pk=listing_id).exists():
        return ContentTakedown.ContentType.MARKETPLACE, listing_id
    return ContentTakedown.ContentType.PROPERTY, listing_id


def describe_flags(groups, state: str = "pending") -> list[dict]:
    rows = []
    for group in groups:
        content_type, content_id = _kind_of(group)
        item = _load(content_type, content_id)
        if item is None:
            continue
        details = describe_content(content_type, [item])[0]
        results = _results(state).filter(
            target_post_id=group["target_post_id"], target_listing_id=group["target_listing_id"],
        ).select_related("reviewed_by").order_by("-confidence_score")
        results = list(results)
        reviewed = next((r for r in results if r.reviewed_at), None)
        rows.append({
            **details,
            "flags": [
                {"category": r.category, "confidence": f"{r.confidence_score:.3f}", "action": r.action, "scored_at": r.scored_at}
                for r in results
            ],
            "escalated": group["escalated"] > 0,
            "flagged_at": group["latest"],
            "review": {
                "outcome": reviewed.review_outcome, "reviewed_at": reviewed.reviewed_at,
                "reviewed_by": reviewed.reviewed_by.username if reviewed.reviewed_by else "",
            } if reviewed else None,
        })
    return rows


def _mark_reviewed(content_type: str, content_id, admin, outcome: str) -> int:
    field = {"target_post_id": content_id} if content_type == ContentTakedown.ContentType.POST else {"target_listing_id": content_id}
    return AIModerationResult.objects.filter(
        action__in=FLAGGED_ACTIONS, reviewed_at__isnull=True, **field,
    ).update(reviewed_at=timezone.now(), reviewed_by=admin, review_outcome=outcome)


def _has_open_flags(content_type: str, content_id) -> bool:
    field = {"target_post_id": content_id} if content_type == ContentTakedown.ContentType.POST else {"target_listing_id": content_id}
    return AIModerationResult.objects.filter(action__in=FLAGGED_ACTIONS, reviewed_at__isnull=True, **field).exists()


def keep_flagged_content(*, content_type: str, content_id, admin) -> None:
    """The reviewer found nothing wrong: the item stays live and its flags are closed."""
    if _load(content_type, content_id) is None:
        raise ContentNotFound("That item no longer exists.")
    if not _has_open_flags(content_type, content_id):
        raise ContentActionError("This item has no open flags.")
    _mark_reviewed(content_type, content_id, admin, "KEPT")


def remove_flagged_content(*, content_type: str, content_id, reason: str, admin, issue_strike: bool = False):
    """Takes the item down (reason shown to its owner), closes its flags, and optionally gives the owner a strike."""
    if not _has_open_flags(content_type, content_id):
        raise ContentActionError("This item has no open flags.")
    with transaction.atomic():
        takedown = remove_content(content_type=content_type, content_id=content_id, reason=reason, admin=admin)
        _mark_reviewed(content_type, content_id, admin, "REMOVED")
        if issue_strike and takedown.owner is not None and not hasattr(takedown.owner, "admin_profile"):
            from .services import issue_strike_and_apply_consequences

            issue_strike_and_apply_consequences(subject=takedown.owner, reason=STRIKE_REASON, issued_by=admin)
    return takedown
