"""
trust_safety.content_moderation — lets an admin browse what is published on the platform and pull an item down.

Three kinds of content are covered: property listings, marketplace listings (every category) and posts
(including videos). Taking something down hides it from the public through the status field each kind already
uses, keeps the reason in a ContentTakedown row, and tells the owner. Restoring reverses it.
"""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import ContentTakedown

TYPES = tuple(value for value, _ in ContentTakedown.ContentType.choices)
STATES = ("live", "removed", "all")
MAX_REASON_LENGTH = 500


class ContentActionError(Exception):
    pass


class ContentNotFound(ContentActionError):
    pass


def _name(user) -> str:
    return (user.full_name or user.username) if user else ""


def _snippet(text: str, limit: int = 120) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "\u2026"


def _active_takedown_ids(content_type: str):
    return ContentTakedown.objects.filter(content_type=content_type, restored_at__isnull=True).values("content_id")


def _user_terms(prefix: str, term: str) -> Q:
    return (
        Q(**{f"{prefix}__username__icontains": term}) | Q(**{f"{prefix}__first_name__icontains": term})
        | Q(**{f"{prefix}__last_name__icontains": term})
    )


def content_queryset(content_type: str, state: str = "live", query: str = ""):
    """The still-lazy, newest-first queryset behind the admin content browser."""
    terms = query.split()[:4]
    if content_type == ContentTakedown.ContentType.PROPERTY:
        from property.models import Listing, ListingStatus

        qs = Listing.objects.select_related("property_asset__quarter", "listed_by")
        live = Q(status__in=[ListingStatus.PUBLISHED, ListingStatus.UNDER_OFFER])
        removed = Q(status=ListingStatus.REJECTED, id__in=_active_takedown_ids(content_type))
        for term in terms:
            qs = qs.filter(
                Q(property_asset__description__icontains=term) | Q(property_asset__quarter__name__icontains=term)
                | Q(property_asset__type__icontains=term) | _user_terms("listed_by", term)
            )
    elif content_type == ContentTakedown.ContentType.MARKETPLACE:
        from marketplace.models import MarketplaceListingBase

        qs = MarketplaceListingBase.objects.select_related("lister_user", "quarter")
        live = Q(removed_by_moderation=False)
        removed = Q(removed_by_moderation=True)
        for term in terms:
            qs = qs.filter(
                Q(title__icontains=term) | Q(description__icontains=term) | Q(quarter__name__icontains=term)
                | _user_terms("lister_user", term)
            )
    elif content_type == ContentTakedown.ContentType.POST:
        from social.models import ContentStatus, Post

        qs = Post.objects.select_related("author").prefetch_related("media")
        live = Q(status=ContentStatus.PUBLISHED)
        removed = Q(status=ContentStatus.CLOSED, id__in=_active_takedown_ids(content_type))
        for term in terms:
            qs = qs.filter(Q(caption__icontains=term) | _user_terms("author", term))
    else:
        raise ContentActionError("Unknown content type.")

    if state == "live":
        qs = qs.filter(live)
    elif state == "removed":
        qs = qs.filter(removed)
    else:
        qs = qs.filter(live | removed)
    return qs.order_by("-created_at")


def _marketplace_categories(ids) -> dict:
    from marketplace.services import category_models

    found = {}
    for category, model in category_models().items():
        for pk in model.objects.filter(pk__in=ids).values_list("pk", flat=True):
            found[pk] = category
    return found


def describe_content(content_type: str, items) -> list[dict]:
    """Admin-facing rows for a page of items from content_queryset."""
    items = list(items)
    ids = [item.pk for item in items]
    takedowns = {
        row.content_id: row
        for row in ContentTakedown.objects.filter(content_type=content_type, content_id__in=ids, restored_at__isnull=True)
        .select_related("removed_by")
    }
    categories = _marketplace_categories(ids) if content_type == ContentTakedown.ContentType.MARKETPLACE else {}

    rows = []
    for item in items:
        if content_type == ContentTakedown.ContentType.PROPERTY:
            asset = item.property_asset
            owner = item.listed_by
            title = f"{asset.get_type_display()} \u00b7 {asset.quarter.name}"
            row = {
                "status": item.status, "kind": item.listing_type, "price_xaf": f"{item.price_xaf:.2f}",
                "excerpt": _snippet(asset.description), "path": f"/listing/{item.pk}",
                "removed": item.status == "REJECTED" and item.pk in takedowns,
            }
        elif content_type == ContentTakedown.ContentType.MARKETPLACE:
            owner, title = item.lister_user, item.title
            category = categories.get(item.pk, "")
            row = {
                "status": item.availability_status, "kind": category, "price_xaf": f"{item.price_xaf:.2f}",
                "excerpt": _snippet(item.description), "path": f"/marketplace/{category}/{item.pk}" if category else "",
                "removed": item.removed_by_moderation,
            }
        else:
            owner = item.author
            has_video = any(media.media_type == "VIDEO" for media in item.media.all())
            title = _snippet(item.caption, 80) or "(no caption)"
            row = {
                "status": item.status, "kind": "video" if has_video else item.post_type.lower(), "price_xaf": None,
                "excerpt": "", "path": f"/videos/{item.pk}" if has_video else "",
                "removed": item.status == "CLOSED" and item.pk in takedowns,
            }
        takedown = takedowns.get(item.pk)
        rows.append({
            "type": content_type, "id": str(item.pk), "title": title, "owner_id": str(owner.pk),
            "owner_name": _name(owner), "owner_username": owner.username, "created_at": item.created_at,
            "takedown": {
                "reason": takedown.reason, "removed_at": takedown.removed_at,
                "removed_by": takedown.removed_by.username if takedown.removed_by else "",
            } if takedown else None,
            **row,
        })
    return rows


