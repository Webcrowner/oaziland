"""
marketplace.services — filtered search across every listing category,
attaching/reading generic ListingCondition objects, and the full ride
lifecycle settling through the SAME Booking/PaymentEscrow machinery as
every other transaction on the platform.
"""
import logging
import math
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction as db_transaction
from django.db.models import Q

from geo.routing import driving_route

logger = logging.getLogger(__name__)

LISTING_ORDERINGS = {
    # Paid TOP listings (boost_rank 0, see boosts.py) come first in the default order, like Jiji's TOP ads.
    "newest": ("boost_rank", "-created_at"),
    "oldest": ("created_at",),
    "price_asc": ("price_xaf", "-created_at"),
    "price_desc": ("-price_xaf", "-created_at"),
    # Only valid together with a near_lat/near_lng point, which is what adds the distance_km column.
    "distance": ("distance_km", "-created_at"),
    # Flash sales, the ones ending first. Only valid together with on_sale=1 (every row then has an end date).
    "ending_soon": ("sale_ends_at", "-created_at"),
}


def _car_orderings():
    from django.db.models import F
    # Cars with no mileage given go last rather than looking like the lowest-mileage cars.
    return {
        "year_desc": ("-vehicle_spec__year", "-created_at"),
        "year_asc": ("vehicle_spec__year", "-created_at"),
        "mileage_asc": (F("vehicle_spec__mileage_km").asc(nulls_last=True), "-created_at"),
    }


# Sorts that only exist on the cars list (the combined feed can't sort other categories by a car's year).
CAR_ORDERINGS = ("year_desc", "year_asc", "mileage_asc")

EARTH_RADIUS_KM = 6371.0


def attach_condition(*, listing, created_by, structured_conditions: dict = None, free_text_clause: str = ""):
    """Attaches a ListingCondition to ANY listing instance — property.
    Listing or any marketplace subclass — using the same generic
    (content_type, id) pattern Booking already uses for its polymorphic
    target, rather than a condition FK duplicated per listing type."""
    from .models import ListingCondition

    content_type = f"{listing._meta.app_label}.{listing.__class__.__name__}"
    return ListingCondition.objects.create(
        target_content_type=content_type, target_id=listing.id, created_by=created_by,
        structured_conditions=structured_conditions or {}, free_text_clause=free_text_clause,
    )


def get_conditions_for(listing):
    from .models import ListingCondition
    content_type = f"{listing._meta.app_label}.{listing.__class__.__name__}"
    return ListingCondition.objects.filter(target_content_type=content_type, target_id=listing.id)


def moderate_listing_text(*, listing_id, title: str, description: str):
    """Scores a listing's words before it can go live; AUTO_REMOVE raises ContentBlockedError."""
    from trust_safety.services import score_text, _worst_action, ContentBlockedError
    from trust_safety.models import ModerationAction

    text = f"{title}\n{description}".strip()
    if text and _worst_action(score_text(text, target_listing_id=listing_id)) == ModerationAction.AUTO_REMOVE:
        raise ContentBlockedError("This listing was blocked by content moderation. Please remove inappropriate wording and try again.")


def moderate_listing_photo(*, listing_id, url: str):
    from trust_safety.services import score_image, _worst_action, ContentBlockedError
    from trust_safety.models import ModerationAction

    if _worst_action(score_image(url, target_listing_id=listing_id)) == ModerationAction.AUTO_REMOVE:
        raise ContentBlockedError("This photo was blocked by content moderation.")


def take_down_listing(listing_id) -> bool:
    """Hides a listing an admin confirmed as a violation; returns whether a marketplace listing was found."""
    from .models import MarketplaceListingBase, AvailabilityStatus

    return bool(MarketplaceListingBase.objects.filter(pk=listing_id).update(
        removed_by_moderation=True, availability_status=AvailabilityStatus.UNAVAILABLE,
    ))


def marketplace_listing_queryset(*, listing_class, filters: dict = None):
    """The filtered, ordered, still-lazy queryset behind every marketplace browse surface."""
    from .models import AvailabilityStatus

    filters = filters or {}
    from django.db.models import Case, When, Value, IntegerField
    from django.utils import timezone
    from .engagement import expiry_cutoff
    queryset = listing_class.objects.filter(availability_status=AvailabilityStatus.AVAILABLE, renewed_at__gte=expiry_cutoff())
    from .shops import vacationing_seller_ids
    on_vacation = vacationing_seller_ids()
    if on_vacation:
        queryset = queryset.exclude(lister_user_id__in=on_vacation)
    if filters.get("on_sale"):
        now = timezone.now()
        queryset = queryset.filter(sale_price_xaf__isnull=False, sale_ends_at__gt=now).filter(Q(sale_starts_at__isnull=True) | Q(sale_starts_at__lte=now))
    queryset = queryset.annotate(
        boost_rank=Case(When(boosted_until__gt=timezone.now(), then=Value(0)), default=Value(1), output_field=IntegerField()),
    )

    if "min_price" in filters:
        queryset = queryset.filter(price_xaf__gte=Decimal(str(filters["min_price"])))
    if "max_price" in filters:
        queryset = queryset.filter(price_xaf__lte=Decimal(str(filters["max_price"])))
    if "min_size_sqm" in filters and hasattr(listing_class, "size_sqm"):
        queryset = queryset.filter(size_sqm__gte=Decimal(str(filters["min_size_sqm"])))
    if "quarter_id" in filters:
        queryset = queryset.filter(quarter_id=filters["quarter_id"])
    if filters.get("price_basis"):
        queryset = queryset.filter(price_basis=filters["price_basis"])
    if filters.get("item_category") and hasattr(listing_class, "item_category"):
        queryset = queryset.filter(item_category=filters["item_category"])
        for key, (lookup, value) in filters.get("attributes", {}).items():
            queryset = queryset.filter(**{f"attributes__{key}__{lookup}": value})
    if filters.get("lister_id"):
        queryset = queryset.filter(lister_user_id=filters["lister_id"])
    if filters.get("condition") and hasattr(listing_class, "condition"):
        queryset = queryset.filter(condition=filters["condition"])
    is_car = hasattr(listing_class, "vehicle_spec")
    if is_car:
        if filters.get("make"):
            queryset = queryset.filter(vehicle_spec__make__icontains=filters["make"])
        if filters.get("model"):
            queryset = queryset.filter(vehicle_spec__model__icontains=filters["model"])
        if "min_year" in filters:
            queryset = queryset.filter(vehicle_spec__year__gte=filters["min_year"])
        if "max_year" in filters:
            queryset = queryset.filter(vehicle_spec__year__lte=filters["max_year"])
        if "max_mileage_km" in filters:
            queryset = queryset.filter(vehicle_spec__mileage_km__lte=filters["max_mileage_km"])
        queryset = _apply_car_filters(queryset, filters)
    if filters.get("q"):
        from .search_assist import listing_text_q
        queryset = queryset.filter(listing_text_q(filters["q"], is_car=is_car))
    if "near_lat" in filters:
        queryset = _within_radius(queryset, filters["near_lat"], filters["near_lng"], filters.get("radius_km", DEFAULT_NEAR_RADIUS_KM))
    ordering = filters.get("ordering", "newest")
    if ordering in CAR_ORDERINGS:
        fields = _car_orderings()[ordering] if is_car else LISTING_ORDERINGS["newest"]
    else:
        fields = LISTING_ORDERINGS[ordering]
    queryset = queryset.order_by(*fields, "id")
    return queryset


DEFAULT_NEAR_RADIUS_KM = 25
MAX_NEAR_RADIUS_KM = 500


def _apply_car_filters(queryset, filters: dict):
    from .models import CarBlockedPeriod, MarketplaceOrder, MarketplaceOrderStatus, DriverOption
    for key in ("body_type", "fuel_type", "transmission", "drivetrain", "vehicle_condition"):
        if filters.get(key):
            queryset = queryset.filter(**{f"vehicle_spec__{key}__in": filters[key]})
    if "min_seats" in filters:
        queryset = queryset.filter(vehicle_spec__seats__gte=filters["min_seats"])
    if filters.get("customs_cleared"):
        queryset = queryset.filter(vehicle_spec__customs_cleared=True)
    if filters.get("negotiable"):
        queryset = queryset.filter(price_basis="SALE", price_negotiable=True)
    if filters.get("with_driver"):
        queryset = queryset.filter(price_basis="RENT_NIGHTLY", driver_option__in=[DriverOption.WITH_DRIVER, DriverOption.EITHER])
    if filters.get("delivery"):
        queryset = queryset.filter(price_basis="RENT_NIGHTLY", delivery_available=True)
    if filters.get("instant_book"):
        queryset = queryset.filter(price_basis="RENT_NIGHTLY", instant_book=True)
    if "available_from" in filters:
        start, end = filters["available_from"], filters["available_to"]
        live = (
            MarketplaceOrderStatus.PAYMENT_PENDING, MarketplaceOrderStatus.PAID, MarketplaceOrderStatus.HANDED_OVER,
            MarketplaceOrderStatus.DISPUTED, MarketplaceOrderStatus.COMPLETED,
        )
        booked = MarketplaceOrder.objects.filter(
            booked_dates=True, status__in=live, rental_starts_on__lt=end, rental_ends_on__gt=start,
        ).values("listing_id")
        blocked = CarBlockedPeriod.objects.filter(starts_on__lt=end, ends_on__gt=start).values("car_id")
        queryset = queryset.filter(price_basis="RENT_NIGHTLY").exclude(pk__in=booked).exclude(pk__in=blocked)
    return queryset

def _within_radius(queryset, latitude: float, longitude: float, radius_km: float):
    """Keeps listings that have a map position within radius_km of the point and annotates `distance_km`.

    A cheap bounding box on the plain columns narrows the rows first; the exact great-circle distance (spherical
    law of cosines, in SQL so it also orders and pages in the database) then trims the box's corners.
    """
    from django.db.models import ExpressionWrapper, FloatField, Value
    from django.db.models.functions import ACos, Cast, Cos, Greatest, Least, Radians, Sin

    lat_span = radius_km / 111.0
    lng_span = radius_km / (111.0 * max(math.cos(math.radians(latitude)), 0.01))
    queryset = queryset.filter(latitude__isnull=False, longitude__isnull=False, latitude__range=(latitude - lat_span, latitude + lat_span))
    if abs(longitude) + lng_span <= 180:
        queryset = queryset.filter(longitude__range=(longitude - lng_span, longitude + lng_span))

    def number(value):
        return Value(float(value), output_field=FloatField())

    listing_lat = Radians(Cast("latitude", FloatField()))
    lng_gap = Radians(Cast("longitude", FloatField()) - number(longitude))
    cosine = Sin(Radians(number(latitude))) * Sin(listing_lat) + Cos(Radians(number(latitude))) * Cos(listing_lat) * Cos(lng_gap)
    distance = ExpressionWrapper(number(EARTH_RADIUS_KM) * ACos(Least(number(1), Greatest(number(-1), cosine))), output_field=FloatField())
    return queryset.annotate(distance_km=distance).filter(distance_km__lte=radius_km)


def with_listing_related(queryset):
    """Loads what the listing serializers read (lister, area, photos and a car's spec) without a query per row."""
    queryset = queryset.select_related("quarter", "lister_user", "lister_user__shop_profile").prefetch_related("media")
    if hasattr(queryset.model, "vehicle_spec"):
        queryset = queryset.select_related("vehicle_spec")
    if hasattr(queryset.model, "variants"):
        queryset = queryset.prefetch_related("variants")
    return queryset


def search_marketplace_listings(*, listing_class, filters: dict = None):
    """Filtered search for one marketplace category at a time (warehouse
    OR store OR business OR car) — mirrors discovery.services.
    search_listings_with_filters's shape so both search systems feel
    consistent to whichever app calls them. Stays a lazy queryset (so callers can page in the
    database) unless a condition filter forces a Python pass over the rows."""
    filters = filters or {}
    queryset = marketplace_listing_queryset(listing_class=listing_class, filters=filters)
    if "required_conditions" not in filters:
        return queryset

    # Condition-based filtering happens in Python, since conditions live
    # in a separate generic table, not columns on the listing itself.
    matching = []
    for listing in queryset:
        conditions = get_conditions_for(listing)
        combined = {}
        for c in conditions:
            combined.update(c.structured_conditions)
        if all(combined.get(k) == v for k, v in filters["required_conditions"].items()):
            matching.append(listing)
    return matching


