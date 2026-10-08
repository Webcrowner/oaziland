"""
property.services — search and discovery logic that doesn't belong on the
models themselves (models describe WHAT a property is; this file
describes HOW to find one).
"""
from django.db import models
from geo.services import haversine_distance_km


class ListingEditError(Exception):
    """An edit was rejected (field not applicable to this property type, or blocked by moderation)."""


HOUSE_ONLY_FIELDS = ("bedrooms", "bathrooms", "living_rooms", "house_style", "has_garage", "pets_allowed")
ASSET_FIELDS = ("description", "size_sqm", "finish_level", "latitude", "longitude")


def update_listing_details(listing, data: dict):
    """Applies a lister's edit to the listing and its underlying property. A price or detail change on
    a live listing deliberately does NOT change its status or go back to admin review; only new
    description text is screened by content moderation."""
    from django.db import transaction
    from trust_safety.models import ModerationAction
    from trust_safety.services import score_text

    base = listing.property_asset
    target = next((getattr(base, rel, None) for rel in ("house", "shop", "land") if getattr(base, rel, None) is not None), base)

    for field in HOUSE_ONLY_FIELDS:
        if field in data and not hasattr(target, field):
            raise ListingEditError(f"'{field}' does not apply to this type of property.")
    if "frontage_meters" in data and not hasattr(target, "frontage_meters"):
        raise ListingEditError("'frontage_meters' does not apply to this type of property.")

    description = data.get("description")
    if description and description != base.description:
        results = score_text(description, target_listing_id=listing.id)
        if any(r.action == ModerationAction.AUTO_REMOVE for r in results):
            raise ListingEditError("This description was blocked by content moderation. Please reword it.")

    with transaction.atomic():
        if "amenities" in data:
            set_property_amenities(target, data["amenities"])
        for field in ASSET_FIELDS + HOUSE_ONLY_FIELDS + ("frontage_meters",):
            if field in data:
                setattr(target, field, data[field])
        target.save()
        listing_fields = [f for f in ("price_xaf", "listing_type") if f in data]
        for field in listing_fields:
            setattr(listing, field, data[field])
        if listing_fields:
            listing.save(update_fields=listing_fields)
    return listing


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


