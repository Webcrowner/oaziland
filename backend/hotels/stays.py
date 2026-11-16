"""
hotels.stays — what happens to a paid reservation until the owner is paid: cancelling, no-shows, the guest confirming
the stay, disputes, and the automatic payout.

The rules (hotels and guest houses alike):
- A guest cancels free of charge until FREE_CANCELLATION_HOURS before check-in (noon on the check-in date). After that
  the owner keeps the first night and the rest goes back to the guest's wallet. The owner can cancel any time before
  check-in and the guest is refunded in full.
- If the guest never arrives, the owner can mark a no-show from the day after check-in: the first night is kept, the
  rest is refunded.
- The guest can confirm the stay (paying the owner at once) or report a problem, which freezes the money for an admin.
- Otherwise the owner is paid automatically PAYOUT_DELAY_HOURS after check-out (noon on the check-out date), so
  nobody's money waits forever on a button someone forgot to press.

Money only moves through transactions.services.settle_escrow, which locks the escrow, so a payout, a cancellation and
a dispute racing each other can never pay out twice.
"""
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .models import GuestFolio, FolioStatus, Reservation, ReservationStatus, Room, RoomStatus

FREE_CANCELLATION_HOURS = 48
PAYOUT_DELAY_HOURS = 24
CHECK_TIME = time(12, 0)
STALE_UNPAID_HOURS = 24


class StayError(Exception):
    pass


def _moment(day) -> datetime:
    return timezone.make_aware(datetime.combine(day, CHECK_TIME), timezone.get_current_timezone())


def free_cancellation_until(reservation) -> datetime:
    return _moment(reservation.check_in) - timedelta(hours=FREE_CANCELLATION_HOURS)


def payout_due_at(reservation) -> datetime:
    return _moment(reservation.check_out) + timedelta(hours=PAYOUT_DELAY_HOURS)


def _nights(reservation) -> int:
    return max((reservation.check_out - reservation.check_in).days, 1)


def first_night_xaf(reservation) -> Decimal:
    gross = reservation.rate_xaf
    return min((gross / _nights(reservation)).quantize(Decimal("1")), gross)


def held_escrow(reservation):
    """The reservation's payment while it is still held, else None."""
    from django.core.exceptions import ObjectDoesNotExist
    from transactions.models import EscrowStatus

    if reservation.booking_id is None:
        return None
    try:
        escrow = reservation.booking.escrow
    except ObjectDoesNotExist:
        return None
    return escrow if escrow.status == EscrowStatus.HELD else None


def cancellation_quote(reservation, now=None) -> dict:
    """What a guest would pay (fee) and get back if they cancelled now."""
    now = now or timezone.now()
    gross = reservation.rate_xaf
    free = now <= free_cancellation_until(reservation)
    fee = Decimal("0") if free else first_night_xaf(reservation)
    return {
        "free": free, "free_until": free_cancellation_until(reservation), "fee_xaf": fee, "refund_xaf": gross - fee,
    }


def _notify(user, title: str, message: str, reservation):
    from notifications.services import notify_important
    notify_important(recipient=user, notification_type="HOTEL_RESERVATION", title=title, message=message, related_reference=str(reservation.pk))


def _place_name(reservation) -> str:
    place = reservation.place
    return place.name or "your stay"


def _locked(reservation) -> Reservation:
    return Reservation.objects.select_for_update().select_related("booking", "guest", "hotel", "guest_house").get(pk=reservation.pk)


def _close_stay(reservation):
    """Closes the folio and sends the room to housekeeping once the guest has left."""
    folio = GuestFolio.objects.filter(reservation=reservation).first()
    if folio is not None and folio.status != FolioStatus.CLOSED:
        folio.status = FolioStatus.CLOSED
        folio.closed_at = timezone.now()
        folio.save(update_fields=["status", "closed_at"])
    assignment = getattr(reservation, "room_assignment", None)
    if assignment is not None and assignment.room.status == RoomStatus.OCCUPIED:
        Room.objects.filter(pk=assignment.room_id).update(status=RoomStatus.DIRTY)


def release_stay_payment(reservation, *, reference: str = "") -> bool:
    """Pays the owner for the stay, once. False when there is nothing held to pay (already paid out, refunded or
    frozen by a dispute)."""
    from transactions.services import EscrowSettlementError, settle_escrow

    escrow = held_escrow(reservation)
    if escrow is None:
        return False
    try:
        settle_escrow(escrow=escrow, payer_amount_xaf=0, reference=reference or f"stay #{str(reservation.pk)[:8]}")
    except EscrowSettlementError:
        return False
    return True


