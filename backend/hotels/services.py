"""
hotels.services — the dynamic pricing engine (B.1.2) and the room
status state machine (B.4) enforcement.
"""
from decimal import Decimal
from datetime import timedelta, date


# ---------------------------------------------------------------------------
# Dynamic pricing engine.
#
# WHY these specific multiplier VALUES are named constants here, not
# buried inline: the spec names occupancy thresholds (70/85/95%) and
# length-of-stay discounts (7/14/28 nights) with EXACT percentages, but
# leaves the occupancy-tier multipliers and weekend premium as
# "configurable" without exact numbers. These are sensible, clearly-
# labeled starting defaults — same approach as every other "spec left
# this configurable" decision throughout this project (e.g. the AVM's
# 15% valuation band) — not a guess hidden in the middle of a formula.
# ---------------------------------------------------------------------------
OCCUPANCY_TIER_70_MULTIPLIER = Decimal("1.10")
OCCUPANCY_TIER_85_MULTIPLIER = Decimal("1.25")
OCCUPANCY_TIER_95_MULTIPLIER = Decimal("1.50")
WEEKEND_PREMIUM_MULTIPLIER = Decimal("1.15")  # Friday/Saturday nights
LAST_MINUTE_WINDOW_HOURS = 48

LENGTH_OF_STAY_DISCOUNTS = [
    (28, Decimal("0.20")),
    (14, Decimal("0.15")),
    (7, Decimal("0.10")),
]  # checked longest-first — a 30-night stay gets the 28+ discount, not the 7+ one


def _occupancy_multiplier(occupancy_rate: Decimal) -> Decimal:
    if occupancy_rate >= Decimal("0.95"):
        return OCCUPANCY_TIER_95_MULTIPLIER
    if occupancy_rate >= Decimal("0.85"):
        return OCCUPANCY_TIER_85_MULTIPLIER
    if occupancy_rate >= Decimal("0.70"):
        return OCCUPANCY_TIER_70_MULTIPLIER
    return Decimal("1.00")


def _is_weekend_night(night_date: date) -> bool:
    # Friday night through Sunday — Python's weekday(): Friday=4, Saturday=5, Sunday=6.
    return night_date.weekday() in (4, 5, 6)


def _seasonal_multiplier(hotel, night_date: date) -> Decimal:
    for season in hotel.seasonal_rates.all():
        start = (season.start_month, season.start_day)
        end = (season.end_month, season.end_day)
        current = (night_date.month, night_date.day)
        # Handles a season that wraps across the year boundary
        # (e.g. dry season Nov 15 -> Mar 15) as well as one that doesn't.
        if start <= end:
            if start <= current <= end:
                return season.multiplier
        else:
            if current >= start or current <= end:
                return season.multiplier
    return Decimal("1.00")


def _has_event_premium(hotel, night_date: date) -> bool:
    for period in hotel.event_premium_periods.all():
        if abs((period.event_date - night_date).days) <= 7:
            return True
    return False


def _length_of_stay_discount(num_nights: int) -> Decimal:
    for threshold, discount in LENGTH_OF_STAY_DISCOUNTS:
        if num_nights >= threshold:
            return discount
    return Decimal("0.00")


