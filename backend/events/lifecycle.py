"""
events.lifecycle — what happens to a paid venue booking until the venue owner is paid: cancelling, the balance
deadline, the organiser confirming the event, disputes, and the automatic payout.

The rules:
- The organiser cancels free of charge until FREE_CANCELLATION_DAYS before the event starts, and always within
  GRACE_MINUTES of paying the deposit (a mis-tap). Later, the venue keeps the deposit and the balance (if paid) goes
  back to the organiser's wallet. If the venue owner cancels, the organiser is refunded in full.
- The balance is due BALANCE_DUE_DAYS before the event (or BALANCE_MIN_HOURS after the deposit, for bookings made
  late). If it still isn't paid then, the booking is cancelled and the venue keeps the deposit.
- Once the event is over the organiser can confirm it (paying the venue at once) or report a problem, which freezes the
  money for an admin. Otherwise the venue is paid automatically PAYOUT_DELAY_HOURS after the event ends.

Money only moves through transactions.services.settle_escrow, which locks the escrow, so a payout, a cancellation and
a dispute racing each other can never pay out twice.
"""
import logging
from datetime import datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .models import EventBooking, EventBookingStatus

FREE_CANCELLATION_DAYS = 7
GRACE_MINUTES = 15
BALANCE_DUE_DAYS = 7
BALANCE_MIN_HOURS = 48
PAYOUT_DELAY_HOURS = 48
STALE_UNPAID_HOURS = 24

logger = logging.getLogger(__name__)


class EventStateError(Exception):
    pass


def _moment(booking, at) -> datetime:
    return timezone.make_aware(datetime.combine(booking.event_date, at), timezone.get_current_timezone())


def starts_at(booking) -> datetime:
    return _moment(booking, booking.start_time)


def ends_at(booking) -> datetime:
    return _moment(booking, booking.end_time)


def payout_due_at(booking) -> datetime:
    return ends_at(booking) + timedelta(hours=PAYOUT_DELAY_HOURS)


def free_cancellation_until(booking) -> datetime:
    return starts_at(booking) - timedelta(days=FREE_CANCELLATION_DAYS)


def _escrow(booking_row):
    from django.core.exceptions import ObjectDoesNotExist

    if booking_row is None:
        return None
    try:
        return booking_row.escrow
    except ObjectDoesNotExist:
        return None


def held_escrows(event) -> list:
    """The payments (deposit, balance) that are paid and still held, deposit first."""
    from transactions.models import EscrowStatus

    rows = [_escrow(event.booking), _escrow(event.balance_booking)]
    return [e for e in rows if e is not None and e.status == EscrowStatus.HELD]


def open_escrows(event) -> list:
    """Held or frozen by a dispute."""
    from transactions.models import EscrowStatus

    rows = [_escrow(event.booking), _escrow(event.balance_booking)]
    return [e for e in rows if e is not None and e.status in (EscrowStatus.HELD, EscrowStatus.DISPUTED)]


def balance_due_at(event):
    """When the balance must be in, or None before the deposit is paid."""
    deposit = _escrow(event.booking)
    if deposit is None:
        return None
    return max(starts_at(event) - timedelta(days=BALANCE_DUE_DAYS), deposit.held_at + timedelta(hours=BALANCE_MIN_HOURS))


def cancellation_quote(event, now=None) -> dict:
    """What the organiser would get back if they cancelled now."""
    now = now or timezone.now()
    deposit, balance = _escrow(event.booking), _escrow(event.balance_booking)
    paid_deposit = deposit.gross_amount_xaf if deposit is not None else Decimal("0")
    paid_balance = balance.gross_amount_xaf if balance is not None else Decimal("0")
    in_grace = deposit is not None and now <= deposit.held_at + timedelta(minutes=GRACE_MINUTES)
    free = in_grace or now <= free_cancellation_until(event)
    fee = Decimal("0") if free else paid_deposit
    return {
        "free": free, "free_until": free_cancellation_until(event), "fee_xaf": fee,
        "refund_xaf": paid_deposit + paid_balance - fee,
    }