# ---------------------------------------------------------------- cancelling

def cancel_reservation(reservation, *, by) -> Reservation:
    """The guest cancels (free early, first night kept later) or the owner cancels (guest refunded in full)."""
    from transactions.models import BookingStatus
    from transactions.services import settle_escrow

    is_guest = by.pk == reservation.guest_id
    is_owner = by.pk == reservation.place.owner_id
    if not (is_guest or is_owner):
        raise StayError("Only the guest or the owner can cancel this reservation.")
    with transaction.atomic():
        locked = _locked(reservation)
        if locked.status == ReservationStatus.PENDING_PAYMENT:
            if not is_guest:
                raise StayError("This reservation hasn't been paid yet.")
            booking = locked.booking
            if booking is not None and booking.status == BookingStatus.PAYMENT_PROCESSING and booking.hold_expires_at and booking.hold_expires_at > timezone.now():
                raise StayError("A payment is in progress. Approve or decline it on your phone first.")
            locked.status = ReservationStatus.CANCELLED
            locked.save(update_fields=["status"])
            return locked
        if locked.status != ReservationStatus.CONFIRMED:
            raise StayError("This reservation can no longer be cancelled.")
        if timezone.localdate() >= locked.check_out:
            raise StayError("This stay is over.")
        escrow = held_escrow(locked)
        if escrow is None:
            raise StayError("This reservation's payment is not available to cancel. Contact support.")
        if is_owner and not is_guest:
            refund, fee = locked.rate_xaf, Decimal("0")
        else:
            quote = cancellation_quote(locked)
            refund, fee = quote["refund_xaf"], quote["fee_xaf"]
        settle_escrow(escrow=escrow, payer_amount_xaf=refund, reference=f"cancelled stay #{str(locked.pk)[:8]}")
        locked.status = ReservationStatus.CANCELLED
        locked.save(update_fields=["status"])
    name = _place_name(locked)
    if is_owner and not is_guest:
        _notify(locked.guest, "Your reservation was cancelled", f"{name} cancelled your stay ({locked.check_in} to {locked.check_out}). You were refunded in full to your Oaziland wallet.", locked)
    else:
        kept = f" The first night ({fee:.0f} XAF) is kept by the host." if fee > 0 else ""
        _notify(locked.guest, "Reservation cancelled", f"Your stay at {name} was cancelled. {refund:.0f} XAF went back to your Oaziland wallet.{kept}", locked)
        _notify(locked.place.owner, "Reservation cancelled", f"{locked.guest.full_name or locked.guest.username} cancelled their stay at {name} ({locked.check_in} to {locked.check_out}).", locked)
    return locked


def mark_no_show(reservation, *, owner) -> Reservation:
    from transactions.services import settle_escrow

    if reservation.place.owner_id != owner.pk:
        raise StayError("Only the owner can mark a no-show.")
    with transaction.atomic():
        locked = _locked(reservation)
        if locked.status != ReservationStatus.CONFIRMED:
            raise StayError("Only a confirmed reservation the guest never checked in to can be a no-show.")
        if timezone.localdate() <= locked.check_in:
            raise StayError("A no-show can be recorded from the day after check-in.")
        escrow = held_escrow(locked)
        if escrow is None:
            raise StayError("This reservation's payment is not available. Contact support.")
        kept = first_night_xaf(locked)
        settle_escrow(escrow=escrow, payer_amount_xaf=locked.rate_xaf - kept, reference=f"no-show #{str(locked.pk)[:8]}")
        locked.status = ReservationStatus.NO_SHOW
        locked.save(update_fields=["status"])
    _notify(locked.guest, "Marked as a no-show", f"You didn't arrive at {_place_name(locked)}. The first night ({kept:.0f} XAF) is kept by the host and the rest went back to your Oaziland wallet.", locked)
    return locked


# ---------------------------------------------------------------- the stay itself

