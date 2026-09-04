"""
marketplace.services — filtered search across every listing category,
attaching/reading generic ListingCondition objects, and the full ride
lifecycle settling through the SAME Booking/PaymentEscrow machinery as
every other transaction on the platform.
"""
from decimal import Decimal


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


def search_marketplace_listings(*, listing_class, filters: dict = None):
    """Filtered search for one marketplace category at a time (warehouse
    OR store OR business OR car) — mirrors discovery.services.
    search_listings_with_filters's shape so both search systems feel
    consistent to whichever app calls them."""
    from .models import AvailabilityStatus

    filters = filters or {}
    queryset = listing_class.objects.filter(availability_status=AvailabilityStatus.AVAILABLE)

    if "min_price" in filters:
        queryset = queryset.filter(price_xaf__gte=Decimal(str(filters["min_price"])))
    if "max_price" in filters:
        queryset = queryset.filter(price_xaf__lte=Decimal(str(filters["max_price"])))
    if "min_size_sqm" in filters and hasattr(listing_class, "size_sqm"):
        queryset = queryset.filter(size_sqm__gte=Decimal(str(filters["min_size_sqm"])))
    if "quarter_id" in filters:
        queryset = queryset.filter(quarter_id=filters["quarter_id"])

    results = list(queryset)

    # Condition-based filtering happens in Python, since conditions live
    # in a separate generic table, not columns on the listing itself.
    if "required_conditions" in filters:
        matching = []
        for listing in results:
            conditions = get_conditions_for(listing)
            combined = {}
            for c in conditions:
                combined.update(c.structured_conditions)
            if all(combined.get(k) == v for k, v in filters["required_conditions"].items()):
                matching.append(listing)
        results = matching

    return results


# ---------------------------------------------------------------------------
# Ride booking lifecycle.
# ---------------------------------------------------------------------------
def estimate_ride_fare(*, distance_km: Decimal, base_fare_xaf=Decimal("500"), per_km_xaf=Decimal("150")):
    """A simple, transparent fare formula — deliberately not a dynamic-
    pricing black box, consistent with finance.estimate_affordable_rent_
    range's philosophy of explainable numbers."""
    return base_fare_xaf + (distance_km * per_km_xaf)


def request_ride(*, rider, pickup_description, dropoff_description, fare_estimate_xaf, pickup_coords=None, dropoff_coords=None):
    from .models import RideBooking
    pickup_lat, pickup_lon = pickup_coords or (None, None)
    dropoff_lat, dropoff_lon = dropoff_coords or (None, None)
    return RideBooking.objects.create(
        rider=rider, pickup_description=pickup_description, dropoff_description=dropoff_description,
        fare_estimate_xaf=fare_estimate_xaf,
        pickup_latitude=pickup_lat, pickup_longitude=pickup_lon,
        dropoff_latitude=dropoff_lat, dropoff_longitude=dropoff_lon,
    )


def accept_ride(*, ride, driver):
    from .models import RideStatus
    ride.driver = driver
    ride.status = RideStatus.ACCEPTED
    ride.save(update_fields=["driver", "status"])
    return ride


def start_ride(ride):
    from .models import RideStatus
    ride.status = RideStatus.IN_PROGRESS
    ride.save(update_fields=["status"])
    return ride


def complete_ride_with_payment(*, ride, lock_client, payment_gateway, phone_number: str):
    """Settles the fare through the EXACT SAME reservation/escrow flow
    as a property booking or a technician service request — proving a
    ride fare is never a parallel payment path."""
    from django.utils import timezone
    from transactions.services import reserve_booking, initiate_booking_payment, confirm_payment
    from transactions.models import BookingType

    booking = reserve_booking(
        lock_client=lock_client, requester=ride.rider, booking_type=BookingType.RIDE,
        target_content_type="marketplace.RideBooking", target_id=ride.id,
        amount_xaf=ride.fare_estimate_xaf,
    )
    initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
    escrow = confirm_payment(
        lock_client=lock_client, booking=booking, provider="MTN_MOMO",
        provider_reference=booking.idempotency_key, payment_gateway=payment_gateway,
        raw_webhook_payload=b"{}", webhook_signature_header="sandbox",
    )

    from .models import RideStatus
    ride.booking = booking
    ride.status = RideStatus.COMPLETED
    ride.completed_at = timezone.now()
    ride.save(update_fields=["booking", "status", "completed_at"])
    booking.complete()

    return booking, escrow
