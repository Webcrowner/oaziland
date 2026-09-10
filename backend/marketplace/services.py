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
    return base_fare_xaf + (distance_km * per_km_xaf)


def request_ride(*, rider, pickup_description, dropoff_description, fare_estimate_xaf, pickup_coords=None, dropoff_coords=None,
                  ride_category="STANDARD", transport_type="PASSENGER", has_luggage=False, cargo_description=""):
    from .models import RideBooking
    pickup_lat, pickup_lon = pickup_coords or (None, None)
    dropoff_lat, dropoff_lon = dropoff_coords or (None, None)
    return RideBooking.objects.create(
        rider=rider, pickup_description=pickup_description, dropoff_description=dropoff_description,
        fare_estimate_xaf=fare_estimate_xaf,
        pickup_latitude=pickup_lat, pickup_longitude=pickup_lon,
        dropoff_latitude=dropoff_lat, dropoff_longitude=dropoff_lon,
        ride_category=ride_category, transport_type=transport_type, has_luggage=has_luggage, cargo_description=cargo_description,
    )


class NotARegisteredDriverError(Exception):
    pass


class DriverNotVerifiedError(Exception):
    pass


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
    ride.save(update_fields=["driver", "vehicle", "status"])
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
