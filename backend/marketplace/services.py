"""
marketplace.services — filtered search across every listing category,
attaching/reading generic ListingCondition objects, and the full ride
lifecycle settling through the SAME Booking/PaymentEscrow machinery as
every other transaction on the platform.
"""
import logging
from decimal import Decimal

from django.db.models import Q

logger = logging.getLogger(__name__)

LISTING_ORDERINGS = {
    "newest": ("-created_at",),
    "oldest": ("created_at",),
    "price_asc": ("price_xaf", "-created_at"),
    "price_desc": ("-price_xaf", "-created_at"),
}


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
    if filters.get("price_basis"):
        queryset = queryset.filter(price_basis=filters["price_basis"])
    if filters.get("q"):
        queryset = queryset.filter(Q(title__icontains=filters["q"]) | Q(description__icontains=filters["q"]))
    queryset = queryset.order_by(*LISTING_ORDERINGS[filters.get("ordering", "newest")])

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
                  ride_category="STANDARD", transport_type="PASSENGER", has_luggage=False, cargo_description="", distance_km=None):
    from .models import RideBooking
    pickup_lat, pickup_lon = pickup_coords or (None, None)
    dropoff_lat, dropoff_lon = dropoff_coords or (None, None)
    return RideBooking.objects.create(
        rider=rider, pickup_description=pickup_description, dropoff_description=dropoff_description,
        fare_estimate_xaf=fare_estimate_xaf, distance_km=distance_km,
        pickup_latitude=pickup_lat, pickup_longitude=pickup_lon,
        dropoff_latitude=dropoff_lat, dropoff_longitude=dropoff_lon,
        ride_category=ride_category, transport_type=transport_type, has_luggage=has_luggage, cargo_description=cargo_description,
    )


class NotARegisteredDriverError(Exception):
    pass


class RideStateError(Exception):
    pass


# A ride request nobody accepted within this long is stale and gets cancelled.
STALE_RIDE_HOURS = 1


def trusted_ride_distance_km(*, client_distance_km, pickup_coords=None, dropoff_coords=None):
    """The distance a fare is based on. The rider's own figure can never be lower than the
    straight-line distance between the two points they marked, so the fare can't be dodged by
    typing a tiny distance."""
    if pickup_coords and dropoff_coords:
        from geo.services import haversine_distance_km
        floor = haversine_distance_km(pickup_coords[0], pickup_coords[1], dropoff_coords[0], dropoff_coords[1])
        return max(Decimal(client_distance_km), Decimal(floor).quantize(Decimal("0.01")))
    return Decimal(client_distance_km)


def _notify_ride(recipient, title: str, message: str, ride):
    from notifications.services import notify
    notify(recipient=recipient, notification_type="RIDE_UPDATE", title=title, message=message, related_reference=str(ride.id))


def cancel_ride(*, ride, rider):
    """The rider backs out before the trip starts."""
    from .models import RideBooking, RideStatus
    if ride.rider_id != rider.id:
        raise NotPartyToRideError("Only the rider can cancel this ride.")
    updated = RideBooking.objects.filter(pk=ride.pk, status__in=[RideStatus.REQUESTED, RideStatus.ACCEPTED]).update(status=RideStatus.CANCELLED)
    if not updated:
        raise RideStateError("This ride can no longer be cancelled.")
    driver = ride.driver
    ride.refresh_from_db()
    if driver is not None:
        _notify_ride(driver, "The rider cancelled", "The rider cancelled this ride before it started.", ride)
    return ride


def release_ride(*, ride, driver):
    """The driver pulls out before the trip starts; the request goes back to open drivers."""
    from .models import RideBooking, RideStatus
    if ride.driver_id != driver.id:
        raise NotPartyToRideError("Only the assigned driver can release this ride.")
    updated = RideBooking.objects.filter(pk=ride.pk, driver=driver, status=RideStatus.ACCEPTED).update(
        driver=None, vehicle=None, status=RideStatus.REQUESTED,
    )
    if not updated:
        raise RideStateError("This ride has already started or is no longer assigned to you.")
    ride.refresh_from_db()
    _notify_ride(ride.rider, "Your driver pulled out", "Your request is open to other drivers again.", ride)
    return ride


SOS_REPEAT_SECONDS = 60