def compute_dynamic_rate(*, room_type, check_in: date, check_out: date, occupancy_rate: Decimal, booking_made_at=None) -> dict:
    """Computes the full stay price, night by night, applying every
    rule from B.1.2 in a clear, documented order:
      1. Each night's rate = base_rate × occupancy × weekend × event × seasonal
      2. Last-minute adjustment applies to the WHOLE stay if booked
         within 48 hours of check-in (a stay-level fact, not a
         per-night one)
      3. Length-of-stay discount applies LAST, as a percentage off the
         total — it's a loyalty/volume discount on the whole stay, not
         a multiplier that should compound with nightly demand pricing.
    Returns a full breakdown, not just a final number, so a receipt or
    booking confirmation can show a guest exactly why they're being
    charged what they're being charged."""
    from django.utils import timezone

    hotel = room_type.hotel
    num_nights = (check_out - check_in).days
    if num_nights <= 0:
        raise ValueError("check_out must be after check_in.")

    nightly_breakdown = []
    current_night = check_in
    while current_night < check_out:
        multiplier = _occupancy_multiplier(occupancy_rate)
        applied_weekend = _is_weekend_night(current_night)
        if applied_weekend:
            multiplier *= WEEKEND_PREMIUM_MULTIPLIER
        applied_event = _has_event_premium(hotel, current_night)
        if applied_event:
            multiplier *= hotel.event_premium_multiplier
        season_multiplier = _seasonal_multiplier(hotel, current_night)
        multiplier *= season_multiplier

        night_rate = (room_type.base_rate_xaf * multiplier).quantize(Decimal("1"))
        nightly_breakdown.append({
            "date": current_night, "rate_xaf": night_rate,
            "weekend_premium_applied": applied_weekend, "event_premium_applied": applied_event,
        })
        current_night += timedelta(days=1)

    subtotal = sum(n["rate_xaf"] for n in nightly_breakdown)

    booking_made_at = booking_made_at or timezone.now()
    is_last_minute = (check_in - booking_made_at.date()).days * 24 <= LAST_MINUTE_WINDOW_HOURS
    if is_last_minute:
        subtotal = (subtotal * hotel.last_minute_multiplier).quantize(Decimal("1"))

    stay_discount_rate = _length_of_stay_discount(num_nights)
    discount_amount = (subtotal * stay_discount_rate).quantize(Decimal("1"))
    total = subtotal - discount_amount

    return {
        "nightly_breakdown": nightly_breakdown,
        "num_nights": num_nights,
        "subtotal_xaf": subtotal,
        "last_minute_adjustment_applied": is_last_minute,
        "length_of_stay_discount_rate": stay_discount_rate,
        "length_of_stay_discount_xaf": discount_amount,
        "total_xaf": total,
    }


# ---------------------------------------------------------------------------
# Reservation, check-in/check-out, and the guest folio.
# ---------------------------------------------------------------------------
class NoAvailableRoomError(Exception):
    pass


class InvalidRoomStatusError(Exception):
    pass


def create_reservation(*, hotel, guest, room_type, check_in: date, check_out: date, adults=1, children=0, source="DIRECT", special_requests="", occupancy_rate: Decimal = Decimal("0.5")):
    """Locks in the total rate from compute_dynamic_rate() at booking
    time — see Reservation.rate_xaf's own docstring for why."""
    from .models import Reservation

    pricing = compute_dynamic_rate(room_type=room_type, check_in=check_in, check_out=check_out, occupancy_rate=occupancy_rate)
    return Reservation.objects.create(
        hotel=hotel, guest=guest, room_type=room_type, check_in=check_in, check_out=check_out,
        adults=adults, children=children, rate_xaf=pricing["total_xaf"], source=source, special_requests=special_requests,
    )


def check_in_guest(*, reservation, assigned_by):
    """Real enforcement of the spec's explicit rule: 'housekeeping
    status must be Clean and Inspected before assignment is permitted'
    — a room in DIRTY, CLEAN (not yet inspected), OUT_OF_ORDER, or any
    other non-INSPECTED state is never eligible, no matter how urgently
    a guest needs a room."""
    from django.utils import timezone
    from .models import Room, RoomStatus, RoomAssignment, ReservationStatus, GuestFolio

    available_room = Room.objects.filter(
        hotel=reservation.hotel, room_type=reservation.room_type, status=RoomStatus.INSPECTED,
    ).first()
    if available_room is None:
        raise NoAvailableRoomError("No inspected, available room of this type right now.")

    RoomAssignment.objects.create(reservation=reservation, room=available_room, assigned_by=assigned_by)
    available_room.status = RoomStatus.OCCUPIED
    available_room.save(update_fields=["status"])

    reservation.status = ReservationStatus.CHECKED_IN
    reservation.save(update_fields=["status"])

    return GuestFolio.objects.create(reservation=reservation)


def post_folio_charge(*, folio, charge_type, description: str, amount_xaf: Decimal, posted_by=None, reason_code: str = ""):
    from .models import FolioCharge, FolioChargeType
    if charge_type == FolioChargeType.ADJUSTMENT and not reason_code:
        raise ValueError("Adjustments require a reason_code, per the spec's audit-trail requirement.")
    return FolioCharge.objects.create(
        folio=folio, charge_type=charge_type, description=description,
        amount_xaf=amount_xaf, posted_by=posted_by, reason_code=reason_code,
    )


