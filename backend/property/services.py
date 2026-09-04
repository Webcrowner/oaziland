"""
property.services — search and discovery logic that doesn't belong on the
models themselves (models describe WHAT a property is; this file
describes HOW to find one).
"""
from django.db import models
from geo.services import haversine_distance_km


def properties_near_location(latitude, longitude, radius_km=5, queryset=None):
    """'Properties around me' — Prompt 3's explicit requirement. Returns
    every property within `radius_km` of the given point, sorted nearest
    first.

    WHY this is a plain Python function instead of a database query: a
    true 'find everything within N km' database query needs PostGIS's
    spatial indexing to run fast at scale. This straightforward version
    (fetch candidates, compute distance in Python, filter and sort) is
    correct and fine for now; swapping it for a PostGIS ST_DWithin query
    later is a pure performance upgrade that doesn't change what this
    function promises to callers.

    `queryset` lets a caller pre-filter (e.g. only PUBLISHED listings,
    only houses) before the distance search runs — defaults to every
    PropertyAsset with coordinates set.
    """
    from .models import PropertyAsset

    if queryset is None:
        queryset = PropertyAsset.objects.all()

    candidates = queryset.exclude(latitude__isnull=True).exclude(longitude__isnull=True)

    results = []
    for prop in candidates:
        distance = haversine_distance_km(latitude, longitude, prop.latitude, prop.longitude)
        if distance <= radius_km:
            results.append((prop, distance))

    results.sort(key=lambda pair: pair[1])  # nearest first
    return results


def search_listings_by_quarter(quarter, property_type: str = None, finish_level: str = None):
    """Search + ranking for one quarter, boosted listings first — this is
    what makes AdCampaign/BoostedContent (monetization app) actually mean
    something to a searcher, not just exist as unused billing records.

    finish_level is a real filter button per the founder's explicit
    requirement: 'modern or not modern' is a decisive factor for renters
    in Cameroon specifically, but the field itself is universal — this
    same filter works in any country the platform operates in.

    Ranking: any listing with an ACTIVE boost targeting this quarter (or
    with no quarter targeting at all — a general boost) is shown first,
    ordered by priority_rank (lower = higher). Every other, non-boosted
    listing follows, most recently published first."""
    from monetization.models import BoostedContent
    from .models import Listing, ListingStatus

    base_query = Listing.objects.filter(status=ListingStatus.PUBLISHED, property_asset__quarter=quarter)
    if property_type:
        base_query = base_query.filter(property_asset__type=property_type)
    if finish_level:
        base_query = base_query.filter(property_asset__finish_level=finish_level)

    listing_ids = set(base_query.values_list("id", flat=True))

    active_boosts = BoostedContent.objects.filter(
        listing_id__in=listing_ids, campaign__status="ACTIVE",
    ).filter(
        models.Q(campaign__target_quarter=quarter) | models.Q(campaign__target_quarter__isnull=True)
    ).select_related("campaign").order_by("priority_rank")

    boosted_listing_ids = []
    seen = set()
    for boost in active_boosts:
        if boost.listing_id not in seen:
            boosted_listing_ids.append(boost.listing_id)
            seen.add(boost.listing_id)

    boosted_listings = [base_query.get(id=lid) for lid in boosted_listing_ids]
    organic_listings = list(base_query.exclude(id__in=boosted_listing_ids).order_by("-published_at"))

    return boosted_listings + organic_listings  # boosted always first, regardless of recency


