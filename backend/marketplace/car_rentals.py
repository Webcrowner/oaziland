"""
Car rentals booked for chosen dates, the way Turo or Getaround work: the renter picks a start and a return day,
the price is the daily rate times the days (with the owner's weekly/monthly discount, an optional driver and
delivery), and the booked days are blocked on the car's calendar so other renters can still book other dates.

A period runs from its start day up to but not including its return day, so one rental can end the same day
the next one starts.
"""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

# How far ahead a car can be booked, and the longest single rental.
MAX_BOOKING_AHEAD_DAYS = 365
MAX_RENTAL_DAYS = 365
WEEKLY_DISCOUNT_FROM_DAYS = 7
MONTHLY_DISCOUNT_FROM_DAYS = 28
# Cancelling within this many hours of the start keeps one day's rent for the owner.
FREE_CANCELLATION_HOURS = 24
# The owner can hand the car over from the day before the rental starts.
EARLY_HANDOVER_DAYS = 1
# A paid rental the owner never hands over is refunded this many days after its start day.
HANDOVER_GRACE_DAYS = 1
# How long an owner without instant booking has to accept a request (see approval_deadline).
APPROVAL_WINDOW_HOURS = 24
MIN_APPROVAL_WINDOW_HOURS = 2
DAILY_BASIS = "RENT_NIGHTLY"


class CarRentalError(Exception):
    def __init__(self, message: str, field: str = "detail"):
        super().__init__(message)
        self.field = field


def is_dated_car_rental(listing) -> bool:
    from .models import CarListing
    return isinstance(listing, CarListing) and listing.price_basis == DAILY_BASIS


def as_car(listing):
    """The CarListing behind a base marketplace listing, or None."""
    from .models import CarListing
    if isinstance(listing, CarListing):
        return listing
    return CarListing.objects.filter(pk=listing.pk).first()


def _money(value) -> Decimal:
    return Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def busy_periods(car, *, exclude_order_id=None, today: date = None) -> list[dict]:
    """Every period the car can't be booked from today on: other renters' live bookings and the owner's blocks."""
    from django.utils import timezone
    from .models import MarketplaceOrder, MarketplaceOrderStatus
    today = today or timezone.localdate()
    live = (
        MarketplaceOrderStatus.PAYMENT_PENDING, MarketplaceOrderStatus.PAID,
        MarketplaceOrderStatus.HANDED_OVER, MarketplaceOrderStatus.DISPUTED, MarketplaceOrderStatus.COMPLETED,
    )
    orders = MarketplaceOrder.objects.filter(
        listing_id=car.pk, booked_dates=True, status__in=live, rental_ends_on__gt=today,
    )
    if exclude_order_id:
        orders = orders.exclude(pk=exclude_order_id)
    periods = [{"start": o.rental_starts_on, "end": o.rental_ends_on, "kind": "booked"} for o in orders]
    periods += [
        {"start": b.starts_on, "end": b.ends_on, "kind": "blocked", "id": str(b.id), "note": b.note}
        for b in car.blocked_periods.filter(ends_on__gt=today)
    ]
    return sorted(periods, key=lambda p: p["start"])


def overlaps(periods, start: date, end: date) -> bool:
    return any(p["start"] < end and start < p["end"] for p in periods)


