"""
How the marketplace keeps buyers and sellers engaged, the way Jiji, Leboncoin and Facebook Marketplace do:
listings expire unless renewed, sellers see views/saves/chats per listing, buyers get alerts for saved searches and
price drops on items they saved, and every listing shows a seller trust card.
"""
from datetime import timedelta
from decimal import Decimal

LISTING_LIFETIME_DAYS = 60
EXPIRY_REMINDER_DAYS = 3
# Reply rate and time are only shown once there are enough conversations to mean something.
REPLY_STATS_WINDOW_DAYS = 90
REPLY_STATS_MIN_CONVERSATIONS = 3


def expiry_cutoff(now=None):
    """Listings renewed before this moment have expired."""
    from django.utils import timezone
    return (now or timezone.now()) - timedelta(days=LISTING_LIFETIME_DAYS)


def expires_at(listing):
    return listing.renewed_at + timedelta(days=LISTING_LIFETIME_DAYS)


def is_expired(listing, now=None) -> bool:
    return listing.renewed_at < expiry_cutoff(now)


def renew_listing(listing):
    from django.utils import timezone
    from .models import MarketplaceListingBase
    now = timezone.now()
    MarketplaceListingBase.objects.filter(pk=listing.pk).update(renewed_at=now, expiry_reminded_at=None)
    listing.renewed_at, listing.expiry_reminded_at = now, None
    return listing


def record_view(listing, request) -> bool:
    """Counts a detail-page view by anyone but the lister, once per viewer (account, or address when signed out)
    per day, so refreshing the page doesn't inflate the number."""
    from django.core.cache import cache
    from django.db.models import F
    from .models import MarketplaceListingBase
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated:
        if user.id == listing.lister_user_id:
            return False
        viewer = f"u{user.id}"
    else:
        viewer = "a" + (request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip() or request.META.get("REMOTE_ADDR", ""))
    try:
        first_today = cache.add(f"mkt-view:{listing.pk}:{viewer}", 1, timeout=24 * 3600)
    except Exception:  # A cache outage must never break the page; the view is counted anyway.
        first_today = True
    if first_today:
        MarketplaceListingBase.objects.filter(pk=listing.pk).update(view_count=F("view_count") + 1)
    return first_today


def listing_stats(listing_ids) -> dict:
    """{listing id: {"views", "saves", "chats"}} for the lister's own dashboard."""
    from django.db.models import Count
    from social.models import Favorite, Message
    from .models import MarketplaceListingBase
    ids = list(listing_ids)
    stats = {str(pk): {"views": views, "saves": 0, "chats": 0}
             for pk, views in MarketplaceListingBase.objects.filter(pk__in=ids).values_list("pk", "view_count")}
    for row in Favorite.objects.filter(listing_id__in=ids).values("listing_id").annotate(n=Count("id")):
        stats[str(row["listing_id"])]["saves"] = row["n"]
    chats = (
        Message.objects.filter(marketplace_listing_id__in=ids).values("marketplace_listing_id")
        .annotate(n=Count("conversation", distinct=True))
    )
    for row in chats:
        stats[str(row["marketplace_listing_id"])]["chats"] = row["n"]
    return stats