def _load(content_type: str, content_id):
    if content_type == ContentTakedown.ContentType.PROPERTY:
        from property.models import Listing
        return Listing.objects.select_related("property_asset__quarter", "listed_by").filter(pk=content_id).first()
    if content_type == ContentTakedown.ContentType.MARKETPLACE:
        from marketplace.models import MarketplaceListingBase
        return MarketplaceListingBase.objects.select_related("lister_user").filter(pk=content_id).first()
    if content_type == ContentTakedown.ContentType.POST:
        from social.models import Post
        return Post.objects.select_related("author").filter(pk=content_id).first()
    raise ContentActionError("Unknown content type.")


def _owner_and_title(content_type: str, item):
    if content_type == ContentTakedown.ContentType.PROPERTY:
        asset = item.property_asset
        return item.listed_by, f"{asset.get_type_display()} in {asset.quarter.name}"
    if content_type == ContentTakedown.ContentType.MARKETPLACE:
        return item.lister_user, item.title
    return item.author, _snippet(item.caption, 80) or "your post"


def _notify_owner(owner, *, title: str, message: str, reference) -> None:
    from notifications.services import notify

    notify(
        recipient=owner, notification_type="CONTENT_MODERATION", channel="IN_APP",
        title=title, message=message, related_reference=str(reference),
    )


def remove_content(*, content_type: str, content_id, reason: str, admin) -> ContentTakedown:
    """Takes a live item off the platform and tells its owner why."""
    reason = (reason or "").strip()
    if not reason:
        raise ContentActionError("A reason is required to remove content.")
    if len(reason) > MAX_REASON_LENGTH:
        raise ContentActionError("The reason must be 500 characters or fewer.")

    with transaction.atomic():
        item = _load(content_type, content_id)
        if item is None:
            raise ContentNotFound("That item no longer exists.")
        owner, title = _owner_and_title(content_type, item)

        if content_type == ContentTakedown.ContentType.PROPERTY:
            from property.models import ListingStatus
            if item.status not in (ListingStatus.PUBLISHED, ListingStatus.UNDER_OFFER):
                raise ContentActionError("This item is not published, so there is nothing to remove.")
            previous = item.status
            item.status = ListingStatus.REJECTED
            item.save(update_fields=["status"])
        elif content_type == ContentTakedown.ContentType.MARKETPLACE:
            from marketplace.models import AvailabilityStatus
            if item.removed_by_moderation:
                raise ContentActionError("This item has already been removed.")
            previous = item.availability_status
            item.removed_by_moderation = True
            item.availability_status = AvailabilityStatus.UNAVAILABLE
            item.save(update_fields=["removed_by_moderation", "availability_status"])
        else:
            from social.models import ContentStatus
            if item.status != ContentStatus.PUBLISHED:
                raise ContentActionError("This item is not published, so there is nothing to remove.")
            previous = item.status
            item.status = ContentStatus.CLOSED
            item.save(update_fields=["status"])

        # A listing an admin reopened through the listing's own status endpoint leaves its old record open.
        ContentTakedown.objects.filter(content_type=content_type, content_id=item.pk, restored_at__isnull=True).update(
            restored_at=timezone.now(),
        )
        takedown = ContentTakedown.objects.create(
            content_type=content_type, content_id=item.pk, title=title[:200], owner=owner,
            reason=reason, previous_status=previous, removed_by=admin,
        )
        _notify_owner(
            owner, title="Your content was removed",
            message=f"\u201c{title}\u201d was removed by Oaziland moderators. Reason: {reason}", reference=item.pk,
        )
    return takedown


def restore_content(*, content_type: str, content_id, admin) -> ContentTakedown | None:
    """Puts a removed item back as it was and tells its owner. Returns the closed takedown record, if there was one."""
    with transaction.atomic():
        item = _load(content_type, content_id)
        if item is None:
            raise ContentNotFound("That item no longer exists.")
        owner, title = _owner_and_title(content_type, item)
        takedown = ContentTakedown.objects.filter(
            content_type=content_type, content_id=item.pk, restored_at__isnull=True,
        ).first()

        if content_type == ContentTakedown.ContentType.PROPERTY:
            from property.models import ListingStatus
            if item.status != ListingStatus.REJECTED or takedown is None:
                raise ContentActionError("This item was not removed by a moderator.")
            item.status = takedown.previous_status or ListingStatus.PUBLISHED
            item.save(update_fields=["status"])
        elif content_type == ContentTakedown.ContentType.MARKETPLACE:
            from marketplace.models import AvailabilityStatus
            if not item.removed_by_moderation:
                raise ContentActionError("This item was not removed by a moderator.")
            item.removed_by_moderation = False
            item.availability_status = (takedown.previous_status if takedown else "") or AvailabilityStatus.AVAILABLE
            item.save(update_fields=["removed_by_moderation", "availability_status"])
        else:
            from social.models import ContentStatus
            if item.status != ContentStatus.CLOSED or takedown is None:
                raise ContentActionError("This item was not removed by a moderator.")
            item.status = ContentStatus.PUBLISHED
            item.save(update_fields=["status"])

        if takedown is not None:
            takedown.restored_by = admin
            takedown.restored_at = timezone.now()
            takedown.save(update_fields=["restored_by", "restored_at"])
        _notify_owner(
            owner, title="Your content is back online",
            message=f"\u201c{title}\u201d was reviewed again and is visible on Oaziland once more.", reference=item.pk,
        )
    return takedown
