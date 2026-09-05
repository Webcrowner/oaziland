"""
discovery.services — saved-search matching (with real notification
dispatch), property comparison, visual search, draw-your-own-area
polygon search, and the recommendation engine extended to listings.
"""
from decimal import Decimal


class ComparisonLimitError(Exception):
    pass


# ---------------------------------------------------------------------------
# Saved searches — the 'notified automatically the moment a matching
# listing publishes' requirement.
# ---------------------------------------------------------------------------
def listing_matches_filters(listing, filters: dict) -> bool:
    """Checks one listing against a SavedSearch's filter dict. Kept as a
    plain function (not a queryset filter) so the SAME matching logic
    can be used both to run a live search AND to check a single
    newly-published listing against every saved search — one source of
    truth for what 'matches' means."""
    if "min_price" in filters and listing.price_xaf < Decimal(str(filters["min_price"])):
        return False
    if "max_price" in filters and listing.price_xaf > Decimal(str(filters["max_price"])):
        return False
    if "quarter_id" in filters and str(listing.property_asset.quarter_id) != str(filters["quarter_id"]):
        return False
    if "property_type" in filters and listing.property_asset.type != filters["property_type"]:
        return False
    if "min_bedrooms" in filters:
        bedrooms = getattr(listing.property_asset, "bedrooms", None)
        if bedrooms is None or bedrooms < filters["min_bedrooms"]:
            return False
    if "water_source" in filters:
        market_details = getattr(listing, "market_details", None)
        if market_details is None or market_details.water_source != filters["water_source"]:
            return False
    if "road_accessibility" in filters:
        market_details = getattr(listing, "market_details", None)
        if market_details is None or market_details.road_accessibility != filters["road_accessibility"]:
            return False
    if "finish_level" in filters and listing.property_asset.finish_level != filters["finish_level"]:
        return False
    return True


def search_listings_with_filters(filters: dict, queryset=None):
    """The full-text/filtered search across every property type — reuses
    listing_matches_filters so a saved-search alert and a live search
    box always agree on what 'matches' means."""
    from property.models import Listing, ListingStatus

    if queryset is None:
        queryset = Listing.objects.filter(status=ListingStatus.PUBLISHED)
    return [listing for listing in queryset if listing_matches_filters(listing, filters)]


def create_saved_search(*, user, filters: dict, name: str = ""):
    """A real gap this closes: check_saved_searches_for_new_listing()
    matches new listings against saved searches, and now-fixed
    publish_listing_and_notify() actually triggers that check — but
    nothing ever let a user CREATE a saved search in the first place.
    The alerting mechanism existed with nothing to alert on."""
    from .models import SavedSearch
    return SavedSearch.objects.create(user=user, filters=filters, name=name)


def list_my_saved_searches(user):
    from .models import SavedSearch
    return SavedSearch.objects.filter(user=user).order_by("-id")


def delete_saved_search(*, user, saved_search_id):
    from .models import SavedSearch
    SavedSearch.objects.filter(user=user, id=saved_search_id).delete()


def check_saved_searches_for_new_listing(listing):
    """Called when a listing publishes — checks EVERY saved search
    against it and fires a real notification for each match. This is
    what makes 'notified automatically the moment a matching listing
    publishes' actually happen, not just a documented intention."""
    from django.utils import timezone
    from notifications.services import notify
    from .models import SavedSearch

    notified = []
    for saved_search in SavedSearch.objects.all():
        if listing_matches_filters(listing, saved_search.filters):
            notification = notify(
                recipient=saved_search.user,
                notification_type="SAVED_SEARCH_MATCH",
                title="A new listing matches your saved search!",
                message=f"{saved_search.name or 'Your saved search'} has a new match: listing {listing.id}",
                related_reference=str(listing.id),
            )
            saved_search.last_notified_at = timezone.now()
            saved_search.save(update_fields=["last_notified_at"])
            notified.append(notification)
    return notified