class MarketplaceFeed:
    """A lazily-paged, merged view over several listing categories, shaped for Django's Paginator.

    Counting is one COUNT per category, and a page needs only the sort keys of the first `offset + size`
    rows of each category (a k-way merge); the full rows are then fetched for just the ids on that page.
    """

    def __init__(self, sources: dict, filters: dict):
        self._querysets = {
            category: marketplace_listing_queryset(listing_class=listing_class, filters=filters)
            for category, listing_class in sources.items()
        }
        self._ordering = LISTING_ORDERINGS[filters.get("ordering", "newest")]
        self._near = "near_lat" in filters
        self._count = None

    def __len__(self):
        if self._count is None:
            self._count = sum(queryset.count() for queryset in self._querysets.values())
        return self._count

    def __getitem__(self, window):
        start, stop = window.start or 0, window.stop
        fields = [field.lstrip("-") for field in self._ordering]
        # The distance column is carried along even when sorting by something else, so cards can show it.
        carried = fields + (["distance_km"] if self._near and "distance_km" not in fields else [])
        candidates = []
        for category, queryset in self._querysets.items():
            for row in queryset.values_list("pk", *carried)[:stop]:
                candidates.append((category, *row))
        # Sorting by each key from least to most significant (stable) reproduces the per-category order.
        for position in reversed(range(len(fields))):
            candidates.sort(key=lambda candidate: candidate[2 + position], reverse=self._ordering[position].startswith("-"))
        page = candidates[start:stop]

        wanted: dict = {}
        for category, pk, *_ in page:
            wanted.setdefault(category, []).append(pk)
        loaded = {
            category: {obj.pk: obj for obj in with_listing_related(self._querysets[category].model.objects.filter(pk__in=pks))}
            for category, pks in wanted.items()
        }
        entries = []
        for category, pk, *values in page:
            listing = loaded[category][pk]
            if self._near:
                listing.distance_km = values[carried.index("distance_km")]
            entries.append((category, listing))
        return entries


# ---------------------------------------------------------------------------
# Ride booking lifecycle.
# ---------------------------------------------------------------------------
RIDE_CATEGORY_RATES = {
    # (base_fare_xaf, per_km_xaf) — real, distinct pricing per category,
    # the actual gap this closes: every ride previously used one
    # single formula regardless of vehicle. Ordered cheapest to most
    # expensive, moto first — the real, dominant cheap option in
    # Cameroon's actual ride market.
    "MOTO": (Decimal("300"), Decimal("100")),
    "STANDARD": (Decimal("500"), Decimal("150")),
    "COMFORT": (Decimal("800"), Decimal("220")),
    "VAN": (Decimal("1500"), Decimal("300")),
    "TRUCK": (Decimal("2500"), Decimal("450")),
}


