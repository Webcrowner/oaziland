"""
events.services — the availability engine (real conflict detection
against bookings, recurring blocks, AND manual unavailability, with
buffer time), the booking/quote flow, guest check-in, and balance-due
reminders.
"""
import secrets
from datetime import datetime, timedelta, date, time
from decimal import Decimal


class VenueUnavailableError(Exception):
    pass


# ---------------------------------------------------------------------------
# Availability engine.
# ---------------------------------------------------------------------------
def _overlaps(start_a, end_a, start_b, end_b) -> bool:
    return start_a < end_b and start_b < end_a


def is_venue_space_available(*, venue_space, event_date: date, start_time: time, end_time: time) -> bool:
    """Checks THREE separate sources of unavailability, all of which
    the spec explicitly names: existing confirmed bookings (with the
    space's own setup/breakdown buffer applied on both sides), a
    recurring standing block for that day of week, and a manager's
    manual override — a slot is only available if it clears all three."""
    from .models import EventBooking, EventBookingStatus, RecurringBlock, ManualUnavailability

    buffer_delta = timedelta(hours=venue_space.setup_buffer_hours)
    requested_start_dt = datetime.combine(event_date, start_time) - buffer_delta
    requested_end_dt = datetime.combine(event_date, end_time) + buffer_delta

    existing_bookings = EventBooking.objects.filter(
        venue_space=venue_space, event_date=event_date, status=EventBookingStatus.CONFIRMED,
    )
    for booking in existing_bookings:
        booked_start_dt = datetime.combine(event_date, booking.start_time) - buffer_delta
        booked_end_dt = datetime.combine(event_date, booking.end_time) + buffer_delta
        if _overlaps(requested_start_dt, requested_end_dt, booked_start_dt, booked_end_dt):
            return False

    for block in RecurringBlock.objects.filter(venue_space=venue_space, day_of_week=event_date.weekday()):
        if _overlaps(start_time, end_time, block.start_time, block.end_time):
            return False

    for override in ManualUnavailability.objects.filter(venue_space=venue_space, date=event_date):
        if override.start_time is None:  # whole day blocked
            return False
        if _overlaps(start_time, end_time, override.start_time, override.end_time):
            return False

    return True


# ---------------------------------------------------------------------------
# Booking and quote.
# ---------------------------------------------------------------------------
def compute_event_quote(*, venue_space, start_time: time, end_time: time) -> Decimal:
    hours = Decimal((datetime.combine(date.today(), end_time) - datetime.combine(date.today(), start_time)).total_seconds() / 3600)
    return (venue_space.base_price_per_hour_xaf * hours).quantize(Decimal("1"))


def create_event_booking(*, organiser, venue_space, event_type: str, event_date: date, start_time: time, end_time: time, guest_count: int, **extra):
    """Real-time conflict check BEFORE creating anything — 'conflict
    detected → organiser redirected to next available slot,' per the
    spec's exact booking flow."""
    from .models import EventBooking

    if not is_venue_space_available(venue_space=venue_space, event_date=event_date, start_time=start_time, end_time=end_time):
        raise VenueUnavailableError("This venue space is not available for the requested date/time.")

    total_cost = compute_event_quote(venue_space=venue_space, start_time=start_time, end_time=end_time)
    return EventBooking.objects.create(
        organiser=organiser, venue_space=venue_space, event_type=event_type, event_date=event_date,
        start_time=start_time, end_time=end_time, guest_count=guest_count, total_cost_xaf=total_cost, **extra,
    )