def _notify(user, title: str, message: str, event):
    from notifications.services import notify_important

    notify_important(recipient=user, notification_type="EVENT_BOOKING", title=title, message=message, related_reference=str(event.pk))


def _locked(event) -> EventBooking:
    return (
        EventBooking.objects.select_for_update()
        .select_related("booking", "balance_booking", "organiser", "venue_space__venue__owner")
        .get(pk=event.pk)
    )


def _owner(event):
    return event.venue_space.venue.owner


def _label(event) -> str:
    return f"{event.venue_space.space_name} on {event.event_date}"


def release_event_payment(event, *, reference: str = "") -> bool:
    """Pays the venue for every held payment, once. False when nothing is held (already paid out, refunded or
    frozen by a dispute)."""
    from transactions.services import EscrowSettlementError, settle_escrow

    released = False
    for escrow in held_escrows(event):
        try:
            settle_escrow(escrow=escrow, payer_amount_xaf=0, reference=reference or f"event #{str(event.pk)[:8]}")
            released = True
        except EscrowSettlementError:
            continue
    return released


# ---------------------------------------------------------------- cancelling

def cancel_event_booking(event, *, by) -> EventBooking:
    """The organiser cancels (free early or in the grace period, deposit kept later) or the venue owner cancels
    (the organiser is refunded in full)."""
    from transactions.models import BookingStatus
    from transactions.services import settle_escrow

    is_organiser = by.pk == event.organiser_id
    is_owner = by.pk == _owner(event).pk
    if not (is_organiser or is_owner):
        raise EventStateError("Only the organiser or the venue owner can cancel this booking.")
    with transaction.atomic():
        locked = _locked(event)
        now = timezone.now()
        if locked.status == EventBookingStatus.PENDING:
            if not is_organiser:
                raise EventStateError("This booking hasn't been paid yet.")
            booking = locked.booking
            if booking is not None and booking.status == BookingStatus.PAYMENT_PROCESSING and booking.hold_expires_at and booking.hold_expires_at > now:
                raise EventStateError("A payment is in progress. Approve or decline it on your phone first.")
            locked.status = EventBookingStatus.CANCELLED
            locked.save(update_fields=["status"])
            return locked
        if locked.status != EventBookingStatus.CONFIRMED:
            raise EventStateError("This booking can no longer be cancelled.")
        if now >= starts_at(locked):
            raise EventStateError("The event has already started.")
        escrows = held_escrows(locked)
        if not escrows:
            raise EventStateError("This booking's payment is not available to cancel (it may be under review). Contact support.")
        if is_owner and not is_organiser:
            quote = {"fee_xaf": Decimal("0"), "free": True}
        else:
            quote = cancellation_quote(locked, now)
        deposit = _escrow(locked.booking)
        deposit_id = deposit.pk if deposit is not None else None
        for escrow in escrows:
            keep_deposit = not quote["free"] and escrow.pk == deposit_id
            settle_escrow(
                escrow=escrow, payer_amount_xaf=0 if keep_deposit else escrow.gross_amount_xaf,
                reference=f"cancelled event #{str(locked.pk)[:8]}",
            )
        locked.status = EventBookingStatus.CANCELLED
        locked.save(update_fields=["status"])
    label = _label(locked)
    if is_owner and not is_organiser:
        _notify(locked.organiser, "Your venue booking was cancelled", f"The venue cancelled your booking ({label}). You were refunded in full to your Oaziland wallet.", locked)
    else:
        kept = f" The deposit ({quote['fee_xaf']:.0f} XAF) is kept by the venue." if quote["fee_xaf"] > 0 else ""
        _notify(locked.organiser, "Venue booking cancelled", f"Your booking ({label}) was cancelled and what you can get back went to your Oaziland wallet.{kept}", locked)
        _notify(_owner(locked), "Venue booking cancelled", f"{locked.organiser.full_name or locked.organiser.username} cancelled their booking ({label}).", locked)
    return locked