def run_end_of_day_room_charge_posting(hotel, night_date: date = None):
    """'Room Rate: Posted automatically each night at the end-of-day
    system run' — meant to run once daily via a scheduled job; posts
    tonight's room charge to every currently-open folio at this hotel."""
    from django.utils import timezone
    from .models import ReservationStatus, FolioChargeType

    night_date = night_date or timezone.now().date()
    posted = []
    for reservation in hotel.reservations.filter(status=ReservationStatus.CHECKED_IN):
        folio = getattr(reservation, "folio", None)
        if folio is None or folio.status != "OPEN":
            continue
        nightly_rate = reservation.rate_xaf / max((reservation.check_out - reservation.check_in).days, 1)
        charge = post_folio_charge(
            folio=folio, charge_type=FolioChargeType.ROOM,
            description=f"Room charge for {night_date.isoformat()}", amount_xaf=nightly_rate.quantize(Decimal("1")),
        )
        posted.append(charge)
    return posted


def checkout_guest(reservation):
    """Settles the stay: closes the folio, frees the room (into DIRTY —
    the actual trigger for a housekeeping alert, per the spec), and
    returns the final balance for the front desk to collect."""
    from django.utils import timezone
    from .models import ReservationStatus, RoomStatus, FolioStatus

    folio = reservation.folio
    folio.status = FolioStatus.CLOSED
    folio.closed_at = timezone.now()
    folio.save(update_fields=["status", "closed_at"])

    reservation.status = ReservationStatus.CHECKED_OUT
    reservation.save(update_fields=["status"])

    room = reservation.room_assignment.room
    room.status = RoomStatus.DIRTY
    room.save(update_fields=["status"])

    return folio.balance_xaf


# ---------------------------------------------------------------------------
# Group bookings.
# ---------------------------------------------------------------------------
def create_group_booking(*, hotel, group_name: str, arrival: date, departure: date, event_type: str = "", corporate_account=None):
    from .models import GroupBooking
    return GroupBooking.objects.create(
        hotel=hotel, group_name=group_name, arrival=arrival, departure=departure,
        event_type=event_type, corporate_account=corporate_account,
    )


def add_reservation_to_group(*, group_booking, guest, room_type, adults=1, children=0, occupancy_rate: Decimal = Decimal("0.5")):
    """Creates one individual reservation FROM the rooming list,
    correctly linked back to the master group booking — per the spec's
    'individual reservation records created for each room from the
    rooming list, master booking links all of them.'"""
    reservation = create_reservation(
        hotel=group_booking.hotel, guest=guest, room_type=room_type,
        check_in=group_booking.arrival, check_out=group_booking.departure,
        adults=adults, children=children, occupancy_rate=occupancy_rate,
    )
    reservation.group_booking = group_booking
    reservation.save(update_fields=["group_booking"])
    return reservation


# ---------------------------------------------------------------------------
# Financial Dashboard (B.4.2) — a real gap: the spec explicitly named
# this ('Total Bookings,' 'Revenue Trend Charts,' 'Outstanding
# Payments,' 'Escrow Status,' 'Platform Commission,' 'Top Room Types
# by Revenue') and nothing built it before now.
# ---------------------------------------------------------------------------
def get_hotel_financial_dashboard(hotel, period_days: int = 30):
    from decimal import Decimal
    from oaziland.analytics import compute_period_over_period, top_n_by_aggregate
    from .models import Reservation, ReservationStatus, GuestFolio, FolioStatus

    reservations = Reservation.objects.filter(hotel=hotel)
    revenue_trend = compute_period_over_period(
        queryset=reservations, date_field="created_at", aggregate_field="rate_xaf", period_days=period_days,
    )
    bookings_trend = compute_period_over_period(queryset=reservations, date_field="created_at", period_days=period_days)

    top_room_types = top_n_by_aggregate(
        queryset=reservations.filter(status__in=[ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT]),
        group_by_field="room_type__category", aggregate_field="rate_xaf",
    )

    open_folios = GuestFolio.objects.filter(reservation__hotel=hotel, status=FolioStatus.OPEN)
    outstanding_balance = sum((f.balance_xaf for f in open_folios if f.balance_xaf > 0), Decimal("0"))

    escrow_by_status = {}
    for reservation in reservations.exclude(booking__isnull=True):
        if hasattr(reservation.booking, "escrow"):
            status = reservation.booking.escrow.status
            escrow_by_status[status] = escrow_by_status.get(status, 0) + 1

    return {
        "total_bookings": reservations.count(),
        "bookings_trend": bookings_trend,
        "revenue_trend_xaf": revenue_trend,
        "top_room_types_by_revenue": top_room_types,
        "outstanding_balance_xaf": outstanding_balance,
        "escrow_status_breakdown": escrow_by_status,
    }