def confirm_stay(reservation, *, guest) -> Reservation:
    """The guest says the stay went well: the owner is paid now instead of after the automatic delay."""
    if reservation.guest_id != guest.pk:
        raise StayError("Only the guest can confirm the stay.")
    with transaction.atomic():
        locked = _locked(reservation)
        if locked.status not in (ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN):
            raise StayError("This stay can't be confirmed right now.")
        if timezone.localdate() < locked.check_in:
            raise StayError("You can confirm your stay once it has started.")
        if not release_stay_payment(locked):
            raise StayError("This payment can't be released right now (it may be under review).")
        locked.status = ReservationStatus.CHECKED_OUT
        locked.save(update_fields=["status"])
        _close_stay(locked)
    _notify(locked.place.owner, "Payment released", f"{locked.guest.full_name or locked.guest.username} confirmed their stay at {_place_name(locked)}. The payment was released to your wallet.", locked)
    return locked


def dispute_stay(reservation, *, guest, reason: str) -> Reservation:
    """The guest reports a problem: the held money is frozen until an admin decides."""
    from property_management.services import DisputeNotAllowedError, open_dispute

    if reservation.guest_id != guest.pk:
        raise StayError("Only the guest can report a problem with the stay.")
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise StayError("Describe the problem in a few words.")
    with transaction.atomic():
        locked = _locked(reservation)
        if locked.status not in (ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN):
            raise StayError("A problem can only be reported while the payment is still held.")
        if timezone.localdate() < locked.check_in:
            raise StayError("You can report a problem once the stay has started. Before that, cancel it instead.")
        escrow = held_escrow(locked)
        if escrow is None:
            raise StayError("The payment is not held any more, so it can't be disputed.")
        try:
            open_dispute(escrow=escrow, raised_by=guest, reason=reason)
        except DisputeNotAllowedError as exc:
            raise StayError(str(exc))
    _notify(locked.place.owner, "A problem was reported", f"{locked.guest.full_name or locked.guest.username} reported a problem with the stay at {_place_name(locked)}. Support will review it and decide what happens to the payment.", locked)
    return locked


def after_stay_dispute_settled(booking, *, refunded_in_full: bool):
    """Called when an admin has decided a dispute on a reservation's payment: the reservation follows the money."""
    reservation = Reservation.objects.filter(booking=booking).first()
    if reservation is None or reservation.status not in (ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN):
        return reservation
    if refunded_in_full:
        reservation.status = ReservationStatus.CANCELLED
    else:
        reservation.status = ReservationStatus.CHECKED_OUT
        _close_stay(reservation)
    reservation.save(update_fields=["status"])
    return reservation


# ---------------------------------------------------------------- the scheduled sweep

def process_hotel_reservations(now=None) -> dict:
    """Pays owners for stays that ended and nobody disputed, and tidies reservations that were never paid. Meant to
    run on a schedule (hourly); safe to run any number of times."""
    import logging

    from transactions.models import BookingStatus

    logger = logging.getLogger(__name__)
    now = now or timezone.now()
    paid, cancelled = [], []

    ended = Reservation.objects.filter(
        status__in=[ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN], check_out__lte=now.date(),
    ).select_related("booking", "guest", "hotel", "guest_house")
    for reservation in ended:
        if payout_due_at(reservation) > now:
            continue
        try:
            with transaction.atomic():
                locked = _locked(reservation)
                if locked.status not in (ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN):
                    continue
                if not release_stay_payment(locked, reference=f"stay #{str(locked.pk)[:8]} (automatic)"):
                    continue  # frozen by a dispute, or already settled
                locked.status = ReservationStatus.CHECKED_OUT
                locked.save(update_fields=["status"])
                _close_stay(locked)
        except Exception:
            logger.exception("Hotel payout sweep failed on reservation %s", reservation.pk)
            continue
        _notify(locked.place.owner, "Payment released", f"Your guest's stay at {_place_name(locked)} ({locked.check_in} to {locked.check_out}) ended with no problem reported, so the payment was released to your wallet.", locked)
        _notify(locked.guest, "Stay completed", f"Your stay at {_place_name(locked)} is complete and the payment was released to the host. Thank you!", locked)
        paid.append(locked)

    stale = Reservation.objects.filter(
        status=ReservationStatus.PENDING_PAYMENT, created_at__lt=now - timedelta(hours=STALE_UNPAID_HOURS),
    ).select_related("booking")
    for reservation in stale:
        booking = reservation.booking
        if booking is not None and booking.status == BookingStatus.PAYMENT_PROCESSING and booking.hold_expires_at and booking.hold_expires_at > now:
            continue
        Reservation.objects.filter(pk=reservation.pk, status=ReservationStatus.PENDING_PAYMENT).update(status=ReservationStatus.CANCELLED)
        cancelled.append(reservation)
    return {"paid": paid, "cancelled_unpaid": cancelled}