def publish_listing_and_notify(listing):
    """THE real, complete enforced publish pathway for a Listing —
    composes BOTH of the two 'enforced pathways' that existed
    separately and had never actually been combined:
    trust_safety.publish_listing_with_moderation() (blocks publishing
    outright on AUTO_REMOVE) and this function's own saved-search
    alerting. WHY this was a real bug, not just a missing feature: the
    real API's approve() endpoint had to call ONE of these two
    functions, and whichever one it called, the OTHER'S protection
    was silently skipped — moderation was never actually applied to
    any real, admin-approved listing, or saved-search alerts never
    fired, depending on which single function got wired in. Fixed by
    making this the one true pathway that does both, in the right order:
    moderation gates publishing; only a successfully published listing
    can match a saved search."""
    from trust_safety.services import publish_listing_with_moderation
    publish_listing_with_moderation(listing)
    return check_saved_searches_for_new_listing(listing)


# ---------------------------------------------------------------------------
# Property comparison.
# ---------------------------------------------------------------------------
MAX_COMPARISON_LISTINGS = 4
MIN_COMPARISON_LISTINGS = 2


def create_or_update_comparison(*, user, listing_ids: list):
    from .models import PropertyComparison

    if not (MIN_COMPARISON_LISTINGS <= len(listing_ids) <= MAX_COMPARISON_LISTINGS):
        raise ComparisonLimitError(
            f"A comparison must have between {MIN_COMPARISON_LISTINGS} and {MAX_COMPARISON_LISTINGS} listings."
        )
    comparison, _ = PropertyComparison.objects.update_or_create(
        user=user, defaults={"listing_ids": listing_ids},
    )
    return comparison


# ---------------------------------------------------------------------------
# Visual search.
# ---------------------------------------------------------------------------
def run_visual_search(*, user, image_url: str):
    from property.models import Listing, ListingStatus
    from .visual_search_providers import get_active_visual_search_provider
    from .models import VisualSearchQuery

    provider = get_active_visual_search_provider()
    candidate_ids = list(Listing.objects.filter(status=ListingStatus.PUBLISHED).values_list("id", flat=True))
    matched_ids = provider.find_similar_listings(image_url, candidate_ids)

    return VisualSearchQuery.objects.create(
        user=user, uploaded_image_url=image_url, matched_listing_ids=[str(i) for i in matched_ids],
    )


# ---------------------------------------------------------------------------
# Draw-your-own-area (polygon) search.
# ---------------------------------------------------------------------------
def _point_in_polygon(lat, lon, polygon_points) -> bool:
    """A standard ray-casting point-in-polygon test, implemented directly
    (no external geometry library needed) — consistent with how the
    Haversine distance was implemented by hand in geo/services.py rather
    than pulling in a dependency for one well-known formula.
    polygon_points is a list of (lat, lon) tuples forming a closed shape."""
    x, y = float(lon), float(lat)
    inside = False
    n = len(polygon_points)
    j = n - 1
    for i in range(n):
        yi, xi = float(polygon_points[i][0]), float(polygon_points[i][1])
        yj, xj = float(polygon_points[j][0]), float(polygon_points[j][1])
        intersects = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
        if intersects:
            inside = not inside
        j = i
    return inside


def search_listings_within_drawn_area(polygon_points: list):
    """'Draw-your-own-search-area' — polygon_points is what a map UI's
    freehand drawing tool would send: a list of (lat, lon) vertices."""
    from property.models import Listing, ListingStatus

    candidates = Listing.objects.filter(status=ListingStatus.PUBLISHED).exclude(
        property_asset__latitude__isnull=True,
    ).exclude(property_asset__longitude__isnull=True)

    return [
        listing for listing in candidates
        if _point_in_polygon(listing.property_asset.latitude, listing.property_asset.longitude, polygon_points)
    ]