def quote_car_rental(car, *, start: date, end: date, with_driver: bool = False, delivery: bool = False, today: date = None,
                     daily_rate=None) -> dict:
    """Checks a requested rental against the owner's terms and the calendar and prices it. daily_rate replaces the
    listed rate when the renter negotiated one (an accepted offer). Raises CarRentalError naming the field that is
    wrong."""
    from django.utils import timezone
    from .models import DriverOption
    today = today or timezone.localdate()
    if not is_dated_car_rental(car):
        raise CarRentalError("This car is not offered for rent by the day.")
    if start < today:
        raise CarRentalError("The rental cannot start in the past.", "start_date")
    if start > today + timedelta(days=MAX_BOOKING_AHEAD_DAYS):
        raise CarRentalError(f"Cars can be booked up to {MAX_BOOKING_AHEAD_DAYS} days ahead.", "start_date")
    if end <= start:
        raise CarRentalError("The return day must be after the start day.", "end_date")
    days = (end - start).days
    longest = min(car.max_rental_days or MAX_RENTAL_DAYS, MAX_RENTAL_DAYS)
    if days < car.min_rental_days:
        raise CarRentalError(f"This car is rented for at least {car.min_rental_days} days.", "end_date")
    if days > longest:
        raise CarRentalError(f"This car is rented for at most {longest} days.", "end_date")
    if car.driver_option == DriverOption.WITH_DRIVER:
        with_driver = True
    elif car.driver_option == DriverOption.SELF_DRIVE and with_driver:
        raise CarRentalError("This car is only rented without a driver.", "with_driver")
    if delivery and not car.delivery_available:
        raise CarRentalError("The owner does not deliver this car.", "delivery")
    if overlaps(busy_periods(car, today=today), start, end):
        raise CarRentalError("The car is not available for all of those days. Pick other dates.", "start_date")

    daily = _money(daily_rate if daily_rate is not None else car.price_xaf)
    base = daily * days
    discount_pct = 0
    if days >= MONTHLY_DISCOUNT_FROM_DAYS and car.monthly_discount_pct:
        discount_pct = car.monthly_discount_pct
    elif days >= WEEKLY_DISCOUNT_FROM_DAYS and car.weekly_discount_pct:
        discount_pct = car.weekly_discount_pct
    discount = _money(base * discount_pct / 100)
    driver_fee = _money(car.driver_fee_per_day_xaf) * days if with_driver else Decimal("0")
    delivery_fee = _money(car.delivery_fee_xaf) if delivery else Decimal("0")
    rent_total = base - discount + driver_fee + delivery_fee
    deposit = _money(car.security_deposit_xaf)
    return {
        "start_date": start, "end_date": end, "days": days, "with_driver": with_driver, "delivery": delivery,
        "daily_rate_xaf": daily, "base_xaf": base, "discount_pct": discount_pct, "discount_xaf": discount,
        "driver_fee_xaf": driver_fee, "delivery_fee_xaf": delivery_fee, "rent_total_xaf": rent_total,
        "deposit_xaf": deposit, "total_xaf": rent_total + deposit,
    }


def breakdown_for_storage(quote: dict) -> dict:
    """The quote as plain JSON (dates and amounts as strings) for the order record."""
    return {key: (str(value) if isinstance(value, (Decimal, date)) else value) for key, value in quote.items()}


def approval_deadline(order):
    """When an unanswered booking request expires and is refunded: 24 hours after it was paid, but no later than
    noon on the first rental day, and never sooner than 2 hours after the request."""
    from datetime import datetime, time
    from django.utils import timezone
    if not order.needs_approval:
        return None
    start_noon = timezone.make_aware(datetime.combine(order.rental_starts_on, time(12, 0)))
    latest = min(order.created_at + timedelta(hours=APPROVAL_WINDOW_HOURS), start_noon)
    return max(order.created_at + timedelta(hours=MIN_APPROVAL_WINDOW_HOURS), latest)


def awaiting_approval(order) -> bool:
    return bool(order.needs_approval and order.owner_approved_at is None)


def late_cancellation_fee(order, *, now=None) -> Decimal:
    """What the owner keeps when a dated car rental is cancelled: nothing more than FREE_CANCELLATION_HOURS before
    the start (or while the owner hasn't accepted the request yet), otherwise one day's rent."""
    from datetime import datetime, time
    from django.utils import timezone
    if not order.booked_dates or not order.rental_starts_on or not order.rental_days or awaiting_approval(order):
        return Decimal("0")
    now = now or timezone.now()
    starts_at = timezone.make_aware(datetime.combine(order.rental_starts_on, time.min))
    if now <= starts_at - timedelta(hours=FREE_CANCELLATION_HOURS):
        return Decimal("0")
    return min(order.amount_xaf, _money(order.amount_xaf / order.rental_days))


def free_cancellation_until(order):
    from datetime import datetime, time
    from django.utils import timezone
    if not order.booked_dates or not order.rental_starts_on or awaiting_approval(order):
        return None
    return timezone.make_aware(datetime.combine(order.rental_starts_on, time.min)) - timedelta(hours=FREE_CANCELLATION_HOURS)


def handover_deadline(order):
    """When a paid dated rental is refunded if the owner never hands the car over: the end of the grace days
    after the start day."""
    from datetime import datetime, time
    from django.utils import timezone
    return timezone.make_aware(datetime.combine(order.rental_starts_on + timedelta(days=HANDOVER_GRACE_DAYS + 1), time.min))


def mask_vin(vin: str) -> str:
    return f"…{vin[-6:]}" if vin else ""