def search_listings_by_quarter(quarter, property_type: str = None, finish_level: str = None, listing_type: str = None):
    """Search + ranking for one quarter, boosted listings first — this is
    what makes AdCampaign/BoostedContent (monetization app) actually mean
    something to a searcher, not just exist as unused billing records.

    finish_level is a real filter button per the founder's explicit
    requirement: 'modern or not modern' is a decisive factor for renters
    in Cameroon specifically, but the field itself is universal — this
    same filter works in any country the platform operates in.

    listing_type (RENT vs SALE) was a real gap before this — the
    platform's two most basic categories, 'properties to rent' and
    'properties for sale,' had no way to be filtered separately at all.

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
    if listing_type:
        base_query = base_query.filter(listing_type=listing_type)

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


# ---------------------------------------------------------------------------
# Listing expiration — notifying every relevant party (tenant, landlord,
# agent, agency), real auto-expiry, and self-service renewal.
# ---------------------------------------------------------------------------
EXPIRATION_REMINDER_DAYS_BEFORE = [14, 7, 3, 1]


def _current_tenant_for_listing(listing):
    """The person actually occupying/renting this listing right now,
    if any — found through a CONFIRMED/CHECKED_IN booking targeting it,
    the same generic (content_type, id) pattern used everywhere else."""
    from transactions.models import Booking, BookingStatus
    booking = Booking.objects.filter(
        target_content_type="property.Listing", target_id=listing.id,
        status__in=[BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
    ).order_by("-created_at").first()
    return booking.requester if booking else None


def _interested_parties_for_listing(listing):
    """Every real person who should hear about this listing's
    lifecycle — 'a tenant, landlord, agent, or agency,' per the
    founder's explicit requirement. De-duplicated, since the same
    person can hold more than one of these roles (an owner who is
    also their own listing agent, for instance)."""
    parties = {listing.listed_by}  # the agent/landlord who actually posted it
    parties.add(listing.property_asset.owner)  # the property owner, if different from who listed it

    if hasattr(listing.listed_by, "agent_profile") and listing.listed_by.agent_profile.agency:
        parties.add(listing.listed_by.agent_profile.agency.user)  # the agency, if the lister is one of its agents

    tenant = _current_tenant_for_listing(listing)
    if tenant:
        parties.add(tenant)

    return parties


def send_listing_expiration_reminders(today=None):
    """Fires at 14/7/3/1 days before a listing expires — the same
    idempotent-safe daily-job pattern already used for lease renewals
    and event balance reminders (never re-sent twice in the same real day)."""
    from django.utils import timezone
    from notifications.services import notify
    from notifications.models import Notification
    from .models import Listing, ListingStatus

    today = today or timezone.now().date()
    sent = []
    for listing in Listing.objects.filter(status=ListingStatus.PUBLISHED, expires_at__isnull=False):
        days_until = (listing.expires_at.date() - today).days
        if days_until not in EXPIRATION_REMINDER_DAYS_BEFORE:
            continue

        notification_type = f"LISTING_EXPIRING_{days_until}D"
        for party in _interested_parties_for_listing(listing):
            if Notification.objects.filter(recipient=party, notification_type=notification_type, related_reference=str(listing.id), created_at__date=timezone.now().date()).exists():
                continue
            notification = notify(
                recipient=party, notification_type=notification_type, channel="WHATSAPP",
                title=f"Listing expiring in {days_until} day{'s' if days_until != 1 else ''}",
                message=f"A listing ({listing.property_asset.type} in {listing.property_asset.quarter}) expires in {days_until} day{'s' if days_until != 1 else ''}. Renew it to keep it visible in search.",
                related_reference=str(listing.id),
            )
            sent.append(notification)
    return sent


def expire_overdue_listings(now=None):
    """Real auto-expiry — once a listing's expires_at has genuinely
    passed, it's actually moved to EXPIRED (and drops out of public
    search, since search only shows PUBLISHED listings), not just
    silently left PUBLISHED with a stale date nobody enforces."""
    from django.utils import timezone
    from .models import Listing, ListingStatus
    from notifications.services import notify

    now = now or timezone.now()
    overdue = Listing.objects.filter(status=ListingStatus.PUBLISHED, expires_at__lt=now)
    expired = []
    for listing in overdue:
        listing.status = ListingStatus.EXPIRED
        listing.save(update_fields=["status"])
        for party in _interested_parties_for_listing(listing):
            notify(
                recipient=party, notification_type="LISTING_EXPIRED", channel="WHATSAPP",
                title="Your listing has expired",
                message=f"A listing ({listing.property_asset.type} in {listing.property_asset.quarter}) has expired and is no longer visible in search. Renew it to bring it back.",
                related_reference=str(listing.id),
            )
        expired.append(listing)
    return expired


class InvalidAmenityError(Exception):
    pass


class InvalidHouseRuleError(Exception):
    pass


def set_property_amenities(property_asset, amenities: list):
    """The real enforcement behind 'amenities limited to a fixed
    list' — matches services.set_technician_specialties()'s exact
    pattern: the underlying field is a plain JSONField with no
    built-in choice validation, so this is where that validation
    actually lives."""
    from .models import PropertyAmenity
    valid_values = {choice.value for choice in PropertyAmenity}
    invalid = [a for a in amenities if a not in valid_values]
    if invalid:
        raise InvalidAmenityError(f"Not a supported amenity: {invalid}")
    property_asset.amenities = amenities
    property_asset.save(update_fields=["amenities"])
    return property_asset


def set_house_rules(property_asset, rules: list):
    from .models import HouseRule
    valid_values = {choice.value for choice in HouseRule}
    invalid = [r for r in rules if r not in valid_values]
    if invalid:
        raise InvalidHouseRuleError(f"Not a supported house rule: {invalid}")
    property_asset.house_rules = rules
    property_asset.save(update_fields=["house_rules"])
    return property_asset


def set_nearby_facilities(property_asset, point_of_interest_ids: list):
    """Only ever attaches REAL PointOfInterest rows that actually
    exist — an ID that doesn't match anything is silently skipped
    rather than raising, since 'you tagged an unrelated ID' is
    almost certainly a client-side mistake, not something worth a
    hard failure over. Real IDs still attach correctly either way."""
    from geo.models import PointOfInterest
    real_pois = PointOfInterest.objects.filter(id__in=point_of_interest_ids)
    property_asset.nearby_facilities.set(real_pois)
    return property_asset