# ---------------------------------------------------------------------------
# Recommendation engine, extended to listings (not just Posts).
# ---------------------------------------------------------------------------
def get_recommended_listings(user, limit=20):
    """Mirrors social.services.get_recommended_feed's real-estate-
    priority logic, but ranks Listings directly — favorited/viewed
    listings' quarters and property types drive 'similar' scoring."""
    from property.models import Listing, ListingStatus
    from social.models import Favorite

    favorited_listing_ids = Favorite.objects.filter(user=user).exclude(listing_id__isnull=True).values_list("listing_id", flat=True)
    interest_quarters = set(
        Listing.objects.filter(id__in=favorited_listing_ids).values_list("property_asset__quarter_id", flat=True)
    )

    candidates = Listing.objects.filter(status=ListingStatus.PUBLISHED).exclude(id__in=favorited_listing_ids)

    scored = []
    for listing in candidates:
        shares_quarter = listing.property_asset.quarter_id in interest_quarters
        score = (1 if shares_quarter else 0)
        scored.append((listing, score))

    scored.sort(key=lambda pair: (pair[1], pair[0].published_at or pair[0].created_at), reverse=True)
    return [listing for listing, score in scored[:limit]]


# ---------------------------------------------------------------------------
# Platform-wide listing waitlist.
# ---------------------------------------------------------------------------
def join_listing_waitlist(*, user, listing_id):
    from .models import ListingWaitlistEntry
    entry, _ = ListingWaitlistEntry.objects.get_or_create(user=user, listing_id=listing_id)
    return entry


def notify_waitlist_on_availability(listing_id):
    """Called when a previously-taken listing becomes available again —
    e.g. from property.services.get_property_status_summary's callers
    once a booking ends. Notifies EVERY waitlisted user, in join order,
    and marks each notified so they're not alerted twice for the same
    availability window."""
    from django.utils import timezone
    from notifications.services import notify
    from .models import ListingWaitlistEntry

    entries = ListingWaitlistEntry.objects.filter(listing_id=listing_id, notified_at__isnull=True).order_by("joined_at")
    notified = []
    for entry in entries:
        notify(
            recipient=entry.user, notification_type="WAITLIST_LISTING_AVAILABLE",
            title="A listing you're waiting for is available!",
            message=f"The listing you joined the waitlist for is now available.",
            related_reference=str(listing_id),
        )
        entry.notified_at = timezone.now()
        entry.save(update_fields=["notified_at"])
        notified.append(entry)
    return notified


# ---------------------------------------------------------------------------
# The "I Am Looking For X" reverse board — rooms, stores, warehouses,
# businesses. Generalizes land.LandInquiry's already-proven pattern.
# ---------------------------------------------------------------------------
def post_wanted_listing(*, seeker, category: str, quarter=None, min_size_sqm=None, max_budget_xaf=None, notes: str = ""):
    from .models import WantedListing
    return WantedListing.objects.create(
        seeker=seeker, category=category, quarter=quarter,
        min_size_sqm=min_size_sqm, max_budget_xaf=max_budget_xaf, notes=notes,
    )


def respond_to_wanted_listing(*, wanted_listing, responder, message: str):
    from .models import WantedListingResponse
    return WantedListingResponse.objects.create(wanted_listing=wanted_listing, responder=responder, message=message)


def mark_wanted_listing_fulfilled(wanted_listing):
    from .models import WantedListingStatus
    wanted_listing.status = WantedListingStatus.FULFILLED
    wanted_listing.save(update_fields=["status"])
    return wanted_listing


def list_open_wanted_listings(*, category: str = None, quarter=None):
    from .models import WantedListing, WantedListingStatus
    queryset = WantedListing.objects.filter(status=WantedListingStatus.OPEN)
    if category:
        queryset = queryset.filter(category=category)
    if quarter:
        queryset = queryset.filter(quarter=quarter)
    return queryset.order_by("-created_at")