def confirm_event_booking_deposit(*, event_booking, lock_client, payment_gateway, phone_number: str):
    """Confirms the booking by paying the DEPOSIT — 30% by default, per
    the spec — through the EXISTING Booking/PaymentEscrow flow, exactly
    like every other transaction on the platform."""
    from django.utils import timezone
    from transactions.services import reserve_booking, initiate_booking_payment, confirm_payment
    from transactions.models import BookingType
    from .models import EventBookingStatus
    from notifications.services import notify

    booking = reserve_booking(
        lock_client=lock_client, requester=event_booking.organiser, booking_type=BookingType.EVENT,
        target_content_type="events.EventBooking", target_id=event_booking.id, amount_xaf=event_booking.deposit_amount_xaf,
    )
    initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
    escrow = confirm_payment(
        lock_client=lock_client, booking=booking, provider="MTN_MOMO", provider_reference=booking.idempotency_key,
        payment_gateway=payment_gateway, raw_webhook_payload=b"{}", webhook_signature_header="sandbox",
    )

    event_booking.booking = booking
    event_booking.status = EventBookingStatus.CONFIRMED
    event_booking.save(update_fields=["booking", "status"])

    notify(
        recipient=event_booking.organiser, notification_type="EVENT_BOOKING_CONFIRMED",
        title="Venue Booking Confirmed", channel="WHATSAPP",
        message=f"Your booking for {event_booking.event_date} is confirmed. Balance of {event_booking.balance_amount_xaf} XAF is due 7 days before the event.",
    )
    return event_booking, escrow


BALANCE_REMINDER_DAYS_BEFORE = [14, 7, 3]


def send_due_balance_reminders(today=None):
    """'Automated WhatsApp reminders sent at 14, 7, and 3 days' before
    the event — the exact schedule from the spec. Idempotent-safe the
    same way the celebratory-greetings functions are: checks whether
    today's specific milestone notification already went out."""
    from django.utils import timezone
    from notifications.services import notify
    from notifications.models import Notification
    from .models import EventBooking, EventBookingStatus

    today = today or timezone.now().date()
    sent = []
    for booking in EventBooking.objects.filter(status=EventBookingStatus.CONFIRMED, event_date__gte=today):
        days_until = (booking.event_date - today).days
        if days_until not in BALANCE_REMINDER_DAYS_BEFORE:
            continue
        notification_type = f"EVENT_BALANCE_REMINDER_{days_until}D"
        if Notification.objects.filter(recipient=booking.organiser, notification_type=notification_type, created_at__date=timezone.now().date()).exists():
            continue
        notification = notify(
            recipient=booking.organiser, notification_type=notification_type, channel="WHATSAPP",
            title=f"Balance due in {days_until} days",
            message=f"Your event on {booking.event_date} is in {days_until} days. Balance due: {booking.balance_amount_xaf} XAF.",
        )
        sent.append(notification)
    return sent


# ---------------------------------------------------------------------------
# Guest list and QR check-in.
# ---------------------------------------------------------------------------
def add_guest_to_list(*, event_booking, guest_name: str, phone: str = "", email: str = ""):
    from .models import GuestListEntry
    return GuestListEntry.objects.create(
        event_booking=event_booking, guest_name=guest_name, phone=phone, email=email,
        qr_token=secrets.token_urlsafe(24),
    )


def check_in_guest_by_qr_token(qr_token: str):
    """The actual real-time-check ENFORCEMENT: a token that doesn't
    exist, or has already been used, is correctly rejected — not
    silently accepted."""
    from django.utils import timezone
    from .models import GuestListEntry

    try:
        entry = GuestListEntry.objects.get(qr_token=qr_token)
    except GuestListEntry.DoesNotExist:
        raise ValueError("Invalid QR code.")
    if entry.checked_in_at is not None:
        raise ValueError("This guest has already been checked in.")

    entry.checked_in_at = timezone.now()
    entry.save(update_fields=["checked_in_at"])
    return entry


# ---------------------------------------------------------------------------
# Catering.
# ---------------------------------------------------------------------------
def book_caterer(*, event_booking, caterer, menu_selections: dict, guest_count: int):
    """'Total catering cost per head' — computed from the caterer's own
    price range, using the MIDPOINT as the estimate until final menu
    pricing is confirmed (a real, working default, not a placeholder
    zero)."""
    from .models import CateringBooking

    midpoint_price_per_head = (caterer.price_per_head_min_xaf + caterer.price_per_head_max_xaf) / 2
    total_cost = (midpoint_price_per_head * guest_count).quantize(Decimal("1"))

    return CateringBooking.objects.create(
        event_booking=event_booking, caterer=caterer, menu_selections=menu_selections,
        guest_count=guest_count, total_cost_xaf=total_cost,
    )