# ---------------------------------------------------------------- the event itself

def confirm_event(event, *, organiser) -> EventBooking:
    """The organiser says the event went well: the venue is paid now instead of after the automatic delay."""
    if event.organiser_id != organiser.pk:
        raise EventStateError("Only the organiser can confirm the event.")
    with transaction.atomic():
        locked = _locked(event)
        if locked.status != EventBookingStatus.CONFIRMED:
            raise EventStateError("This event can't be confirmed right now.")
        if timezone.now() < starts_at(locked):
            raise EventStateError("You can confirm the event once it has started.")
        if not _balance_settled(locked):
            raise EventStateError("Pay the remaining balance before confirming the event.")
        if not release_event_payment(locked):
            raise EventStateError("This payment can't be released right now (it may be under review).")
        locked.status = EventBookingStatus.COMPLETED
        locked.save(update_fields=["status"])
    _notify(_owner(locked), "Payment released", f"{locked.organiser.full_name or locked.organiser.username} confirmed the event ({_label(locked)}). The payment was released to your wallet.", locked)
    return locked


def _balance_settled(event) -> bool:
    return event.balance_amount_xaf <= 0 or _escrow(event.balance_booking) is not None


def complete_as_owner(event, *, owner) -> EventBooking:
    """The venue owner marks the event done once it is over; both payments are released to them."""
    if _owner(event).pk != owner.pk:
        raise EventStateError("Only this venue's owner can mark an event complete.")
    with transaction.atomic():
        locked = _locked(event)
        if locked.status != EventBookingStatus.CONFIRMED:
            raise EventStateError("Only a confirmed booking can be completed.")
        if timezone.now() < ends_at(locked):
            raise EventStateError("The event isn't over yet.")
        if not _balance_settled(locked):
            raise EventStateError("The remaining balance has not been paid yet.")
        if not release_event_payment(locked):
            raise EventStateError("This payment can't be released right now (it may be under review).")
        locked.status = EventBookingStatus.COMPLETED
        locked.save(update_fields=["status"])
    return locked


def dispute_event(event, *, organiser, reason: str) -> EventBooking:
    """The organiser reports a problem: every held payment is frozen until an admin decides."""
    from property_management.services import DisputeNotAllowedError, open_dispute

    if event.organiser_id != organiser.pk:
        raise EventStateError("Only the organiser can report a problem with the event.")
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise EventStateError("Describe the problem in a few words.")
    with transaction.atomic():
        locked = _locked(event)
        if locked.status != EventBookingStatus.CONFIRMED:
            raise EventStateError("A problem can only be reported while the payment is still held.")
        if timezone.now() < starts_at(locked):
            raise EventStateError("You can report a problem once the event has started. Before that, cancel it instead.")
        escrows = held_escrows(locked)
        if not escrows:
            raise EventStateError("The payment is not held any more, so it can't be disputed.")
        try:
            for escrow in escrows:
                open_dispute(escrow=escrow, raised_by=organiser, reason=reason)
        except DisputeNotAllowedError as exc:
            raise EventStateError(str(exc))
    _notify(_owner(locked), "A problem was reported", f"{locked.organiser.full_name or locked.organiser.username} reported a problem with the event ({_label(locked)}). Support will review it and decide what happens to the payment.", locked)
    return locked


def after_event_dispute_settled(booking):
    """Called when an admin has decided a dispute on one of an event's payments: once nothing is left held or frozen,
    the booking follows the money (completed if the venue was paid anything, else cancelled)."""
    from transactions.models import EscrowStatus

    event = EventBooking.objects.filter(booking=booking).first() or EventBooking.objects.filter(balance_booking=booking).first()
    if event is None or event.status != EventBookingStatus.CONFIRMED or open_escrows(event):
        return event
    paid = [e for e in (_escrow(event.booking), _escrow(event.balance_booking)) if e is not None]
    event.status = EventBookingStatus.COMPLETED if any(e.status == EscrowStatus.RELEASED for e in paid) else EventBookingStatus.CANCELLED
    event.save(update_fields=["status"])
    return event