def get_property_status_summary(property_asset):
    """The founder's explicit requirement: know when a property is
    taken, available, or scheduled — not just a bare status flag. Reads
    real Booking and Lease data rather than trusting Listing.status
    alone, since a listing can show PUBLISHED while an active booking
    hold is quietly in progress, or a lease is scheduled to start in
    the future.

    Returns one of:
      - 'AVAILABLE' — no active booking, no upcoming lease
      - 'RESERVATION_IN_PROGRESS' — someone is mid-checkout right now
      - 'TAKEN' — a confirmed booking/lease currently covers today
      - 'SCHEDULED' — a future booking/lease exists, but not yet started
    """
    from django.utils import timezone
    from transactions.models import Booking, BookingStatus
    from property_management.models import Lease

    listings = property_asset.listings.all()
    listing_ids = list(listings.values_list("id", flat=True))

    active_bookings = Booking.objects.filter(
        target_content_type="property.Listing", target_id__in=listing_ids,
        status__in=[BookingStatus.PENDING, BookingStatus.PAYMENT_PROCESSING],
    )
    if active_bookings.exists():
        return {"status": "RESERVATION_IN_PROGRESS", "detail": None}

    confirmed_bookings = Booking.objects.filter(
        target_content_type="property.Listing", target_id__in=listing_ids,
        status__in=[BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
    )
    today = timezone.now().date()

    for booking in confirmed_bookings:
        lease = Lease.objects.filter(booking=booking).first()
        if lease is None:
            # Confirmed with no defined lease term yet (e.g. a sale, or
            # a rental awaiting a formal lease record) — treat as taken now.
            return {"status": "TAKEN", "detail": {"booking_id": str(booking.id)}}
        if lease.start_date <= today <= lease.end_date:
            return {"status": "TAKEN", "detail": {"lease_end_date": lease.end_date}}
        if lease.start_date > today:
            return {"status": "SCHEDULED", "detail": {"scheduled_from": lease.start_date}}

    return {"status": "AVAILABLE", "detail": None}


def get_landlord_portfolio_summary(landlord):
    """Aggregates across EVERY property type a landlord owns (house,
    land, shop, warehouse, everything) — the catalogue document's
    'portfolio dashboard across multiple properties', generalized
    beyond just hostels (student_hostels already has its own portfolio
    summary for agencies managing hostels specifically; this is the
    general-landlord equivalent)."""
    from django.db.models import Sum, Count
    from .models import PropertyAsset, Listing, ListingStatus
    from transactions.models import Booking, BookingStatus, Commission

    properties = PropertyAsset.objects.filter(owner=landlord)
    listings = Listing.objects.filter(property_asset__in=properties)
    published_listings = listings.filter(status=ListingStatus.PUBLISHED)

    listing_ids = list(listings.values_list("id", flat=True))
    completed_bookings = Booking.objects.filter(
        target_content_type="property.Listing", target_id__in=listing_ids, status=BookingStatus.COMPLETED,
    )

    total_commission_paid = Commission.objects.filter(
        booking__target_content_type="property.Listing", booking__target_id__in=listing_ids,
    ).aggregate(total=Sum("total_amount_xaf"))["total"] or 0

    from oaziland.analytics import compute_period_over_period
    all_bookings = Booking.objects.filter(target_content_type="property.Listing", target_id__in=listing_ids)
    bookings_trend = compute_period_over_period(queryset=all_bookings, date_field="created_at")

    return {
        "total_properties": properties.count(),
        "total_listings": listings.count(),
        "published_listings": published_listings.count(),
        "completed_bookings": completed_bookings.count(),
        "total_commission_paid_xaf": total_commission_paid,
        "bookings_trend": bookings_trend,
    }


def build_property_location_from_device_gps(latitude, longitude, quarter=None):
    """Supports 'use my location when posting a property' — Prompt 3's
    other explicit requirement. This is a thin, named helper (rather than
    landlords just setting property.latitude directly) so the ONE place
    that accepts device GPS coordinates for a new listing is easy to find
    and adjust later — e.g. if we later want to snap the coordinates to
    the nearest known Quarter automatically, or validate they fall within
    Cameroon, this is where that logic would live.

    Returns a dict of field values ready to pass into PropertyAsset
    creation — kept as a dict rather than partially constructing the
    model, so this function has no opinion about which PropertyAsset
    subclass (House, Shop, Land...) is actually being created.
    """
    return {
        "latitude": latitude,
        "longitude": longitude,
        "quarter": quarter,  # still required — GPS alone doesn't tell us which named Quarter this falls in
    }