def raise_sos(*, ride, user, latitude=None, longitude=None, note=""):
    """The rider or the driver asks for help during a trip. Records who raised it and when, alerts every admin
    with the route, the people involved and, when given, the sender's location, and texts the sender's own
    emergency contact if they set one. Pressing again within a minute does not alert twice.
    Returns (admins alerted, whether the contact was alerted); (0, False) on a repeat press."""
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
        return 0, False
    RideBooking.objects.filter(pk=ride.pk).update(sos_raised_at=now, sos_raised_by=user)
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

    from notifications.services import notify
    admins = list(User.objects.filter(admin_profile__isnull=False))
    for admin in admins:
        notify(recipient=admin, notification_type="RIDE_SOS", title="SOS on an OaziGo ride", message=" ".join(lines), related_reference=str(ride.id))

    contact_alerted = False
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
        try:
            notify(
                external_phone_number=contact.phone, notification_type="RIDE_SOS", title="SOS from someone who listed you as a contact",
                message=" ".join(to_contact), channel="SMS", related_reference=str(ride.id),
            )
            contact_alerted = True
        except Exception:
            # A failing SMS provider must never stop the admins from being alerted.
            logger.exception("Could not alert the emergency contact for ride %s", ride.id)
    return len(admins), contact_alerted


def expire_stale_rides(*, max_age_hours: int = STALE_RIDE_HOURS, now=None) -> list:
    """Cancels ride requests nobody accepted in time and tells the rider. Meant to run on a schedule."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import RideBooking, RideStatus
    now = now or timezone.now()
    expired = []
    for ride in RideBooking.objects.filter(status=RideStatus.REQUESTED, requested_at__lt=now - timedelta(hours=max_age_hours)).select_related("rider"):
        if RideBooking.objects.filter(pk=ride.pk, status=RideStatus.REQUESTED).update(status=RideStatus.CANCELLED):
            _notify_ride(ride.rider, "No driver found", "Your ride request expired because no driver accepted it. You can request again.", ride)
            expired.append(ride)
    return expired


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

    # WHY complete_booking(), not booking.complete(): the earlier version
    # only flipped the Booking's own status flag — the escrow stayed HELD
    # forever, meaning the driver was never actually paid. complete_booking()
    # is the one real function that both completes the booking AND
    # releases the escrow it's holding.
    from transactions.services import complete_booking
    escrow = complete_booking(booking=booking)

    return booking, escrow


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


# ---------------------------------------------------------------------------
# Buying or renting a marketplace listing: the money waits in escrow until the
# buyer confirms they got what they paid for.
# ---------------------------------------------------------------------------
ORDER_AUTO_RELEASE_HOURS = 72
ORDER_SELLER_RESPONSE_DAYS = 7


class OrderError(Exception):
    pass


class ListingNotAvailableError(OrderError):
    pass


class OrderPaymentFailedError(OrderError):
    pass


class NotPartyToOrderError(OrderError):
    pass


def category_models():
    from .models import WarehouseListing, StoreListing, BusinessListing, CarListing
    return {"warehouses": WarehouseListing, "stores": StoreListing, "businesses": BusinessListing, "cars": CarListing}


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


def place_order(*, listing, buyer, lock_client, payment_gateway, phone_number: str):
    """Pays the listed price into escrow and takes the listing off the market (under offer) so two buyers
    can never pay for the same item. For a rental the listed price is the first rental period."""
    from django.db import transaction as db_transaction
    from transactions.services import reserve_booking, initiate_booking_payment, confirm_payment, fail_payment, InventoryConflictError
    from transactions.models import BookingType
    from .models import MarketplaceListingBase, AvailabilityStatus, MarketplaceOrder, MarketplaceOrderStatus

    if listing.lister_user_id == buyer.id:
        raise OrderError("You cannot buy your own listing.")
    # One conditional update decides who gets the listing when two buyers race for it.
    claimed = MarketplaceListingBase.objects.filter(pk=listing.pk, availability_status=AvailabilityStatus.AVAILABLE).update(
        availability_status=AvailabilityStatus.UNDER_OFFER,
    )
    if not claimed:
        raise ListingNotAvailableError("This listing is no longer available.")

    booking = None
    try:
        booking = reserve_booking(
            lock_client=lock_client, requester=buyer, booking_type=BookingType.MARKETPLACE_ITEM,
            target_content_type=f"marketplace.{type(listing).__name__}", target_id=listing.pk, amount_xaf=listing.price_xaf,
        )
        debit = initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
        if not debit.success:
            fail_payment(lock_client=lock_client, booking=booking)
            raise OrderPaymentFailedError("The payment could not be completed. Please try again.")
        confirm_payment(
            lock_client=lock_client, booking=booking, provider="MTN_MOMO", provider_reference=booking.idempotency_key,
            payment_gateway=payment_gateway, raw_webhook_payload=b"{}", webhook_signature_header="sandbox",
        )
        with db_transaction.atomic():
            order = MarketplaceOrder.objects.create(
                listing=listing, buyer=buyer, booking=booking, amount_xaf=listing.price_xaf, status=MarketplaceOrderStatus.PAID,
            )
    except InventoryConflictError as e:
        _set_listing_status(listing.pk, AvailabilityStatus.AVAILABLE)
        raise ListingNotAvailableError(str(e))
    except Exception:
        _set_listing_status(listing.pk, AvailabilityStatus.AVAILABLE)
        raise
    _notify_order(
        listing.lister_user, "New order on your listing",
        f"{buyer.full_name or buyer.username} paid {order.amount_xaf} XAF for \"{listing.title}\". Hand it over, then the payment is released to you once they confirm.",
        order,
    )
    return order


def _require_buyer(order, user):
    if order.buyer_id != user.id:
        raise NotPartyToOrderError("Only the buyer can do this.")


def _require_seller(order, user):
    if order.listing.lister_user_id != user.id:
        raise NotPartyToOrderError("Only the seller can do this.")


def _escrow_is_held(order) -> bool:
    from transactions.models import EscrowStatus
    escrow = getattr(order.booking, "escrow", None)
    return escrow is not None and escrow.status == EscrowStatus.HELD


def mark_handed_over(*, order, seller):
    """The seller says the item (or space) has been handed over; the buyer then has a few days to confirm."""
    from django.utils import timezone
    from .models import MarketplaceOrder, MarketplaceOrderStatus
    _require_seller(order, seller)
    updated = MarketplaceOrder.objects.filter(pk=order.pk, status=MarketplaceOrderStatus.PAID).update(
        status=MarketplaceOrderStatus.HANDED_OVER, handed_over_at=timezone.now(),
    )
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


def _release_to_seller(order):
    from django.utils import timezone
    from transactions.services import complete_booking
    from .models import MarketplaceOrder, MarketplaceOrderStatus, AvailabilityStatus
    complete_booking(booking=order.booking)
    MarketplaceOrder.objects.filter(pk=order.pk).update(status=MarketplaceOrderStatus.COMPLETED, completed_at=timezone.now())
    _set_listing_status(order.listing_id, AvailabilityStatus.UNAVAILABLE)
    order.refresh_from_db()


def _refund_to_buyer(order):
    from .models import MarketplaceOrder, MarketplaceOrderStatus, AvailabilityStatus
    escrow = order.booking.escrow
    escrow.refund()
    order.booking.cancel()
    MarketplaceOrder.objects.filter(pk=order.pk).update(status=MarketplaceOrderStatus.CANCELLED)
    _set_listing_status(order.listing_id, AvailabilityStatus.AVAILABLE)
    order.refresh_from_db()


def confirm_receipt(*, order, buyer):
    """The buyer confirms they got what they paid for; the payment is released to the seller."""
    from .models import MarketplaceOrderStatus
    _require_buyer(order, buyer)
    if order.status not in (MarketplaceOrderStatus.PAID, MarketplaceOrderStatus.HANDED_OVER) or not _escrow_is_held(order):
        raise OrderError("This order cannot be confirmed right now.")
    _release_to_seller(order)
    _notify_order(order.listing.lister_user, "Payment released", f"The buyer confirmed \"{order.listing.title}\". {order.amount_xaf} XAF was released to your wallet (minus the platform fee).", order)
    return order


def cancel_order(*, order, buyer):
    """The buyer backs out before the seller has handed anything over; the money comes back in full."""
    from .models import MarketplaceOrderStatus
    _require_buyer(order, buyer)
    if order.status != MarketplaceOrderStatus.PAID or not _escrow_is_held(order):
        raise OrderError("This order can no longer be cancelled. Report a problem if something went wrong.")
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
    _notify_order(order.buyer, "Your order was declined", f"The seller declined your order for \"{order.listing.title}\" and you were refunded in full.", order)
    return order


def dispute_order(*, order, user, reason: str):
    """Either side can raise a problem while the money is held; an admin then decides."""
    from property_management.services import open_dispute
    from .models import MarketplaceOrder, MarketplaceOrderStatus
    if user.id not in (order.buyer_id, order.listing.lister_user_id):
        raise NotPartyToOrderError("Only the buyer or the seller can report a problem.")
    if order.status not in (MarketplaceOrderStatus.PAID, MarketplaceOrderStatus.HANDED_OVER) or not _escrow_is_held(order):
        raise OrderError("A problem can only be reported while the payment is held in escrow.")
    open_dispute(escrow=order.booking.escrow, raised_by=user, reason=reason)
    MarketplaceOrder.objects.filter(pk=order.pk).update(status=MarketplaceOrderStatus.DISPUTED)
    order.refresh_from_db()
    other = order.listing.lister_user if user.id == order.buyer_id else order.buyer
    _notify_order(other, "A problem was reported", "Support will review this order and decide what happens to the payment.", order)
    return order


def resolve_order_dispute(*, order, outcome: str):
    """Applies an admin's decision on a disputed order: RELEASE pays the seller, REFUND returns the money."""
    from .models import MarketplaceOrderStatus
    if outcome not in ("RELEASE", "REFUND"):
        raise ValueError("outcome must be 'RELEASE' or 'REFUND'")
    if order.status in (MarketplaceOrderStatus.COMPLETED, MarketplaceOrderStatus.CANCELLED):
        return order
    if outcome == "RELEASE":
        _release_to_seller(order)
    else:
        _refund_to_buyer(order)
    for party in (order.buyer, order.listing.lister_user):
        _notify_order(party, "Support decision on your order", "Support released the payment to the seller." if outcome == "RELEASE" else "Support refunded the buyer.", order)
    return order