# ---------------------------------------------------------------- the scheduled sweep

def process_event_bookings(now=None) -> dict:
    """Pays venues for events that ended with no problem reported, cancels bookings whose balance wasn't paid in
    time, and tidies bookings that never got a deposit. Meant to run hourly; safe to run any number of times."""
    from transactions.models import BookingStatus
    from transactions.services import settle_escrow

    now = now or timezone.now()
    paid, cancelled_unpaid_balance, cancelled_unpaid = [], [], []

    confirmed = EventBooking.objects.filter(
        status=EventBookingStatus.CONFIRMED, event_date__lte=(now + timedelta(days=BALANCE_DUE_DAYS + 1)).date(),
    ).select_related("booking", "balance_booking", "organiser", "venue_space__venue__owner")
    for event in confirmed:
        try:
            if ends_at(event) <= now:
                if payout_due_at(event) > now:
                    continue
                with transaction.atomic():
                    locked = _locked(event)
                    if locked.status != EventBookingStatus.CONFIRMED or not release_event_payment(locked, reference=f"event #{str(locked.pk)[:8]} (automatic)"):
                        continue
                    locked.status = EventBookingStatus.COMPLETED
                    locked.save(update_fields=["status"])
                _notify(_owner(locked), "Payment released", f"The event ({_label(locked)}) ended with no problem reported, so the payment was released to your wallet.", locked)
                _notify(locked.organiser, "Event completed", f"Your event ({_label(locked)}) is complete and the payment was released to the venue. Thank you!", locked)
                paid.append(locked)
            elif not _balance_settled(event):
                due = balance_due_at(event)
                balance = event.balance_booking
                if due is None or due > now or now >= starts_at(event):
                    continue
                if balance is not None and balance.status == BookingStatus.PAYMENT_PROCESSING and balance.hold_expires_at and balance.hold_expires_at > now:
                    continue
                with transaction.atomic():
                    locked = _locked(event)
                    if locked.status != EventBookingStatus.CONFIRMED or _balance_settled(locked):
                        continue
                    for escrow in held_escrows(locked):
                        settle_escrow(escrow=escrow, payer_amount_xaf=0, reference=f"balance not paid, event #{str(locked.pk)[:8]}")
                    locked.status = EventBookingStatus.CANCELLED
                    locked.save(update_fields=["status"])
                _notify(locked.organiser, "Venue booking cancelled", f"The balance for your booking ({_label(locked)}) was not paid in time, so it was cancelled. The deposit is kept by the venue.", locked)
                _notify(_owner(locked), "Venue booking cancelled", f"The balance for the booking ({_label(locked)}) was not paid in time. The deposit was released to your wallet.", locked)
                cancelled_unpaid_balance.append(locked)
        except Exception:
            logger.exception("Event sweep failed on booking %s", event.pk)

    stale = EventBooking.objects.filter(
        status=EventBookingStatus.PENDING, created_at__lt=now - timedelta(hours=STALE_UNPAID_HOURS),
    ).select_related("booking")
    for event in stale:
        booking = event.booking
        if booking is not None and booking.status == BookingStatus.PAYMENT_PROCESSING and booking.hold_expires_at and booking.hold_expires_at > now:
            continue
        EventBooking.objects.filter(pk=event.pk, status=EventBookingStatus.PENDING).update(status=EventBookingStatus.CANCELLED)
        cancelled_unpaid.append(event)
    return {"paid": paid, "cancelled_unpaid_balance": cancelled_unpaid_balance, "cancelled_unpaid": cancelled_unpaid}