def estimate_ride_fare(*, distance_km: Decimal, ride_category: str = "STANDARD"):
    """A simple, transparent fare formula — deliberately not a dynamic-
    pricing black box, consistent with finance.estimate_affordable_rent_
    range's philosophy of explainable numbers. Real, distinct rates per
    ride_category (see RIDE_CATEGORY_RATES) rather than one fare for
    every vehicle type."""
    base_fare_xaf, per_km_xaf = RIDE_CATEGORY_RATES.get(ride_category, RIDE_CATEGORY_RATES["STANDARD"])
    # The CFA franc has no smaller unit in use, so fares are whole francs.
    return (base_fare_xaf + (Decimal(distance_km) * per_km_xaf)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def infer_ride_distance_km(*, fare_estimate_xaf, ride_category: str = "STANDARD", pickup_coords=None, dropoff_coords=None) -> Decimal:
    """Reconstructs distance_km for rides requested before distance_km was stored on RideBooking."""
    base_fare_xaf, per_km_xaf = RIDE_CATEGORY_RATES.get(ride_category, RIDE_CATEGORY_RATES["STANDARD"])
    from_fare = max(Decimal("0.00"), ((Decimal(str(fare_estimate_xaf)) - base_fare_xaf) / per_km_xaf).quantize(Decimal("0.01")))
    if pickup_coords and dropoff_coords and pickup_coords[0] is not None and dropoff_coords[0] is not None:
        from geo.services import haversine_distance_km
        floor = Decimal(haversine_distance_km(pickup_coords[0], pickup_coords[1], dropoff_coords[0], dropoff_coords[1])).quantize(Decimal("0.01"))
        return max(from_fare, floor)
    return from_fare


def request_ride(*, rider, pickup_description, dropoff_description, fare_estimate_xaf, pickup_coords=None, dropoff_coords=None,
                  ride_category="STANDARD", transport_type="PASSENGER", has_luggage=False, cargo_description="", distance_km=None,
                  luggage_count=None, luggage_size="", luggage_photo_urls=None):
    from .models import RideBooking
    pickup_lat, pickup_lon = pickup_coords or (None, None)
    dropoff_lat, dropoff_lon = dropoff_coords or (None, None)
    if distance_km is None:
        distance_km = infer_ride_distance_km(
            fare_estimate_xaf=fare_estimate_xaf, ride_category=ride_category,
            pickup_coords=pickup_coords, dropoff_coords=dropoff_coords,
        )
    ride = RideBooking.objects.create(
        rider=rider, pickup_description=pickup_description, dropoff_description=dropoff_description,
        fare_estimate_xaf=fare_estimate_xaf, distance_km=distance_km,
        pickup_latitude=pickup_lat, pickup_longitude=pickup_lon,
        dropoff_latitude=dropoff_lat, dropoff_longitude=dropoff_lon,
        ride_category=ride_category, transport_type=transport_type, has_luggage=has_luggage, cargo_description=cargo_description,
        luggage_count=luggage_count if has_luggage else None, luggage_size=luggage_size if has_luggage else "",
        luggage_photo_urls=list(luggage_photo_urls or [])[:3] if has_luggage else [],
    )
    dispatch_ride(ride)
    ride.refresh_from_db()
    return ride


class NotARegisteredDriverError(Exception):
    pass


class RideStateError(Exception):
    pass


# A ride request nobody accepted within this long is stale and gets cancelled.
STALE_RIDE_HOURS = 1


def quote_ride(*, pickup_coords, dropoff_coords):
    """The road route between the rider's two map points and the fare for every vehicle category. A booking
    uses the same (cached) route, so the fare a rider is quoted is the fare they're charged."""
    route = driving_route(pickup_coords, dropoff_coords)
    fares = {category: estimate_ride_fare(distance_km=route.distance_km, ride_category=category) for category in RIDE_CATEGORY_RATES}
    return route, fares


def _notify_ride(recipient, title: str, message: str, ride, notification_type: str = "RIDE_UPDATE"):
    from notifications.services import notify
    notify(recipient=recipient, notification_type=notification_type, title=title, message=message, related_reference=str(ride.id))


def cancel_ride(*, ride, rider, reason="", note=""):
    """The rider backs out before the trip starts, optionally saying why; the driver is told the reason."""
    from django.utils import timezone
    from .models import RideBooking, RideStatus, RideCancelReason
    if ride.rider_id != rider.id:
        raise NotPartyToRideError("Only the rider can cancel this ride.")
    updated = RideBooking.objects.filter(pk=ride.pk, status__in=[RideStatus.REQUESTED, RideStatus.ACCEPTED]).update(
        status=RideStatus.CANCELLED, cancelled_at=timezone.now(), cancellation_reason=reason, cancellation_note=note,
    )
    if not updated:
        raise RideStateError("This ride can no longer be cancelled.")
    _close_offers(ride)
    driver = ride.driver
    ride.refresh_from_db()
    if driver is not None:
        message = "The rider cancelled this ride before it started."
        if reason:
            message += f" Reason: {RideCancelReason(reason).label}."
        if note:
            message += f" \"{note}\""
        _notify_ride(driver, "The rider cancelled", message, ride)
    return ride


def release_ride(*, ride, driver, reason="", note=""):
    """The driver pulls out before the trip starts, optionally saying why; the request goes back to open drivers
    and the rider is told the reason."""
    from .models import RideBooking, RideStatus, RideReleaseReason
    if ride.driver_id != driver.id:
        raise NotPartyToRideError("Only the assigned driver can release this ride.")
    updated = RideBooking.objects.filter(pk=ride.pk, driver=driver, status=RideStatus.ACCEPTED).update(
        driver=None, vehicle=None, status=RideStatus.REQUESTED, release_reason=reason, release_note=note,
    )
    if not updated:
        raise RideStateError("This ride has already started or is no longer assigned to you.")
    restart_matching(ride, excluding_driver=driver)
    ride.refresh_from_db()
    message = "Your request is open to other drivers again."
    if reason:
        message = f"Reason: {RideReleaseReason(reason).label}. " + message
    if note:
        message = f"\"{note}\" " + message
    _notify_ride(ride.rider, "Your driver pulled out", message, ride)
    return ride


SOS_REPEAT_SECONDS = 60


def raise_sos(*, ride, user, latitude=None, longitude=None, note=""):
    """The rider or the driver asks for help during a trip. Records who raised it and when, alerts every admin
    with the route, the people involved and, when given, the sender's location, and texts the sender's own
    emergency contact if they set one. Pressing again within a minute does not alert twice.
    Returns (admins alerted, emergency contact result). The contact result is None when they have no contact,
    otherwise {name, phone, status} where status is "sent", "not_delivered" (no real SMS provider is connected,
    so nothing was texted) or "failed". (0, None) on a repeat press."""
    from datetime import timedelta
    from django.utils import timezone
    from identity.models import User
    from .models import RideBooking, RideStatus

    if user.id not in (ride.rider_id, ride.driver_id):
        raise NotPartyToRideError("Only the rider or the assigned driver can raise an SOS on this ride.")
    if ride.status not in (RideStatus.ACCEPTED, RideStatus.IN_PROGRESS):
        raise RideStateError("SOS is only available while a ride is accepted or in progress.")

    now = timezone.now()
    if ride.sos_raised_by_id == user.id and ride.sos_raised_at and now - ride.sos_raised_at < timedelta(seconds=SOS_REPEAT_SECONDS):
        return 0, None
    RideBooking.objects.filter(pk=ride.pk).update(
        sos_raised_at=now, sos_raised_by=user, sos_latitude=latitude, sos_longitude=longitude, sos_note=note,
        sos_resolved_at=None, sos_resolved_by=None,
    )
    ride.refresh_from_db()

    vehicle = ride.vehicle
    lines = [
        f"{user.full_name or user.username} ({user.phone}) raised an SOS on a ride.",
        f"Route: {ride.pickup_description} → {ride.dropoff_description}.",
        f"Rider: {ride.rider.full_name or ride.rider.username} ({ride.rider.phone}).",
    ]
    if ride.driver is not None:
        lines.append(f"Driver: {ride.driver.full_name or ride.driver.username} ({ride.driver.phone}).")
    if vehicle is not None:
        lines.append(f"Vehicle: {vehicle.make} {vehicle.model}, plate {vehicle.plate_number}.")
    if latitude is not None and longitude is not None:
        lines.append(f"Location: https://www.google.com/maps?q={latitude},{longitude}")
    if note:
        lines.append(f"Note: {note}")

    from notifications.services import notify, is_delivery_live

    contact_result = None
    contact = getattr(user, "ride_emergency_contact", None)
    if contact is not None:
        who = user.full_name or user.username
        to_contact = [f"{who} pressed SOS on an OaziGo ride.", f"Route: {ride.pickup_description} → {ride.dropoff_description}."]
        if ride.driver is not None and user.id == ride.rider_id:
            to_contact.append(f"Driver: {ride.driver.full_name or ride.driver.username}.")
        if vehicle is not None:
            to_contact.append(f"Vehicle: {vehicle.make} {vehicle.model}, plate {vehicle.plate_number}.")
        if latitude is not None and longitude is not None:
            to_contact.append(f"Location: https://www.google.com/maps?q={latitude},{longitude}")
        if note:
            to_contact.append(f"Note: {note}")
        to_contact.append(f"Try calling them on {user.phone}, or contact local emergency services.")
        # "sent" only when a real SMS provider carried it; the sandbox stand-in records the message but sends nothing.
        delivery = "not_delivered"
        try:
            notify(
                external_phone_number=contact.phone, notification_type="RIDE_SOS", title="SOS from someone who listed you as a contact",
                message=" ".join(to_contact), channel="SMS", related_reference=str(ride.id),
            )
            delivery = "sent" if is_delivery_live("SMS") else "not_delivered"
        except Exception:
            # A failing SMS provider must never stop the admins from being alerted.
            delivery = "failed"
            logger.exception("Could not alert the emergency contact for ride %s", ride.id)
        contact_result = {"name": contact.name, "phone": contact.phone, "status": delivery}
        if delivery != "sent":
            reason = "the SMS provider failed" if delivery == "failed" else "SMS delivery is not connected on this server"
            lines.append(f"Emergency contact {contact.name} ({contact.phone}) was NOT texted because {reason}. Please call them.")

    admins = list(User.objects.filter(admin_profile__isnull=False))
    for admin in admins:
        notify(recipient=admin, notification_type="RIDE_SOS", title="SOS on an OaziGo ride", message=" ".join(lines), related_reference=str(ride.id))
    return len(admins), contact_result


def expire_stale_rides(*, max_age_hours: int = STALE_RIDE_HOURS, now=None) -> list:
    """Cancels ride requests nobody accepted in time and tells the rider. Meant to run on a schedule."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import RideBooking, RideStatus, RideCancelReason
    now = now or timezone.now()
    expired = []
    for ride in RideBooking.objects.filter(status=RideStatus.REQUESTED, requested_at__lt=now - timedelta(hours=max_age_hours)).select_related("rider"):
        if RideBooking.objects.filter(pk=ride.pk, status=RideStatus.REQUESTED).update(
            status=RideStatus.CANCELLED, cancelled_at=now, cancellation_reason=RideCancelReason.NO_DRIVER_FOUND,
        ):
            _close_offers(ride)
            _notify_ride(ride.rider, "No driver found", "Your ride request expired because no driver accepted it. You can request again.", ride)
            expired.append(ride)
    return expired


class DriverNotVerifiedError(Exception):
    pass


# An accepted trip that still hasn't started this long after it was requested is dropped, and a trip that has been
# in progress this long without its fare being paid is closed. Requests expire after STALE_RIDE_HOURS, so an accepted
# trip has always been accepted at least (STALE_ACCEPTED_RIDE_HOURS - STALE_RIDE_HOURS) hours before it is dropped.
STALE_ACCEPTED_RIDE_HOURS = 3
STALE_IN_PROGRESS_RIDE_HOURS = 12
# Marks the report that closing an unpaid trip files for the team. While one is open the rider can't book again.
UNPAID_FARE_REPORT_PREFIX = "Automatic report: "


def close_stuck_rides(*, now=None) -> dict:
    """Closes trips that can never finish on their own, so nobody is left blocked by them. Meant to run on a schedule.

    - Accepted but never started: cancelled, both sides told.
    - In progress for too long with no fare paid: cancelled as abandoned, and an unpaid-fare report is filed for the
      team in the driver's name. The rider can't book again until the team resolves it. A fare that still arrives
      later goes straight back to the rider's wallet (see confirm_ride_after_payment)."""
    from datetime import timedelta
    from django.db import IntegrityError, transaction
    from django.utils import timezone
    from identity.models import User
    from notifications.services import notify
    from .models import RideBooking, RideCancelReason, RideIssueCategory, RideIssueReport, RideStatus

    now = now or timezone.now()
    never_started, abandoned = [], []

    for ride in RideBooking.objects.filter(status=RideStatus.ACCEPTED, requested_at__lt=now - timedelta(hours=STALE_ACCEPTED_RIDE_HOURS)).select_related("rider", "driver"):
        if RideBooking.objects.filter(pk=ride.pk, status=RideStatus.ACCEPTED).update(
            status=RideStatus.CANCELLED, cancelled_at=now, cancellation_reason=RideCancelReason.TRIP_NEVER_STARTED,
        ):
            never_started.append(ride)
            _notify_ride(ride.rider, "Your trip was cancelled", "The trip never started, so it was cancelled automatically. You can request again.", ride)
            if ride.driver is not None:
                _notify_ride(ride.driver, "The trip was cancelled", "The trip never started, so it was cancelled automatically and you are free to take other trips.", ride)

    for ride in RideBooking.objects.filter(status=RideStatus.IN_PROGRESS, requested_at__lt=now - timedelta(hours=STALE_IN_PROGRESS_RIDE_HOURS)).select_related("rider", "driver"):
        # A payment still waiting for the rider's approval is not abandoned.
        if ride_payment_pending(ride):
            continue
        if not RideBooking.objects.filter(pk=ride.pk, status=RideStatus.IN_PROGRESS).update(
            status=RideStatus.CANCELLED, cancelled_at=now, cancellation_reason=RideCancelReason.TRIP_ABANDONED,
        ):
            continue
        abandoned.append(ride)
        description = (
            f"{UNPAID_FARE_REPORT_PREFIX}this trip was in progress for over {STALE_IN_PROGRESS_RIDE_HOURS} hours and its fare of "
            f"{ride.fare_estimate_xaf:.0f} XAF was never paid, so it was closed."
        )
        if ride.driver is not None:
            try:
                with transaction.atomic():
                    RideIssueReport.objects.create(ride=ride, reported_by=ride.driver, category=RideIssueCategory.FARE, description=description)
            except IntegrityError:
                pass
            _notify_ride(ride.driver, "The trip was closed", "The trip was never completed or paid, so it was closed. The Oaziland team will follow up on the fare.", ride)
        _notify_ride(ride.rider, "Your trip was closed", "Your trip was never completed or paid, so it was closed. The fare is still due: contact support to settle it before you book again.", ride)
        for admin in User.objects.filter(admin_profile__isnull=False):
            notify(recipient=admin, notification_type="RIDE_ISSUE", title="A ride fare was never paid", message=f"{ride.pickup_description} → {ride.dropoff_description}: {description}", related_reference=str(ride.id))

    return {"never_started": never_started, "abandoned": abandoned}


def rider_has_unpaid_fare(user) -> bool:
    """True while the team still has an open report for a trip of this rider that was closed unpaid."""
    from .models import RideIssueReport, RideIssueStatus
    return RideIssueReport.objects.filter(
        ride__rider=user, status=RideIssueStatus.OPEN, description__startswith=UNPAID_FARE_REPORT_PREFIX,
    ).exists()


def rider_active_ride(user):
    """The rider's trip that is still going (being matched, on its way, or under way), if any."""
    from .models import RideBooking, RideStatus
    return RideBooking.objects.filter(rider=user, status__in=[RideStatus.REQUESTED, RideStatus.ACCEPTED, RideStatus.IN_PROGRESS]).first()


class VehicleCategoryMismatchError(Exception):
    pass


def register_as_driver(*, user, license_number: str):
    """The real gap this closes: previously ANY signed-in user could
    accept a ride and become its driver — no registration, no
    vetting, at all. Starts unverified, matching the exact same
    admin-review posture already built for Hotel/Venue this session —
    see AdminDriverViewSet.verify for the admin side."""
    from .models import DriverProfile
    driver_profile, _ = DriverProfile.objects.get_or_create(user=user, defaults={"license_number": license_number})
    return driver_profile


def register_vehicle(*, driver_profile, vehicle_category: str, make: str, model: str, plate_number: str):
    from .models import Vehicle
    return Vehicle.objects.create(driver=driver_profile, vehicle_category=vehicle_category, make=make, model=model, plate_number=plate_number)


def accept_ride(*, ride, driver, vehicle):
    """The real gap this closes: accepting a ride previously required
    nothing more than being signed in. Now requires a real, admin-
    verified DriverProfile AND a specific registered Vehicle whose
    category genuinely matches what the ride needs — a moto can't
    fulfill a request that needs a van or truck, and a passenger-
    registered driver can't show up with the wrong vehicle for a
    cargo job."""
    from .models import RideStatus, TransportType, RideCategory

    if not hasattr(driver, "driver_profile"):
        raise NotARegisteredDriverError("You must register as a driver before accepting a ride.")
    if not driver.driver_profile.is_verified:
        raise DriverNotVerifiedError("Your driver registration is still awaiting verification.")
    if vehicle.driver_id != driver.driver_profile.id:
        raise VehicleCategoryMismatchError("That vehicle is not registered to you.")

    if ride.transport_type == TransportType.CARGO:
        if vehicle.vehicle_category not in (RideCategory.VAN, RideCategory.TRUCK):
            raise VehicleCategoryMismatchError("A cargo request needs a van or truck.")
    elif vehicle.vehicle_category != ride.ride_category:
        raise VehicleCategoryMismatchError(f"This ride requested a {ride.ride_category.title()} vehicle.")

    ride.driver = driver
    ride.vehicle = vehicle
    ride.status = RideStatus.ACCEPTED
    ride.release_reason = ""
    ride.release_note = ""
    # Conditional update so two drivers accepting at the same moment can't both win.
    from .models import RideBooking
    taken = RideBooking.objects.filter(pk=ride.pk, status=RideStatus.REQUESTED).update(
        driver=driver, vehicle=vehicle, status=RideStatus.ACCEPTED, release_reason="", release_note="",
    )
    if not taken:
        raise RideStateError("This ride is no longer available to accept.")
    _close_offers(ride, accepted_by=driver)
    return ride


LOCATION_FRESH_SECONDS = 600
AVERAGE_SPEED_KMH = 25
ROAD_FACTOR = Decimal("1.3")
DEFAULT_NEARBY_RADIUS_KM = 10


def update_driver_location(*, driver_profile, latitude=None, longitude=None, is_online=None):
    """Stores the driver's latest position and/or online state. Position updates are accepted
    whether or not the driver is online, so a rider keeps seeing the car during a trip."""
    from django.utils import timezone
    fields = []
    if latitude is not None and longitude is not None:
        driver_profile.last_latitude = latitude
        driver_profile.last_longitude = longitude
        driver_profile.last_seen_at = timezone.now()
        fields += ["last_latitude", "last_longitude", "last_seen_at"]
    if is_online is not None:
        driver_profile.is_online = is_online
        fields.append("is_online")
    if fields:
        driver_profile.save(update_fields=fields)
    return driver_profile


def _driver_position(driver_profile):
    """(lat, lon) when the driver reported a position recently, else None."""
    from django.utils import timezone
    from datetime import timedelta
    if driver_profile.last_latitude is None or driver_profile.last_longitude is None or driver_profile.last_seen_at is None:
        return None
    if timezone.now() - driver_profile.last_seen_at > timedelta(seconds=LOCATION_FRESH_SECONDS):
        return None
    return driver_profile.last_latitude, driver_profile.last_longitude


def _vehicle_can_serve(category: str, ride) -> bool:
    from .models import TransportType, RideCategory
    if ride.transport_type == TransportType.CARGO:
        return category in (RideCategory.VAN, RideCategory.TRUCK)
    return category == ride.ride_category


def open_rides_for_driver(*, driver_profile, radius_km=DEFAULT_NEARBY_RADIUS_KM):
    """Requests no nearby driver took during matching, that this driver can actually take: at least one of
    their vehicles fits the ride and, when their position is known and recent, the pickup is within radius_km.
    Nearest first; requests with no pickup point cannot be placed, so they are listed last without a distance.
    Returns (list of (ride, pickup_distance_km or None), whether the driver's position was used)."""
    from geo.services import haversine_distance_km
    from .models import RideBooking, RideStatus

    categories = set(driver_profile.vehicles.values_list("vehicle_category", flat=True))
    position = _driver_position(driver_profile)
    located, unlocated = [], []
    still_open = RideBooking.objects.filter(status=RideStatus.REQUESTED, matching_ended_at__isnull=False).exclude(rider=driver_profile.user)
    for ride in still_open.select_related("rider").order_by("-requested_at"):
        if not any(_vehicle_can_serve(c, ride) for c in categories):
            continue
        if position is None or ride.pickup_latitude is None or ride.pickup_longitude is None:
            unlocated.append((ride, None))
            continue
        distance = Decimal(haversine_distance_km(position[0], position[1], ride.pickup_latitude, ride.pickup_longitude))
        if distance <= Decimal(str(radius_km)):
            located.append((ride, distance.quantize(Decimal("0.1"))))
    located.sort(key=lambda pair: pair[1])
    return located + unlocated, position is not None


# ---------------------------------------------------------------------------
# Automatic matching: a new request is offered to the nearest suitable online driver, who has
# RIDE_OFFER_SECONDS to accept or decline before it moves on to the next-nearest. Yango doesn't
# publish its own timer; 15-45 s is usual for dispatch apps, and drivers' apps check every few seconds.
# Offers are moved along whenever a driver or rider app checks in (advance_ride_matching), so no
# background worker is needed.
# ---------------------------------------------------------------------------
RIDE_OFFER_SECONDS = 20
MATCHING_RADIUS_KM = 10


def _next_driver_for(ride, now):
    """(driver profile, pickup distance) of the nearest driver who could take this ride right now, or (None, None)."""
    from datetime import timedelta
    from geo.services import haversine_distance_km
    from .models import DriverProfile, RideBooking, RideOffer, RideOfferStatus, RideStatus

    if ride.pickup_latitude is None or ride.pickup_longitude is None:
        return None, None
    already_asked = RideOffer.objects.filter(ride=ride).values("driver_id")
    on_a_trip = RideBooking.objects.filter(status__in=[RideStatus.ACCEPTED, RideStatus.IN_PROGRESS], driver__isnull=False).values("driver_id")
    holding_an_offer = RideOffer.objects.filter(status=RideOfferStatus.OFFERED, expires_at__gt=now).values("driver_id")
    candidates = (
        DriverProfile.objects.filter(
            is_verified=True, is_online=True, last_seen_at__gte=now - timedelta(seconds=LOCATION_FRESH_SECONDS),
            last_latitude__isnull=False, last_longitude__isnull=False,
        )
        .exclude(user_id=ride.rider_id)
        .exclude(user_id__in=already_asked)
        .exclude(user_id__in=on_a_trip)
        .exclude(user_id__in=holding_an_offer)
        .prefetch_related("vehicles")
    )
    best, best_distance = None, None
    for profile in candidates:
        if not any(_vehicle_can_serve(v.vehicle_category, ride) for v in profile.vehicles.all()):
            continue
        distance = Decimal(haversine_distance_km(profile.last_latitude, profile.last_longitude, ride.pickup_latitude, ride.pickup_longitude))
        if distance <= MATCHING_RADIUS_KM and (best_distance is None or distance < best_distance):
            best, best_distance = profile, distance
    return best, (best_distance.quantize(Decimal("0.1")) if best_distance is not None else None)


def dispatch_ride(ride, *, now=None):
    """Moves one request's matching along: times out an unanswered offer and, when nobody holds the ride,
    offers it to the next-nearest suitable driver. With nobody left to ask, ends matching so the request
    is listed for every driver. Returns the live offer, or None."""
    from datetime import timedelta
    from django.db import transaction
    from django.utils import timezone
    from .models import RideBooking, RideOffer, RideOfferStatus, RideStatus

    now = now or timezone.now()
    with transaction.atomic():
        locked = RideBooking.objects.select_for_update().filter(pk=ride.pk).first()
        if locked is None or locked.status != RideStatus.REQUESTED or locked.matching_ended_at is not None:
            return None
        RideOffer.objects.filter(ride=locked, status=RideOfferStatus.OFFERED, expires_at__lte=now).update(
            status=RideOfferStatus.EXPIRED, responded_at=now,
        )
        live = RideOffer.objects.filter(ride=locked, status=RideOfferStatus.OFFERED).first()
        if live is not None:
            return live
        profile, distance = _next_driver_for(locked, now)
        if profile is None:
            locked.matching_ended_at = now
            locked.save(update_fields=["matching_ended_at"])
            return None
        offer = RideOffer.objects.create(
            ride=locked, driver=profile.user, pickup_distance_km=distance, expires_at=now + timedelta(seconds=RIDE_OFFER_SECONDS),
        )
    _notify_ride(
        profile.user, "New ride offer",
        f"{locked.pickup_description} → {locked.dropoff_description}, {distance} km from you. Accept within {RIDE_OFFER_SECONDS} seconds.",
        locked, notification_type="RIDE_OFFER",
    )
    return offer


def advance_ride_matching(*, now=None):
    """Moves every request that is still being matched along. Cheap enough to call on each app check-in."""
    from django.utils import timezone
    from .models import RideBooking, RideStatus
    now = now or timezone.now()
    for ride in RideBooking.objects.filter(status=RideStatus.REQUESTED, matching_ended_at__isnull=True):
        dispatch_ride(ride, now=now)


def current_offer_for(driver, *, now=None):
    """The offer this driver has to answer right now, if any."""
    from django.utils import timezone
    from .models import RideOffer, RideOfferStatus, RideStatus
    now = now or timezone.now()
    return (
        RideOffer.objects.filter(driver=driver, status=RideOfferStatus.OFFERED, expires_at__gt=now, ride__status=RideStatus.REQUESTED)
        .select_related("ride", "ride__rider")
        .first()
    )


def ensure_driver_may_take(ride, driver, *, now=None):
    """While a request is still being matched, only the driver it's offered to can accept it."""
    from django.utils import timezone
    from .models import RideOffer, RideOfferStatus
    now = now or timezone.now()
    dispatch_ride(ride, now=now)
    ride.refresh_from_db()
    if ride.matching_ended_at is not None:
        return
    if not RideOffer.objects.filter(ride=ride, driver=driver, status=RideOfferStatus.OFFERED, expires_at__gt=now).exists():
        raise RideOfferError("This request is being offered to another driver right now.")


class RideOfferError(Exception):
    pass


def decline_ride_offer(*, ride, driver, now=None):
    """The driver passes on the request; it moves straight on to the next-nearest driver."""
    from django.utils import timezone
    from .models import RideOffer, RideOfferStatus
    now = now or timezone.now()
    updated = RideOffer.objects.filter(ride=ride, driver=driver, status=RideOfferStatus.OFFERED).update(
        status=RideOfferStatus.DECLINED, responded_at=now,
    )
    if not updated:
        raise RideOfferError("You don't have an offer for this ride.")
    dispatch_ride(ride, now=now)


def _close_offers(ride, *, accepted_by=None):
    """Marks the accepting driver's offer accepted and withdraws any other open offer on the ride."""
    from django.utils import timezone
    from .models import RideOffer, RideOfferStatus
    now = timezone.now()
    open_offers = RideOffer.objects.filter(ride=ride, status=RideOfferStatus.OFFERED)
    if accepted_by is not None:
        open_offers.filter(driver=accepted_by).update(status=RideOfferStatus.ACCEPTED, responded_at=now)
    open_offers.update(status=RideOfferStatus.WITHDRAWN, responded_at=now)


def restart_matching(ride, *, excluding_driver):
    """After a driver pulls out of an accepted ride, matching starts again without them."""
    from django.utils import timezone
    from .models import RideBooking, RideOffer, RideOfferStatus
    now = timezone.now()
    RideOffer.objects.update_or_create(
        ride=ride, driver=excluding_driver,
        defaults={"status": RideOfferStatus.DECLINED, "responded_at": now, "expires_at": now},
    )
    RideBooking.objects.filter(pk=ride.pk).update(matching_ended_at=None)
    dispatch_ride(ride, now=now)


def ride_driver_tracking(*, ride, user):
    """Where the driver is right now, for the rider following their trip. None fields when no recent position."""
    from geo.services import haversine_distance_km
    from .models import RideStatus

    if user.id != ride.rider_id:
        raise NotPartyToRideError("Only the rider can follow the driver on this ride.")
    if ride.status not in (RideStatus.ACCEPTED, RideStatus.IN_PROGRESS) or ride.driver_id is None:
        raise RideStateError("The driver's position is only shared while a ride is accepted or in progress.")
    profile = ride.driver.driver_profile
    result = {"located": False, "latitude": None, "longitude": None, "updated_at": profile.last_seen_at,
              "heading_to": "pickup" if ride.status == RideStatus.ACCEPTED else "dropoff",
              "distance_km": None, "eta_minutes": None}
    position = _driver_position(profile)
    if position is None:
        return result
    result.update(located=True, latitude=position[0], longitude=position[1])
    target = (ride.pickup_latitude, ride.pickup_longitude) if ride.status == RideStatus.ACCEPTED else (ride.dropoff_latitude, ride.dropoff_longitude)
    if target[0] is not None and target[1] is not None:
        road_km = Decimal(haversine_distance_km(position[0], position[1], target[0], target[1])) * ROAD_FACTOR
        result["distance_km"] = road_km.quantize(Decimal("0.1"))
        result["eta_minutes"] = max(1, int((road_km / AVERAGE_SPEED_KMH * 60).to_integral_value(rounding="ROUND_CEILING")))
    return result


def start_ride(ride):
    from .models import RideStatus
    ride.status = RideStatus.IN_PROGRESS
    ride.save(update_fields=["status"])
    return ride


def complete_ride_with_payment(*, ride, lock_client, payment_gateway, phone_number: str):
    """Settles the fare through the EXACT SAME reservation/escrow flow
    as a property booking or a technician service request — proving a
    ride fare is never a parallel payment path. The sandbox gateway confirms at once and completes the ride; a real
    payment returns (booking, None) and the ride is completed later, when the provider's verified webhook confirms
    the money arrived (see confirm_ride_after_payment)."""
    from transactions.services import (
        reserve_booking, initiate_booking_payment, fail_payment, confirm_sandbox_payment, InventoryConflictError,
    )
    from transactions.models import BookingType
    from payments.gateways import confirms_instantly

    try:
        booking = reserve_booking(
            lock_client=lock_client, requester=ride.rider, booking_type=BookingType.RIDE,
            target_content_type="marketplace.RideBooking", target_id=ride.id,
            amount_xaf=ride.fare_estimate_xaf,
        )
    except InventoryConflictError:
        raise RideStateError("A payment for this ride is already in progress. Approve it on your phone.")
    debit = initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
    if not debit.success:
        fail_payment(lock_client=lock_client, booking=booking)
        raise RideStateError("The payment could not be started. Check the phone number and try again.")
    if not confirms_instantly(payment_gateway):
        return booking, None
    escrow = confirm_sandbox_payment(lock_client=lock_client, booking=booking, payment_gateway=payment_gateway)
    confirm_ride_after_payment(booking)
    ride.refresh_from_db()
    escrow.refresh_from_db()
    return booking, escrow


def ride_payment_pending(ride) -> bool:
    """True while the rider has started paying the fare and the provider has not confirmed it yet, so the app can keep
    showing 'approve on your phone' after a page reload instead of offering to pay a second time."""
    from django.db.models import Q
    from django.utils import timezone
    from transactions.models import Booking, BookingStatus, BookingType
    from .models import RideStatus

    if ride.status != RideStatus.IN_PROGRESS:
        return False
    return Booking.objects.filter(
        booking_type=BookingType.RIDE, target_content_type="marketplace.RideBooking", target_id=ride.id,
        status__in=[BookingStatus.PENDING, BookingStatus.PAYMENT_PROCESSING],
    ).filter(Q(hold_expires_at__isnull=True) | Q(hold_expires_at__gt=timezone.now())).exists()


def confirm_ride_after_payment(booking):
    """Runs once a ride's fare is confirmed (by the provider's webhook, or at once for the sandbox): the ride is
    completed and the fare released to the driver. A fare that arrives for a ride that is no longer in progress goes
    straight back to the rider's wallet. Safe to run twice."""
    from django.db import transaction
    from django.utils import timezone
    from transactions.models import EscrowStatus
    from transactions.services import complete_booking, settle_escrow
    from .models import RideBooking, RideStatus

    if booking.target_content_type != "marketplace.RideBooking":
        return None
    with transaction.atomic():
        ride = RideBooking.objects.select_for_update().filter(pk=booking.target_id).first()
        if ride is None or ride.booking_id == booking.id:
            return ride
        if ride.status != RideStatus.IN_PROGRESS or ride.booking_id is not None:
            escrow = getattr(booking, "escrow", None)
            if escrow is not None and escrow.status == EscrowStatus.HELD:
                settle_escrow(escrow=escrow, payer_amount_xaf=escrow.gross_amount_xaf, reference=f"ride #{ride.pk}")
            return ride
        ride.booking = booking
        ride.status = RideStatus.COMPLETED
        ride.completed_at = timezone.now()
        ride.save(update_fields=["booking", "status", "completed_at"])
    # WHY complete_booking(), not booking.complete(): the earlier version
    # only flipped the Booking's own status flag — the escrow stayed HELD
    # forever, meaning the driver was never actually paid. complete_booking()
    # is the one real function that both completes the booking AND
    # releases the escrow it's holding.
    complete_booking(booking=booking)
    return ride


class NotPartyToRideError(Exception):
    pass


def post_ride_message(*, ride, sender, text: str):
    from .models import RideMessage
    from notifications.services import notify

    if sender.id not in (ride.rider_id, ride.driver_id):
        raise NotPartyToRideError("Only the rider or the assigned driver can chat on this ride.")

    message = RideMessage.objects.create(ride=ride, sender=sender, text=text)
    other = ride.driver if sender.id == ride.rider_id else ride.rider
    if other is not None:
        notify(
            recipient=other,
            notification_type="RIDE_MESSAGE",
            title=f"New message from {sender.full_name or sender.username}",
            message=text[:100],
            related_reference=str(ride.id),
        )
    return message


# A trip can be reported for this long after it was requested.
RIDE_ISSUE_WINDOW_DAYS = 14


class RideIssueNotAllowedError(Exception):
    pass


def report_ride_issue(*, ride, user, category: str, description: str):
    """The rider or the assigned driver reports a problem with a trip; every admin is alerted.
    One open report per person per trip, and only for trips that actually got going or ended."""
    from datetime import timedelta
    from django.db import IntegrityError, transaction
    from django.utils import timezone
    from identity.models import User
    from notifications.services import notify
    from .models import RideIssueReport, RideIssueStatus, RideIssueCategory, RideStatus

    if user.id not in (ride.rider_id, ride.driver_id):
        raise NotPartyToRideError("Only the rider or the assigned driver can report a problem with this ride.")
    if ride.status == RideStatus.REQUESTED:
        raise RideIssueNotAllowedError("This ride hasn't been accepted yet. You can cancel it instead.")
    if timezone.now() - ride.requested_at > timedelta(days=RIDE_ISSUE_WINDOW_DAYS):
        raise RideIssueNotAllowedError(f"Problems can only be reported within {RIDE_ISSUE_WINDOW_DAYS} days of the ride.")
    if RideIssueReport.objects.filter(ride=ride, reported_by=user, status=RideIssueStatus.OPEN).exists():
        raise RideIssueNotAllowedError("You already reported a problem with this ride. Our team is looking into it.")
    try:
        with transaction.atomic():
            report = RideIssueReport.objects.create(ride=ride, reported_by=user, category=category, description=description)
    except IntegrityError:
        raise RideIssueNotAllowedError("You already reported a problem with this ride. Our team is looking into it.")

    who = "rider" if user.id == ride.rider_id else "driver"
    message = (
        f"The {who} {user.full_name or user.username} ({user.phone}) reported: {RideIssueCategory(category).label}. "
        f"Route: {ride.pickup_description} → {ride.dropoff_description}. \"{description[:200]}\""
    )
    for admin in User.objects.filter(admin_profile__isnull=False):
        notify(recipient=admin, notification_type="RIDE_ISSUE", title="A ride problem was reported", message=message, related_reference=str(ride.id))
    return report


def resolve_ride_issue(*, report, admin, notes: str):
    """An admin closes a ride problem report and the reporter is told the outcome."""
    from django.utils import timezone
    from .models import RideIssueStatus
    if report.status == RideIssueStatus.RESOLVED:
        raise RideIssueNotAllowedError("This report has already been resolved.")
    report.status = RideIssueStatus.RESOLVED
    report.resolved_at = timezone.now()
    report.resolved_by = admin
    report.resolution_notes = notes
    report.save(update_fields=["status", "resolved_at", "resolved_by", "resolution_notes"])
    _notify_ride(
        report.reported_by, "Your ride report was reviewed",
        notes or "The Oaziland team has reviewed the problem you reported with this ride.", report.ride,
    )
    return report


# ---------------------------------------------------------------------------
# Buying or renting a marketplace listing: the money waits in escrow until the
# buyer confirms they got what they paid for.
# ---------------------------------------------------------------------------
ORDER_AUTO_RELEASE_HOURS = 72
ORDER_SELLER_RESPONSE_DAYS = 7
# After a rental ends the seller has this long to claim the deposit before it goes back to the renter.
DEPOSIT_RETURN_GRACE_DAYS = 3
RENTAL_PRICE_BASES = ("RENT_NIGHTLY", "RENT_WEEKLY", "RENT_MONTHLY", "RENT_ANNUAL")


def is_rental(listing) -> bool:
    return listing.price_basis in RENTAL_PRICE_BASES


def _add_months(start, months: int):
    import calendar
    from datetime import date
    index = start.month - 1 + months
    year, month = start.year + index // 12, index % 12 + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


def rental_end_date(start, price_basis: str):
    """The date one rental period starting on `start` ends, for the listing's price basis."""
    from datetime import timedelta
    if price_basis == "RENT_NIGHTLY":
        return start + timedelta(days=1)
    if price_basis == "RENT_WEEKLY":
        return start + timedelta(days=7)
    if price_basis == "RENT_MONTHLY":
        return _add_months(start, 1)
    if price_basis == "RENT_ANNUAL":
        return _add_months(start, 12)
    raise ValueError(f"{price_basis} is not a rental price basis.")


class OrderError(Exception):
    pass


class ListingNotAvailableError(OrderError):
    pass


class OrderPaymentFailedError(OrderError):
    pass


class NotPartyToOrderError(OrderError):
    pass


def category_models():
    from .models import WarehouseListing, StoreListing, BusinessListing, CarListing, GoodsListing
    return {"warehouses": WarehouseListing, "stores": StoreListing, "businesses": BusinessListing, "cars": CarListing, "goods": GoodsListing}


def marketplace_summaries_for_ids(listing_ids) -> list[dict]:
    """Card-sized summaries for whichever of these ids are marketplace listings, so a saved-listings page can show
    them. Listings an admin removed are left out, matching what the detail page would show a visitor."""
    ids = list(listing_ids)
    summaries = []
    for category, model in category_models().items():
        rows = model.objects.filter(pk__in=ids, removed_by_moderation=False).select_related("quarter").prefetch_related("media")
        for listing in rows:
            photo = next((m for m in listing.media.all() if m.media_type == "PHOTO"), None)
            summaries.append({
                "id": str(listing.id), "category": category, "title": listing.title,
                "price_xaf": str(listing.price_xaf), "price_basis": listing.price_basis,
                "availability_status": listing.availability_status,
                "quarter_name": listing.quarter.name if listing.quarter else None,
                "photo_url": photo.file_url if photo else None,
            })
    return summaries


def _notify_order(recipient, title: str, message: str, order):
    from notifications.services import notify
    notify(recipient=recipient, notification_type="MARKETPLACE_ORDER", title=title, message=message, related_reference=str(order.id))


def _set_listing_status(listing_id, status: str):
    from .models import MarketplaceListingBase
    # A listing an admin took down stays hidden whatever happens to an order on it.
    MarketplaceListingBase.objects.filter(pk=listing_id, removed_by_moderation=False).update(availability_status=status)


def _set_order_listing_status(order, status: str):
    # A car booked for dates never took the listing off the market, so its order never changes the listing status.
    if order.booked_dates:
        return
    if _is_goods_stock_order(order):
        # Goods sell from stock: an order ending without a sale puts its units back; a completed sale only ends the
        # listing once nothing is left.
        if status == "AVAILABLE":
            _return_stock(order)
        else:
            from .models import GoodsListing
            GoodsListing.objects.filter(pk=order.listing_id, quantity=0, removed_by_moderation=False).update(availability_status=status)
        return
    _set_listing_status(order.listing_id, status)


def _is_goods_stock_order(order) -> bool:
    return order.price_breakdown.get("stock") is True if isinstance(order.price_breakdown, dict) else False


def _return_stock(order):
    """Puts an order's units back in stock, once. A listing that sold out on this order is offered again; one the
    seller paused or an admin took down stays as it is."""
    from django.db.models import F
    from .models import AvailabilityStatus, GoodsListing, MarketplaceOrder
    with db_transaction.atomic():
        units = MarketplaceOrder.objects.select_for_update().filter(pk=order.pk).values_list("stock_taken", flat=True).first() or 0
        if not units:
            return
        MarketplaceOrder.objects.filter(pk=order.pk).update(stock_taken=0)
        listing = GoodsListing.objects.select_for_update().filter(pk=order.listing_id).first()
        if listing is None:
            return
        sold_out = listing.quantity == 0
        variant = order.variant if order.variant_id else None
        if variant is not None:
            from .models import GoodsVariant
            GoodsVariant.objects.filter(pk=variant.pk).update(quantity=F("quantity") + units)
        # A variant the seller has since switched off no longer counts toward the listing's stock.
        if variant is None or variant.is_active:
            GoodsListing.objects.filter(pk=listing.pk).update(quantity=F("quantity") + units)
        else:
            units = 0
        if units and sold_out and not listing.removed_by_moderation and listing.availability_status != AvailabilityStatus.AVAILABLE:
            GoodsListing.objects.filter(pk=listing.pk).update(availability_status=AvailabilityStatus.AVAILABLE)
    order.stock_taken = 0


def _goods_delivery(listing, delivery: dict):
    """The checked delivery choice for a goods order: (method, fee, address)."""
    from .models import DeliveryMethod
    method = (delivery or {}).get("method") or ""
    address = ((delivery or {}).get("address") or "").strip()
    offered = {
        DeliveryMethod.PICKUP: (listing.pickup_available, Decimal("0")),
        DeliveryMethod.SELLER: (listing.seller_delivery, listing.seller_delivery_fee_xaf),
        DeliveryMethod.COURIER: (listing.courier_shipping, listing.courier_fee_xaf),
    }
    if not method:
        available = [m for m, (on, _) in offered.items() if on]
        if len(available) != 1:
            raise OrderError("Choose how you want to get the item.")
        method = available[0]
    if method not in offered or not offered[method][0]:
        raise OrderError("The seller doesn't offer that delivery option.")
    if method != DeliveryMethod.PICKUP and len(address) < 5:
        raise OrderError("Enter the delivery address.")
    return method, offered[method][1], address if method != DeliveryMethod.PICKUP else ""


def place_order(*, listing, buyer, lock_client, payment_gateway, phone_number: str, rental: dict = None,
                offer_id=None, delivery: dict = None, quantity: int = 1, coupon_code: str = "", variant_id=None):
    """Starts payment and reserves the listing until the provider confirms it by webhook. A car rented by the day
    needs `rental` (start_date, end_date, with_driver, delivery): only those days are reserved. offer_id pays the
    price agreed in an accepted offer; goods take a `delivery` choice (method, address) whose fee is added, may use
    a seller's coupon_code and, when the item has options, need a variant_id."""
    from .car_rentals import is_dated_car_rental
    from .offers import offer_for_checkout, reserving_offer, OfferError
    from .shops import ensure_not_on_vacation
    ensure_not_on_vacation(listing.lister_user_id)
    offer = None
    if offer_id:
        try:
            offer = offer_for_checkout(offer_id=offer_id, listing=listing, buyer=buyer)
        except OfferError as e:
            raise OrderError(str(e))
    if coupon_code and offer is not None:
        raise OrderError("A coupon can't be combined with an accepted offer.")
    if is_dated_car_rental(listing):
        return _place_dated_car_rental(
            car=listing, buyer=buyer, lock_client=lock_client, payment_gateway=payment_gateway,
            phone_number=phone_number, rental=rental or {}, offer=offer,
        )
    from django.db import transaction as db_transaction
    from transactions.services import reserve_booking, initiate_booking_payment, fail_payment, InventoryConflictError
    from transactions.models import BookingType
    from .models import MarketplaceListingBase, AvailabilityStatus, MarketplaceOrder, MarketplaceOrderStatus, GoodsListing

    if listing.lister_user_id == buyer.id:
        raise OrderError("You cannot buy your own listing.")
    holder = reserving_offer(listing)
    # Goods sell from stock, so an accepted offer keeps one unit for its buyer (see _place_goods_order), not the whole item.
    if holder is not None and holder.buyer_id != buyer.id and not isinstance(listing, GoodsListing):
        raise ListingNotAvailableError(f"This item is reserved for another buyer until {holder.pay_by:%d %b %H:%M}.")
    price = offer.agreed_amount_xaf if offer is not None else listing.current_price_xaf()
    method, delivery_fee, address = "", Decimal("0"), ""
    if coupon_code and not isinstance(listing, GoodsListing):
        raise OrderError("Coupons can only be used on goods.")
    if isinstance(listing, GoodsListing):
        from .variants import resolve_variant
        variant = resolve_variant(listing, variant_id)
        if variant is not None:
            if offer is not None:
                raise OrderError("Offers aren't available on items with options.")
            price = price + variant.price_delta_xaf
        elif variant_id:
            raise OrderError("That option isn't available any more.")
        method, delivery_fee, address = _goods_delivery(listing, delivery)
        return _place_goods_order(
            listing=listing, buyer=buyer, payment_gateway=payment_gateway, phone_number=phone_number, offer=offer,
            holder=holder, unit_price=price, quantity=quantity, method=method, delivery_fee=delivery_fee, address=address,
            coupon_code=coupon_code, variant=variant,
        )
    amount = price + delivery_fee
    # A rental deposit is paid in the same charge as the rent and held separately once the payment is confirmed.
    deposit_xaf = listing.security_deposit_xaf if is_rental(listing) else Decimal("0")
    # One conditional update decides who gets the listing when two buyers race for it.
    from .engagement import expiry_cutoff
    claimed = MarketplaceListingBase.objects.filter(
        pk=listing.pk, availability_status=AvailabilityStatus.AVAILABLE, renewed_at__gte=expiry_cutoff(),
    ).update(
        availability_status=AvailabilityStatus.UNDER_OFFER,
    )
    if not claimed:
        raise ListingNotAvailableError("This listing is no longer available.")

    booking = None
    try:
        booking = reserve_booking(
            lock_client=lock_client, requester=buyer, booking_type=BookingType.MARKETPLACE_ITEM,
            target_content_type=f"marketplace.{type(listing).__name__}", target_id=listing.pk,
            amount_xaf=amount + deposit_xaf,
        )
        debit = initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
        if not debit.success:
            fail_payment(lock_client=lock_client, booking=booking)
            raise OrderPaymentFailedError("The payment could not be completed. Please try again.")
        with db_transaction.atomic():
            order = MarketplaceOrder.objects.create(
                listing=listing, buyer=buyer, booking=booking, amount_xaf=amount, deposit_xaf=deposit_xaf,
                status=MarketplaceOrderStatus.PAYMENT_PENDING, offer=offer,
                delivery_method=method, delivery_fee_xaf=delivery_fee, delivery_address=address,
                price_breakdown={"price_xaf": str(price), "delivery_fee_xaf": str(delivery_fee)} if method or offer else {},
            )
    except InventoryConflictError as e:
        _set_listing_status(listing.pk, AvailabilityStatus.AVAILABLE)
        raise ListingNotAvailableError(str(e))
    except Exception:
        _set_listing_status(listing.pk, AvailabilityStatus.AVAILABLE)
        raise
    return order


def _place_goods_order(*, listing, buyer, payment_gateway, phone_number, offer, holder, unit_price, quantity,
                       method, delivery_fee, address, coupon_code: str = "", variant=None):
    """Buys `quantity` units of a goods listing. The units come out of stock under a row lock while the buyer pays,
    so several buyers can buy from the same stock at once but never more than is there; at 0 the listing is sold
    out. A failed or abandoned payment, a cancellation or a refund puts them back (see _return_stock)."""
    import uuid as uuid_module
    from django.utils import timezone
    from transactions.models import Booking, BookingStatus, BookingType
    from transactions.services import HOLD_TTL_SECONDS, initiate_booking_payment, fail_payment
    from transactions.locks import get_booking_lock_client
    from .engagement import expiry_cutoff
    from .models import AvailabilityStatus, GoodsListing, MarketplaceOrder, MarketplaceOrderStatus

    try:
        quantity = int(quantity or 1)
    except (TypeError, ValueError):
        quantity = 0
    if quantity < 1:
        raise OrderError("Choose how many you want to buy.")
    if offer is not None and quantity != 1:
        raise OrderError("An accepted offer is for one item. Buy more at the listed price in a separate order.")
    # An offer accepted for another buyer keeps one unit for them until they place their order, which takes its own
    # unit out of stock (counting the held unit as well then would reserve it twice).
    from .offers import _has_live_order
    held_for_other = 1 if holder is not None and holder.buyer_id != buyer.id and not _has_live_order(holder) else 0
    price = unit_price * quantity
    amount = price + delivery_fee
    with db_transaction.atomic():
        stock = GoodsListing.objects.select_for_update().filter(
            pk=listing.pk, availability_status=AvailabilityStatus.AVAILABLE, removed_by_moderation=False,
            renewed_at__gte=expiry_cutoff(),
        ).first()
        if stock is None or stock.quantity - held_for_other < 1:
            if stock is not None and held_for_other:
                raise ListingNotAvailableError(f"The last one is reserved for another buyer until {holder.pay_by:%d %b %H:%M}.")
            raise ListingNotAvailableError("This listing is no longer available.")
        if stock.quantity - held_for_other < quantity:
            left = stock.quantity - held_for_other
            raise ListingNotAvailableError(f"Only {left} left in stock. Lower the quantity.")
        stock.quantity -= quantity
        fields = ["quantity"]
        if stock.quantity == 0:
            stock.availability_status = AvailabilityStatus.UNDER_OFFER
            fields.append("availability_status")
        stock.save(update_fields=fields)
        if variant is not None:
            from .models import GoodsVariant
            chosen = GoodsVariant.objects.select_for_update().filter(pk=variant.pk, listing_id=listing.pk, is_active=True).first()
            if chosen is None:
                raise ListingNotAvailableError("That option isn't available any more.")
            if chosen.quantity < quantity:
                raise ListingNotAvailableError(f"Only {chosen.quantity} left in \"{chosen.label}\". Lower the quantity.")
            chosen.quantity -= quantity
            chosen.save(update_fields=["quantity"])
        coupon, discount = None, Decimal("0")
        if coupon_code:
            from .promotions import checked_coupon, redeem
            coupon, discount = checked_coupon(seller_id=listing.lister_user_id, code=coupon_code, buyer=buyer, subtotal=price)
            redeem(coupon)
            amount = price - discount + delivery_fee
        booking = Booking.objects.create(
            booking_type=BookingType.MARKETPLACE_ITEM, target_content_type="marketplace.GoodsListing", target_id=listing.pk,
            requester=buyer, status=BookingStatus.PENDING, amount_xaf=amount, idempotency_key=str(uuid_module.uuid4()),
            hold_expires_at=timezone.now() + timezone.timedelta(seconds=HOLD_TTL_SECONDS),
        )
        breakdown = {"stock": True, "unit_price_xaf": str(unit_price), "quantity": quantity, "price_xaf": str(price), "delivery_fee_xaf": str(delivery_fee)}
        if variant is not None:
            breakdown.update(variant_label=variant.label, sku=variant.sku)
        if coupon is not None:
            breakdown.update(discount_xaf=str(discount), coupon_code=coupon.code)
        order = MarketplaceOrder.objects.create(
            listing=listing, buyer=buyer, booking=booking, amount_xaf=amount, status=MarketplaceOrderStatus.PAYMENT_PENDING,
            offer=offer, delivery_method=method, delivery_fee_xaf=delivery_fee, delivery_address=address,
            quantity=quantity, stock_taken=quantity, price_breakdown=breakdown, coupon=coupon, discount_xaf=discount,
            variant=variant, variant_label=variant.label if variant is not None else "",
        )
    try:
        debit = initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
    except Exception:
        fail_payment(lock_client=get_booking_lock_client(), booking=booking)
        fail_marketplace_order_payment(booking=booking)
        raise
    if not debit.success:
        fail_payment(lock_client=get_booking_lock_client(), booking=booking)
        fail_marketplace_order_payment(booking=booking)
        raise OrderPaymentFailedError("The payment could not be completed. Please try again.")
    return order


def _place_dated_car_rental(*, car, buyer, lock_client, payment_gateway, phone_number: str, rental: dict, offer=None):
    """Books a car for chosen days. The booking lock on the car is held until the payment settles, so the
    calendar is re-checked after taking it: two renters can't both get overlapping days."""
    from django.db import transaction as db_transaction
    from transactions.services import reserve_booking, initiate_booking_payment, fail_payment, InventoryConflictError
    from transactions.models import BookingType
    from .models import AvailabilityStatus, MarketplaceOrder, MarketplaceOrderStatus
    from .car_rentals import quote_car_rental, breakdown_for_storage, CarRentalError

    if car.lister_user_id == buyer.id:
        raise OrderError("You cannot rent your own car.")
    if car.availability_status != AvailabilityStatus.AVAILABLE or car.removed_by_moderation:
        raise ListingNotAvailableError("This car is not available for rent right now.")
    from .engagement import is_expired
    if is_expired(car):
        raise ListingNotAvailableError("This listing has expired. Ask the owner to renew it.")
    if not rental.get("start_date") or not rental.get("end_date"):
        raise OrderError("Choose the days you want to rent the car.")

    def quote():
        try:
            return quote_car_rental(
                car, start=rental["start_date"], end=rental["end_date"],
                with_driver=bool(rental.get("with_driver")), delivery=bool(rental.get("delivery")),
                daily_rate=offer.agreed_amount_xaf if offer is not None else None,
            )
        except CarRentalError as e:
            raise OrderError(str(e))

    priced = quote()
    try:
        booking = reserve_booking(
            lock_client=lock_client, requester=buyer, booking_type=BookingType.MARKETPLACE_ITEM,
            target_content_type="marketplace.CarListing", target_id=car.pk, amount_xaf=priced["total_xaf"],
        )
    except InventoryConflictError:
        raise ListingNotAvailableError("Someone else is booking this car right now. Try again in a few minutes.")
    try:
        priced = quote()
    except OrderError:
        fail_payment(lock_client=lock_client, booking=booking)
        raise ListingNotAvailableError("Those days were just booked by someone else. Pick other dates.")
    debit = initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
    if not debit.success:
        fail_payment(lock_client=lock_client, booking=booking)
        raise OrderPaymentFailedError("The payment could not be completed. Please try again.")
    with db_transaction.atomic():
        return MarketplaceOrder.objects.create(
            listing=car, buyer=buyer, booking=booking, amount_xaf=priced["rent_total_xaf"], deposit_xaf=priced["deposit_xaf"],
            status=MarketplaceOrderStatus.PAYMENT_PENDING, booked_dates=True,
            rental_starts_on=priced["start_date"], rental_ends_on=priced["end_date"], rental_days=priced["days"],
            with_driver=priced["with_driver"], delivery_requested=priced["delivery"], price_breakdown=breakdown_for_storage(priced),
            needs_approval=not car.instant_book, offer=offer,
        )


def _split_deposit(order):
    """Separates the deposit from the rent after one combined charge: the rent escrow keeps only the rent (and
    the platform fee on rent alone), and the deposit gets its own booking and escrow so it can be returned or
    paid to the seller independently. The rent booking keeps the amount actually charged."""
    from monetization.models import PlatformFeePolicy, TransactionCategory
    from transactions.models import Booking, BookingStatus, BookingType, PaymentEscrow, EscrowStatus
    from .models import MarketplaceOrder, DepositStatus

    rent_booking = order.booking
    rent_escrow = rent_booking.escrow
    fee = PlatformFeePolicy.fee_for(TransactionCategory.MARKETPLACE_SALE, order.amount_xaf)
    rent_escrow.gross_amount_xaf = order.amount_xaf
    rent_escrow.platform_fee_xaf = fee
    rent_escrow.payee_amount_xaf = order.amount_xaf - fee
    rent_escrow.save(update_fields=["gross_amount_xaf", "platform_fee_xaf", "payee_amount_xaf"])

    deposit_booking = Booking.objects.create(
        booking_type=BookingType.MARKETPLACE_ITEM, target_content_type=rent_booking.target_content_type,
        target_id=rent_booking.target_id, requester=order.buyer, status=BookingStatus.CONFIRMED,
        amount_xaf=order.deposit_xaf, idempotency_key=f"{rent_booking.idempotency_key}-deposit",
    )
    PaymentEscrow.objects.create(
        booking=deposit_booking, gross_amount_xaf=order.deposit_xaf, platform_fee_xaf=0, payee_amount_xaf=order.deposit_xaf,
        status=EscrowStatus.HELD, provider=rent_escrow.provider, provider_reference=f"{rent_escrow.provider_reference}-DEPOSIT",
    )
    MarketplaceOrder.objects.filter(pk=order.pk).update(deposit_booking=deposit_booking, deposit_status=DepositStatus.HELD)
    order.deposit_booking = deposit_booking
    order.deposit_status = DepositStatus.HELD


def confirm_marketplace_order_payment(*, booking):
    from django.db import transaction as db_transaction
    from .models import MarketplaceOrder, MarketplaceOrderStatus

    order = MarketplaceOrder.objects.select_related("listing__lister_user", "buyer", "booking").filter(booking=booking).first()
    if order is None or order.status != MarketplaceOrderStatus.PAYMENT_PENDING:
        return order
    with db_transaction.atomic():
        siblings = []
        updated = MarketplaceOrder.objects.filter(
            pk=order.pk, status=MarketplaceOrderStatus.PAYMENT_PENDING,
        ).update(status=MarketplaceOrderStatus.PAID)
        if updated and order.deposit_xaf > 0:
            _split_deposit(order)
        if updated and order.offer_id:
            from .models import MarketplaceOffer, OfferStatus
            MarketplaceOffer.objects.filter(pk=order.offer_id).update(status=OfferStatus.PAID)
        if updated and order.checkout_lead:
            from .cart import split_checkout
            siblings = split_checkout(order)
    if updated:
        order.status = MarketplaceOrderStatus.PAID
        for sibling in siblings:
            _notify_order(
                order.listing.lister_user, "New order on your listing",
                f"{order.buyer.full_name or order.buyer.username} paid {sibling.amount_xaf} XAF for \"{sibling.listing.title}\" "
                "in a cart order. Hand it over, then the payment is released once they confirm.",
                sibling,
            )
        if order.needs_approval:
            from .car_rentals import approval_deadline
            deadline = timezone_local_text(approval_deadline(order))
            _notify_order(
                order.listing.lister_user, "New booking request",
                f"{order.buyer.full_name or order.buyer.username} wants to rent \"{order.listing.title}\" from "
                f"{order.rental_starts_on} to {order.rental_ends_on} and has paid into escrow. Accept or decline before "
                f"{deadline}, otherwise the request expires and they are refunded.",
                order,
            )
            return order
        _notify_order(
            order.listing.lister_user,
            "New order on your listing",
            f"{order.buyer.full_name or order.buyer.username} paid {order.amount_xaf} XAF for "
            f"\"{order.listing.title}\"{f' ({order.variant_label})' if order.variant_label else ''}. Hand it over, then the payment is released once they confirm.",
            order,
        )
        _warn_low_stock(order)
    return order


LOW_STOCK_THRESHOLD = 3


def _warn_low_stock(order) -> None:
    """Tells the seller once when a paid sale takes a goods item (or one of its versions) down to the last few units."""
    if not _is_goods_stock_order(order):
        return
    from .models import GoodsListing, GoodsVariant
    listing = GoodsListing.objects.filter(pk=order.listing_id).first()
    if listing is None:
        return
    left, label = listing.quantity, ""
    if order.variant_id:
        variant = GoodsVariant.objects.filter(pk=order.variant_id).first()
        if variant is not None and variant.is_active:
            left, label = variant.quantity, f" ({variant.label})"
    # Only the sale that crosses the threshold warns, not every later one.
    if left > LOW_STOCK_THRESHOLD or left + order.quantity <= LOW_STOCK_THRESHOLD:
        return
    title = "An item sold out" if left == 0 else "Running low on stock"
    body = f"\"{listing.title}\"{label} has no units left." if left == 0 else f"Only {left} left of \"{listing.title}\"{label}. Restock it to keep selling."
    from notifications.services import notify
    notify(recipient=listing.lister_user, notification_type="LOW_STOCK", title=title, message=body, related_reference=str(listing.pk))


def fail_marketplace_order_payment(*, booking):
    from .models import MarketplaceOrder, MarketplaceOrderStatus, AvailabilityStatus

    order = MarketplaceOrder.objects.filter(booking=booking).first()
    if order is None or order.status != MarketplaceOrderStatus.PAYMENT_PENDING:
        return order
    # Only the request that actually cancels the order puts the listing (or its stock) back.
    if not MarketplaceOrder.objects.filter(pk=order.pk, status=MarketplaceOrderStatus.PAYMENT_PENDING).update(status=MarketplaceOrderStatus.CANCELLED):
        order.refresh_from_db()
        return order
    _set_order_listing_status(order, AvailabilityStatus.AVAILABLE)
    order.status = MarketplaceOrderStatus.CANCELLED
    # A coupon is counted once per payment, and a failed cart payment cancels every item bought with it.
    if order.coupon_id and (order.checkout_id is None or order.checkout_lead):
        from .promotions import release
        release(order)
    if order.checkout_lead:
        from .cart import cancel_checkout_siblings
        cancel_checkout_siblings(order)
    return order


def _require_buyer(order, user):
    if order.buyer_id != user.id:
        raise NotPartyToOrderError("Only the buyer can do this.")


def _require_seller(order, user):
    if order.listing.lister_user_id != user.id:
        raise NotPartyToOrderError("Only the seller can do this.")


def timezone_local_text(moment) -> str:
    from django.utils import timezone
    return timezone.localtime(moment).strftime("%d %b %Y %H:%M")


def approve_rental_request(*, order, seller):
    """The owner of a car without instant booking accepts a paid booking request; the dates are then confirmed."""
    from django.utils import timezone
    from .models import MarketplaceOrder, MarketplaceOrderStatus
    _require_seller(order, seller)
    updated = MarketplaceOrder.objects.filter(
        pk=order.pk, status=MarketplaceOrderStatus.PAID, needs_approval=True, owner_approved_at__isnull=True,
    ).update(owner_approved_at=timezone.now())
    if not updated:
        raise OrderError("There is no booking request waiting for your answer on this order.")
    order.refresh_from_db()
    _notify_order(
        order.buyer, "Your booking was accepted",
        f"The owner accepted your booking of \"{order.listing.title}\" from {order.rental_starts_on} to {order.rental_ends_on}.",
        order,
    )
    return order


def _escrow_is_held(order) -> bool:
    from transactions.models import EscrowStatus
    escrow = getattr(order.booking, "escrow", None)
    return escrow is not None and escrow.status == EscrowStatus.HELD


def mark_handed_over(*, order, seller):
    """The seller says the item (or space) has been handed over; the buyer then has a few days to confirm."""
    from django.utils import timezone
    from .models import MarketplaceOrder, MarketplaceOrderStatus
    _require_seller(order, seller)
    now = timezone.now()
    changes = {"status": MarketplaceOrderStatus.HANDED_OVER, "handed_over_at": now}
    if order.booked_dates:
        from datetime import timedelta
        from .car_rentals import EARLY_HANDOVER_DAYS, awaiting_approval
        if awaiting_approval(order):
            raise OrderError("Accept the booking request before handing the car over.")
        earliest = order.rental_starts_on - timedelta(days=EARLY_HANDOVER_DAYS)
        if timezone.localdate(now) < earliest:
            raise OrderError(f"The car can be handed over from {earliest.isoformat()}, the day before the rental starts.")
    elif is_rental(order.listing):
        # The rental runs for one period from the day it is handed over.
        start = timezone.localdate(now)
        changes.update(rental_starts_on=start, rental_ends_on=rental_end_date(start, order.listing.price_basis))
    updated = MarketplaceOrder.objects.filter(pk=order.pk, status=MarketplaceOrderStatus.PAID).update(**changes)
    if not updated:
        raise OrderError("This order cannot be marked as handed over.")
    order.refresh_from_db()
    _notify_order(
        order.buyer, "Your order was handed over",
        f"Confirm you received \"{order.listing.title}\" to release the payment, or report a problem. "
        f"If you do nothing, the payment is released automatically in {ORDER_AUTO_RELEASE_HOURS} hours.",
        order,
    )
    return order


def _claim_order(order, *, to_status, from_statuses, **changes):
    """Moves the order to to_status only if it is still in one of from_statuses, else raises OrderError. Run it in
    the same transaction as the money movement it guards: two concurrent settlements (a buyer confirming while the
    sweep auto-releases, a cancel racing a handover) can then never both pay out."""
    from .models import MarketplaceOrder
    if not MarketplaceOrder.objects.filter(pk=order.pk, status__in=from_statuses).update(status=to_status, **changes):
        raise OrderError("This order has changed in the meantime. Refresh and try again.")


def _release_to_seller(order, *, from_statuses=("PAID", "HANDED_OVER")):
    from django.utils import timezone
    from transactions.services import complete_booking
    from .models import MarketplaceOrderStatus, AvailabilityStatus
    with db_transaction.atomic():
        _claim_order(order, to_status=MarketplaceOrderStatus.COMPLETED, from_statuses=from_statuses, completed_at=timezone.now())
        complete_booking(booking=order.booking)
        _set_order_listing_status(order, AvailabilityStatus.UNAVAILABLE)
    order.refresh_from_db()


def _deposit_escrow(order):
    return getattr(order.deposit_booking, "escrow", None) if order.deposit_booking_id else None


def _return_deposit(order) -> bool:
    """Gives the held deposit back to the renter's Oaziland wallet. Returns False when there is no unsettled deposit
    to return."""
    from django.utils import timezone
    from transactions.models import EscrowStatus
    from .models import MarketplaceOrder, DepositStatus
    escrow = _deposit_escrow(order)
    if escrow is None or escrow.status not in (EscrowStatus.HELD, EscrowStatus.DISPUTED):
        return False
    with db_transaction.atomic():
        # Claiming the deposit first means a second, concurrent return finds nothing left to return.
        if not MarketplaceOrder.objects.filter(
            pk=order.pk, deposit_status__in=(DepositStatus.HELD, DepositStatus.CLAIMED),
        ).update(deposit_status=DepositStatus.RETURNED, deposit_settled_at=timezone.now()):
            return False
        from transactions.services import settle_escrow
        settle_escrow(escrow=escrow, payer_amount_xaf=escrow.gross_amount_xaf, reference=f"deposit, order #{order.pk}")
    order.deposit_status = DepositStatus.RETURNED
    return True


def _refund_to_buyer(order):
    """Refunds an order the seller hasn't handed over yet to the buyer's wallet (only a PAID order can be refunded this way)."""
    from transactions.services import settle_escrow
    from .models import MarketplaceOrderStatus, AvailabilityStatus
    with db_transaction.atomic():
        _claim_order(order, to_status=MarketplaceOrderStatus.CANCELLED, from_statuses=(MarketplaceOrderStatus.PAID,))
        escrow = order.booking.escrow
        # Back to the buyer's Oaziland wallet (settle_escrow also cancels the booking).
        settle_escrow(escrow=escrow, payer_amount_xaf=escrow.gross_amount_xaf, reference=f"order #{order.pk}")
        # A refunded rental also gives back the deposit that was paid with it.
        _return_deposit(order)
        _set_order_listing_status(order, AvailabilityStatus.AVAILABLE)
    order.refresh_from_db()


def _relist_after_rental(order) -> bool:
    """Puts a rented-out listing back on the market once its rental is over. It happens once per order, never
    overrides a moderation takedown, and waits if another order has since started on the same listing."""
    from django.utils import timezone
    from .models import MarketplaceListingBase, MarketplaceOrder, MarketplaceOrderStatus, AvailabilityStatus
    if order.rental_ends_on is None or order.relisted_at is not None:
        return False
    if order.booked_dates:
        # The car stayed listed for other dates the whole time, so there is nothing to put back.
        MarketplaceOrder.objects.filter(pk=order.pk).update(relisted_at=timezone.now())
        return False
    live = (
        MarketplaceOrderStatus.PAYMENT_PENDING, MarketplaceOrderStatus.PAID,
        MarketplaceOrderStatus.HANDED_OVER, MarketplaceOrderStatus.DISPUTED,
    )
    other_order_active = MarketplaceOrder.objects.filter(listing_id=order.listing_id, status__in=live).exclude(pk=order.pk).exists()
    relisted = not other_order_active and bool(MarketplaceListingBase.objects.filter(
        pk=order.listing_id, removed_by_moderation=False, availability_status=AvailabilityStatus.UNAVAILABLE,
    ).update(availability_status=AvailabilityStatus.AVAILABLE))
    MarketplaceOrder.objects.filter(pk=order.pk).update(relisted_at=timezone.now())
    if relisted:
        _notify_order(
            order.listing.lister_user, "Your listing is available again",
            f"The rental of \"{order.listing.title}\" has ended, so it is listed as available again. "
            "Change its status from My listings if you do not want that.",
            order,
        )
    return relisted


def _require_held_deposit(order):
    from transactions.models import EscrowStatus
    from .models import MarketplaceOrderStatus, DepositStatus
    escrow = _deposit_escrow(order)
    if (
        order.status != MarketplaceOrderStatus.COMPLETED or order.deposit_status != DepositStatus.HELD
        or escrow is None or escrow.status != EscrowStatus.HELD
    ):
        raise OrderError("There is no held deposit on this order.")
    return escrow


def return_deposit(*, order, seller):
    """The seller confirms the rental came back in good order; the deposit goes back to the renter."""
    _require_seller(order, seller)
    _require_held_deposit(order)
    if not _return_deposit(order):
        raise OrderError("There is no held deposit on this order.")
    _relist_after_rental(order)
    _notify_order(order.buyer, "Your deposit was returned", f"The seller confirmed the return of \"{order.listing.title}\". Your {order.deposit_xaf} XAF deposit was returned.", order)
    return order


def claim_deposit(*, order, seller, reason: str):
    """The seller reports a problem with the returned item; the deposit stays frozen until an admin decides."""
    from property_management.services import open_dispute
    from .models import MarketplaceOrder, DepositStatus
    _require_seller(order, seller)
    escrow = _require_held_deposit(order)
    with db_transaction.atomic():
        if not MarketplaceOrder.objects.filter(pk=order.pk, deposit_status=DepositStatus.HELD).update(deposit_status=DepositStatus.CLAIMED):
            raise OrderError("There is no held deposit on this order.")
        open_dispute(escrow=escrow, raised_by=seller, reason=reason)
    order.deposit_status = DepositStatus.CLAIMED
    _notify_order(order.buyer, "The seller claimed your deposit", "Support will review the claim and decide whether the deposit is returned to you or paid to the seller.", order)
    return order


def _resolve_deposit_dispute(order, payer_amount):
    """An admin's decision on a claimed deposit: payer_amount goes back to the renter's wallet and the rest to the
    seller (0 pays it all to the seller, the full deposit returns it all)."""
    from django.utils import timezone
    from transactions.services import complete_booking, settle_escrow
    from .models import MarketplaceOrder, DepositStatus
    if order.deposit_status != DepositStatus.CLAIMED:
        return order
    escrow = _deposit_escrow(order)
    with db_transaction.atomic():
        if payer_amount != 0 and payer_amount >= escrow.gross_amount_xaf:
            if not _return_deposit(order):
                return order
            status = DepositStatus.RETURNED
        else:
            status = DepositStatus.FORFEITED if payer_amount == 0 else DepositStatus.SPLIT
            # Claim the decision first so a repeated or concurrent resolution can't pay the deposit out twice.
            if not MarketplaceOrder.objects.filter(pk=order.pk, deposit_status=DepositStatus.CLAIMED).update(
                deposit_status=status, deposit_settled_at=timezone.now(),
            ):
                return order
            if payer_amount == 0:
                complete_booking(booking=order.deposit_booking)
            else:
                settle_escrow(escrow=escrow, payer_amount_xaf=payer_amount, reference=f"deposit, order #{order.pk}")
    _relist_after_rental(order)
    order.refresh_from_db()
    escrow.refresh_from_db()
    message = {
        DepositStatus.FORFEITED: "Support paid the deposit to the seller.",
        DepositStatus.RETURNED: "Support returned the deposit to the renter's Oaziland wallet.",
    }.get(status) or (
        f"Support split the deposit: {escrow.refunded_amount_xaf:.0f} XAF back to the renter's wallet, "
        f"{escrow.payee_amount_xaf:.0f} XAF to the seller's wallet (after the platform fee)."
    )
    for party in (order.buyer, order.listing.lister_user):
        _notify_order(party, "Support decision on the deposit", message, order)
    return order


def confirm_receipt(*, order, buyer):
    """The buyer confirms they got what they paid for; the payment is released to the seller."""
    from .models import MarketplaceOrderStatus
    _require_buyer(order, buyer)
    if order.status not in (MarketplaceOrderStatus.PAID, MarketplaceOrderStatus.HANDED_OVER) or not _escrow_is_held(order):
        raise OrderError("This order cannot be confirmed right now.")
    from .car_rentals import awaiting_approval
    if awaiting_approval(order):
        raise OrderError("The owner hasn't accepted this booking request yet.")
    _release_to_seller(order)
    _notify_order(order.listing.lister_user, "Payment released", f"The buyer confirmed \"{order.listing.title}\". {order.amount_xaf} XAF was released to your wallet (minus the platform fee).", order)
    return order


def cancel_order(*, order, buyer):
    """The buyer backs out before the seller has handed anything over; the money comes back in full. A car booked
    for dates is free to cancel until FREE_CANCELLATION_HOURS before it starts; after that the owner keeps one
    day's rent and the rest (with the whole deposit) goes back to the renter's wallet."""
    from transactions.services import settle_escrow
    from .models import MarketplaceOrder, MarketplaceOrderStatus
    from .car_rentals import late_cancellation_fee
    _require_buyer(order, buyer)
    if order.status != MarketplaceOrderStatus.PAID or not _escrow_is_held(order):
        raise OrderError("This order can no longer be cancelled. Report a problem if something went wrong.")
    fee = late_cancellation_fee(order)
    if fee > 0:
        payment = order.booking.escrow
        with db_transaction.atomic():
            _claim_order(order, to_status=MarketplaceOrderStatus.CANCELLED, from_statuses=(MarketplaceOrderStatus.PAID,))
            settle_escrow(escrow=payment, payer_amount_xaf=payment.gross_amount_xaf - fee, reference=f"late cancellation, order #{order.pk}")
            _return_deposit(order)
        order.refresh_from_db()
        _notify_order(order.buyer, "Rental cancelled", f"Your rental of \"{order.listing.title}\" was cancelled less than a day before it started, so one day's rent ({fee:.0f} XAF) went to the owner. The rest was returned to your Oaziland wallet.", order)
        _notify_order(order.listing.lister_user, "Rental cancelled", f"The renter cancelled \"{order.listing.title}\" late. One day's rent ({fee:.0f} XAF, minus the platform fee) was paid to your wallet.", order)
        return order
    _refund_to_buyer(order)
    _notify_order(order.listing.lister_user, "Order cancelled", f"The buyer cancelled their order for \"{order.listing.title}\". The listing is available again.", order)
    return order


def decline_order(*, order, seller):
    """The seller can't or won't go through with the sale; the buyer is refunded in full."""
    from .models import MarketplaceOrderStatus
    _require_seller(order, seller)
    if order.status != MarketplaceOrderStatus.PAID or not _escrow_is_held(order):
        raise OrderError("This order can no longer be declined.")
    _refund_to_buyer(order)
    _notify_order(order.buyer, "Your order was declined", f"The seller declined your order for \"{order.listing.title}\" and you were refunded in full to your Oaziland wallet.", order)
    return order


def dispute_order(*, order, user, reason: str):
    """Either side can raise a problem while the money is held; an admin then decides."""
    from property_management.services import open_dispute
    from .models import MarketplaceOrder, MarketplaceOrderStatus
    if user.id not in (order.buyer_id, order.listing.lister_user_id):
        raise NotPartyToOrderError("Only the buyer or the seller can report a problem.")
    if order.status not in (MarketplaceOrderStatus.PAID, MarketplaceOrderStatus.HANDED_OVER) or not _escrow_is_held(order):
        raise OrderError("A problem can only be reported while the payment is held in escrow.")
    with db_transaction.atomic():
        _claim_order(
            order, to_status=MarketplaceOrderStatus.DISPUTED,
            from_statuses=(MarketplaceOrderStatus.PAID, MarketplaceOrderStatus.HANDED_OVER),
        )
        open_dispute(escrow=order.booking.escrow, raised_by=user, reason=reason)
    order.refresh_from_db()
    other = order.listing.lister_user if user.id == order.buyer_id else order.buyer
    _notify_order(other, "A problem was reported", "Support will review this order and decide what happens to the payment.", order)
    return order


def _settle_held_order(order, payer_amount_xaf, *, from_statuses, reference: str = "") -> str:
    """Pays out an order's held payment: payer_amount_xaf back to the buyer (0 pays the seller in full, the full
    amount refunds and cancels the order). Returns "released", "refunded" or "split"; raises OrderError when the order
    is no longer in one of from_statuses."""
    from django.utils import timezone
    from transactions.services import settle_escrow
    from .models import MarketplaceOrderStatus, AvailabilityStatus
    payment = order.booking.escrow
    reference = reference or f"order #{order.pk}"
    if payer_amount_xaf == 0:
        _release_to_seller(order, from_statuses=from_statuses)
        return "released"
    if payer_amount_xaf >= payment.gross_amount_xaf:
        with db_transaction.atomic():
            _claim_order(order, to_status=MarketplaceOrderStatus.CANCELLED, from_statuses=from_statuses)
            settle_escrow(escrow=payment, payer_amount_xaf=payment.gross_amount_xaf, reference=reference)
            # A refunded rental also gives back the deposit that was paid with it.
            _return_deposit(order)
            _set_order_listing_status(order, AvailabilityStatus.AVAILABLE)
        return "refunded"
    with db_transaction.atomic():
        _claim_order(order, to_status=MarketplaceOrderStatus.COMPLETED, from_statuses=from_statuses, completed_at=timezone.now())
        settle_escrow(escrow=payment, payer_amount_xaf=payer_amount_xaf, reference=reference)
        _set_order_listing_status(order, AvailabilityStatus.UNAVAILABLE)
    payment.refresh_from_db()
    return "split"


def resolve_order_dispute(*, order, outcome: str = "", escrow=None, payer_amount_xaf=None):
    """Applies an admin's decision on a disputed order. payer_amount_xaf is what goes back to the buyer's wallet
    (0 pays the seller in full, the full amount refunds the order); when it is not given, outcome RELEASE or
    REFUND decides. When the disputed escrow is the order's rental deposit, only the deposit is decided."""
    from .models import MarketplaceOrderStatus
    if payer_amount_xaf is None:
        if outcome not in ("RELEASE", "REFUND"):
            raise ValueError("outcome must be 'RELEASE' or 'REFUND'")
        target = escrow if escrow is not None else order.booking.escrow
        payer_amount_xaf = 0 if outcome == "RELEASE" else target.gross_amount_xaf
    if escrow is not None and order.deposit_booking_id and escrow.booking_id == order.deposit_booking_id:
        return _resolve_deposit_dispute(order, payer_amount_xaf)
    if order.status in (MarketplaceOrderStatus.COMPLETED, MarketplaceOrderStatus.CANCELLED):
        return order
    payment = order.booking.escrow
    open_statuses = (MarketplaceOrderStatus.PAID, MarketplaceOrderStatus.HANDED_OVER, MarketplaceOrderStatus.DISPUTED)
    try:
        result = _settle_held_order(order, payer_amount_xaf, from_statuses=open_statuses)
    except OrderError:
        # Already settled by a concurrent request: nothing more to do.
        order.refresh_from_db()
        return order
    if result == "released":
        message = "Support released the payment to the seller."
    elif result == "refunded":
        message = "Support refunded the buyer in full to their Oaziland wallet."
    else:
        message = (
            f"Support split the payment: {payment.refunded_amount_xaf:.0f} XAF back to the buyer's wallet, "
            f"{payment.payee_amount_xaf:.0f} XAF to the seller's wallet (after the platform fee)."
        )
    order.refresh_from_db()
    for party in (order.buyer, order.listing.lister_user):
        _notify_order(party, "Support decision on your order", message, order)
    return order


def order_for_escrow(escrow):
    """The marketplace order behind an escrow (its payment or its rental deposit), or None for other bookings."""
    from .models import MarketplaceOrder
    return MarketplaceOrder.objects.filter(
        Q(booking=escrow.booking) | Q(deposit_booking=escrow.booking),
    ).select_related("listing__lister_user", "buyer").first()


def _sweep_step(order, action) -> bool:
    """Runs one order's step of the scheduled sweep. A step that fails (or that a concurrent request already did) is
    skipped and logged instead of aborting the sweep, so one bad order can't hold up every other refund or payout.
    False from the action also counts as "nothing done"."""
    try:
        return action() is not False
    except OrderError:
        return False
    except Exception:
        logger.exception("Marketplace sweep failed on order %s", order.pk)
        return False


def process_marketplace_orders(*, now=None) -> dict:
    """Scheduled sweep: refunds orders a seller never handed over within ORDER_SELLER_RESPONSE_DAYS, releases
    payment on orders handed over but never confirmed within ORDER_AUTO_RELEASE_HOURS, relists rented-out listings
    when the rental ends, and returns deposits the seller did not claim within DEPOSIT_RETURN_GRACE_DAYS.
    Disputed orders and claimed deposits are left alone."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import MarketplaceOrder, MarketplaceOrderStatus, DepositStatus
    now = now or timezone.now()
    today = timezone.localdate(now)
    refunded, released, expired, relisted, deposits_returned = [], [], [], [], []
    pending = MarketplaceOrder.objects.filter(
        status=MarketplaceOrderStatus.PAYMENT_PENDING,
        booking__hold_expires_at__lt=now,
    ).exclude(checkout__isnull=False, checkout_lead=False).select_related("booking")  # a cart's other items follow their lead order
    for order in pending:
        from transactions.services import fail_payment
        from transactions.locks import get_booking_lock_client

        def expire_payment(order=order):
            fail_payment(lock_client=get_booking_lock_client(), booking=order.booking)
            fail_marketplace_order_payment(booking=order.booking)
        if _sweep_step(order, expire_payment):
            expired.append(order)
    stale = MarketplaceOrder.objects.filter(
        status=MarketplaceOrderStatus.PAID, booked_dates=False, created_at__lt=now - timedelta(days=ORDER_SELLER_RESPONSE_DAYS),
    ).select_related("listing__lister_user", "buyer", "booking")
    from .car_rentals import HANDOVER_GRACE_DAYS
    stale = list(stale) + list(MarketplaceOrder.objects.filter(
        status=MarketplaceOrderStatus.PAID, booked_dates=True, rental_starts_on__lt=today - timedelta(days=HANDOVER_GRACE_DAYS),
    ).select_related("listing__lister_user", "buyer", "booking"))
    for order in stale:
        if _escrow_is_held(order):
            if not _sweep_step(order, lambda: _refund_to_buyer(order)):
                continue
            _notify_order(order.buyer, "Order refunded", f"The seller did not hand over \"{order.listing.title}\" in time, so you were refunded in full to your Oaziland wallet.", order)
            _notify_order(order.listing.lister_user, "Order cancelled", f"You did not hand over \"{order.listing.title}\" in time, so the order was cancelled and refunded.", order)
            refunded.append(order)
    from .car_rentals import approval_deadline
    unanswered = MarketplaceOrder.objects.filter(
        status=MarketplaceOrderStatus.PAID, needs_approval=True, owner_approved_at__isnull=True,
    ).select_related("listing__lister_user", "buyer", "booking")
    for order in unanswered:
        if approval_deadline(order) <= now and _escrow_is_held(order):
            if not _sweep_step(order, lambda: _refund_to_buyer(order)):
                continue
            _notify_order(order.buyer, "Booking request expired", f"The owner of \"{order.listing.title}\" did not answer your request in time, so you were refunded in full to your Oaziland wallet.", order)
            _notify_order(order.listing.lister_user, "Booking request expired", f"You did not answer the booking request for \"{order.listing.title}\" in time, so it expired and the renter was refunded.", order)
            refunded.append(order)
    overdue = MarketplaceOrder.objects.filter(
        status=MarketplaceOrderStatus.HANDED_OVER, handed_over_at__lt=now - timedelta(hours=ORDER_AUTO_RELEASE_HOURS),
    ).select_related("listing__lister_user", "buyer", "booking")
    from .fulfilment import auto_release_at, has_open_return
    for order in overdue:
        # A parcel still on its way, or a return request still open, keeps the payment held.
        if (auto_release_at(order) or now) > now or has_open_return(order):
            continue
        if _escrow_is_held(order):
            if not _sweep_step(order, lambda: _release_to_seller(order, from_statuses=(MarketplaceOrderStatus.HANDED_OVER,))):
                continue
            _notify_order(order.buyer, "Payment released", f"You did not respond within {ORDER_AUTO_RELEASE_HOURS} hours of the handover, so the payment was released to the seller.", order)
            _notify_order(order.listing.lister_user, "Payment released", f"The payment for \"{order.listing.title}\" was released to you automatically.", order)
            released.append(order)
    ended = MarketplaceOrder.objects.filter(
        status=MarketplaceOrderStatus.COMPLETED, rental_ends_on__lt=today, relisted_at__isnull=True,
    ).select_related("listing__lister_user", "buyer")
    for order in ended:
        if _sweep_step(order, lambda: _relist_after_rental(order)):
            relisted.append(order)
    unclaimed = MarketplaceOrder.objects.filter(
        status=MarketplaceOrderStatus.COMPLETED, deposit_status=DepositStatus.HELD,
        rental_ends_on__lt=today - timedelta(days=DEPOSIT_RETURN_GRACE_DAYS),
    ).select_related("listing__lister_user", "buyer", "deposit_booking")
    for order in unclaimed:
        if _sweep_step(order, lambda: _return_deposit(order)):
            _notify_order(order.buyer, "Your deposit was returned", f"The seller did not claim your {order.deposit_xaf} XAF deposit for \"{order.listing.title}\", so it was returned to your Oaziland wallet.", order)
            _notify_order(order.listing.lister_user, "Deposit returned to the renter", f"You did not claim the deposit for \"{order.listing.title}\" within {DEPOSIT_RETURN_GRACE_DAYS} days of the rental ending, so it was returned to the renter.", order)
            deposits_returned.append(order)
    return {"refunded": refunded, "released": released, "expired": expired, "relisted": relisted, "deposits_returned": deposits_returned}