def _reply_stats(user, now):
    """Share of conversations started by someone else in the last REPLY_STATS_WINDOW_DAYS that the seller answered,
    and the median time to their first answer."""
    from social.models import Message
    since = now - timedelta(days=REPLY_STATS_WINDOW_DAYS)
    rows = (
        Message.objects.filter(conversation__participants=user, folder="SENT", sent_at__gte=since)
        .order_by("conversation_id", "sent_at").values_list("conversation_id", "sender_id", "sent_at")
    )
    first_in, first_reply = {}, {}
    for conversation_id, sender_id, sent_at in rows:
        if sender_id != user.id:
            first_in.setdefault(conversation_id, sent_at)
        elif conversation_id in first_in:
            first_reply.setdefault(conversation_id, sent_at)
    if len(first_in) < REPLY_STATS_MIN_CONVERSATIONS:
        return None, None
    waits = sorted((first_reply[c] - first_in[c]).total_seconds() for c in first_reply)
    rate = round(100 * len(first_reply) / len(first_in))
    median_hours = round(waits[len(waits) // 2] / 3600, 1) if waits else None
    return rate, median_hours


def seller_summary(user, now=None) -> dict:
    """The trust card shown next to every listing: who the seller is and how they deal with buyers."""
    from django.db.models import Avg, Count
    from django.utils import timezone
    from identity.models import VerificationStatus
    from .models import MarketplaceListingBase, MarketplaceOrder, MarketplaceOrderStatus, AvailabilityStatus
    now = now or timezone.now()
    kyc = getattr(user, "kyc_profile", None)
    ratings = user.ratings_received.aggregate(avg=Avg("score"), count=Count("id"))
    reply_rate, reply_hours = _reply_stats(user, now)
    presence = getattr(user, "presence", None)
    return {
        "id": str(user.id),
        "name": user.full_name or user.username,
        "member_since": user.date_joined.date().isoformat(),
        "id_verified": bool(kyc and kyc.kyc_status == VerificationStatus.VERIFIED),
        "rating_avg": round(float(ratings["avg"]), 1) if ratings["avg"] is not None else None,
        "rating_count": ratings["count"],
        "items_sold": MarketplaceOrder.objects.filter(listing__lister_user=user, status=MarketplaceOrderStatus.COMPLETED).count(),
        "active_listings": MarketplaceListingBase.objects.filter(
            lister_user=user, availability_status=AvailabilityStatus.AVAILABLE, removed_by_moderation=False,
            renewed_at__gte=expiry_cutoff(now),
        ).count(),
        "reply_rate_pct": reply_rate,
        "reply_time_hours": reply_hours,
        "last_seen_at": getattr(presence, "last_seen_at", None),
    }


def notify_saved_searches(listing, category: str) -> int:
    """Tells everyone whose saved marketplace search matches a newly posted listing. Matching runs the listing
    through the exact same filters as the browse page, so an alert never disagrees with a search."""
    from django.utils import timezone
    from rest_framework.exceptions import ValidationError
    from discovery.models import SavedSearch
    from notifications.services import notify
    from .services import marketplace_listing_queryset
    from .views import parse_listing_filters
    listing_class = type(listing)
    notified = 0
    searches = SavedSearch.objects.filter(scope="MARKETPLACE").exclude(user_id=listing.lister_user_id).select_related("user")
    for search in searches:
        wanted = search.filters.get("category")
        if wanted and wanted != category:
            continue
        try:
            filters = parse_listing_filters({k: v for k, v in search.filters.items() if k != "category"})
        except ValidationError:
            continue
        if not marketplace_listing_queryset(listing_class=listing_class, filters=filters).filter(pk=listing.pk).exists():
            continue
        notify(
            recipient=search.user, notification_type="SAVED_SEARCH_MATCH",
            title="New match for your saved search",
            message=f"\"{listing.title}\" — {listing.price_xaf:,.0f} XAF matches {search.name or 'your saved marketplace search'}.",
            related_reference=str(listing.pk),
        )
        search.last_notified_at = timezone.now()
        search.save(update_fields=["last_notified_at"])
        notified += 1
    return notified


def notify_price_drop(listing, category: str, old_price: Decimal) -> int:
    """Tells everyone who saved the listing that its price went down."""
    from notifications.services import notify
    from social.models import Favorite
    if listing.price_xaf >= old_price or listing.removed_by_moderation:
        return 0
    savers = Favorite.objects.filter(listing_id=listing.pk).exclude(user_id=listing.lister_user_id).select_related("user")
    count = 0
    for favorite in savers:
        notify(
            recipient=favorite.user, notification_type="PRICE_DROP",
            title="Price drop on an item you saved",
            message=f"\"{listing.title}\" is now {listing.price_xaf:,.0f} XAF (was {old_price:,.0f} XAF).",
            related_reference=str(listing.pk),
        )
        count += 1
    return count


def remind_expiring_listings(now=None) -> list:
    """Warns listers EXPIRY_REMINDER_DAYS before a listing drops off the marketplace, once per renewal."""
    from django.utils import timezone
    from notifications.services import notify
    from .models import MarketplaceListingBase, AvailabilityStatus
    now = now or timezone.now()
    due = MarketplaceListingBase.objects.filter(
        availability_status=AvailabilityStatus.AVAILABLE, removed_by_moderation=False, expiry_reminded_at__isnull=True,
        renewed_at__gte=expiry_cutoff(now), renewed_at__lt=expiry_cutoff(now) + timedelta(days=EXPIRY_REMINDER_DAYS),
    ).select_related("lister_user")
    reminded = []
    for listing in due:
        notify(
            recipient=listing.lister_user, notification_type="LISTING_EXPIRING",
            title="Your listing expires soon",
            message=f"\"{listing.title}\" leaves the marketplace on {expires_at(listing):%d %b %Y}. "
                    "Still available? Renew it from My listings to keep it visible.",
            related_reference=str(listing.pk),
        )
        MarketplaceListingBase.objects.filter(pk=listing.pk).update(expiry_reminded_at=now)
        reminded.append(listing)
    return reminded