def order_for_escrow(escrow):
    """The marketplace order behind an escrow, or None when it belongs to another kind of booking."""
    from .models import MarketplaceOrder
    return MarketplaceOrder.objects.filter(booking=escrow.booking).select_related("listing__lister_user", "buyer").first()


def process_marketplace_orders(*, now=None) -> dict:
    """Scheduled sweep: refunds orders a seller never handed over within ORDER_SELLER_RESPONSE_DAYS, and releases
    payment on orders handed over but never confirmed within ORDER_AUTO_RELEASE_HOURS. Disputed orders are left alone."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import MarketplaceOrder, MarketplaceOrderStatus
    now = now or timezone.now()
    refunded, released = [], []
    stale = MarketplaceOrder.objects.filter(
        status=MarketplaceOrderStatus.PAID, created_at__lt=now - timedelta(days=ORDER_SELLER_RESPONSE_DAYS),
    ).select_related("listing__lister_user", "buyer", "booking")
    for order in stale:
        if _escrow_is_held(order):
            _refund_to_buyer(order)
            _notify_order(order.buyer, "Order refunded", f"The seller did not hand over \"{order.listing.title}\" in time, so you were refunded in full.", order)
            _notify_order(order.listing.lister_user, "Order cancelled", f"You did not hand over \"{order.listing.title}\" within {ORDER_SELLER_RESPONSE_DAYS} days, so the order was cancelled and refunded.", order)
            refunded.append(order)
    overdue = MarketplaceOrder.objects.filter(
        status=MarketplaceOrderStatus.HANDED_OVER, handed_over_at__lt=now - timedelta(hours=ORDER_AUTO_RELEASE_HOURS),
    ).select_related("listing__lister_user", "buyer", "booking")
    for order in overdue:
        if _escrow_is_held(order):
            _release_to_seller(order)
            _notify_order(order.buyer, "Payment released", f"You did not respond within {ORDER_AUTO_RELEASE_HOURS} hours of the handover, so the payment was released to the seller.", order)
            _notify_order(order.listing.lister_user, "Payment released", f"The payment for \"{order.listing.title}\" was released to you automatically.", order)
            released.append(order)
    return {"refunded": refunded, "released": released}
