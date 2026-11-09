"""
trust_safety.payments — the admin's view of money moving through the platform.

Every escrowed payment (property rentals, marketplace orders, rides, jobs, hotel stays, events...) is a
Booking with an optional PaymentEscrow. This module turns those into rows an admin can read (what was
paid for, by whom, to whom, where the money is now), filters and totals them by service, and spots payments
stuck half-way. It is read-only: money is moved through disputes, withdrawals and the services themselves.
"""
import uuid
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, F, Q, Sum
from django.utils import timezone

from transactions.models import Booking, BookingStatus, BookingType, EscrowStatus

STATES = ("all", "held", "released", "refunded", "disputed", "failed", "processing")
STUCK_AFTER = timedelta(minutes=15)
MAX_PERIOD_DAYS = 365


def _name(user) -> str:
    return (user.full_name or user.username) if user else ""


def _person(user):
    if user is None:
        return None
    return {"id": str(user.pk), "name": _name(user), "username": user.username}


def _snippet(text: str, limit: int = 60) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "\u2026"


def describe_booking(booking) -> dict:
    """What the payment is for and who gets paid, in words: {"title", "payee", "note"}."""
    fallback = {"title": booking.get_booking_type_display(), "payee": None, "note": ""}
    try:
        return _describe(booking, fallback)
    except Exception:  # a broken or deleted target must never hide the payment itself
        return fallback


def _describe(booking, fallback: dict) -> dict:
    kind, target_id = booking.target_content_type, booking.target_id

    if kind == "property.Listing":
        from property.models import Listing
        listing = Listing.objects.select_related("property_asset__quarter", "listed_by").filter(pk=target_id).first()
        if listing:
            asset = listing.property_asset
            return {"title": f"{asset.get_type_display()} \u00b7 {asset.quarter.name}", "payee": _person(listing.listed_by), "note": ""}

    elif kind.startswith("marketplace.") and kind != "marketplace.RideBooking":
        from marketplace.models import MarketplaceOrder
        order = MarketplaceOrder.objects.select_related("listing__lister_user").filter(
            Q(booking=booking) | Q(deposit_booking=booking),
        ).first()
        if order:
            is_deposit = order.deposit_booking_id == booking.pk
            return {"title": order.listing.title, "payee": _person(order.listing.lister_user), "note": "deposit" if is_deposit else ""}

    elif kind == "marketplace.RideBooking":
        from marketplace.models import RideBooking
        ride = RideBooking.objects.select_related("driver").filter(pk=target_id).first()
        if ride:
            return {"title": f"{ride.pickup_description} \u2192 {ride.dropoff_description}", "payee": _person(ride.driver), "note": ""}

    elif kind == "hotels.Reservation":
        from hotels.models import Reservation
        reservation = Reservation.objects.select_related("hotel__owner").filter(pk=target_id).first()
        if reservation:
            hotel = reservation.hotel
            return {"title": hotel.name or str(hotel), "payee": _person(hotel.owner), "note": ""}

    elif kind == "events.EventBooking":
        from events.models import EventBooking
        event = EventBooking.objects.select_related("venue_space__venue__owner").filter(pk=target_id).first()
        if event:
            venue = event.venue_space.venue
            note = "balance" if event.balance_booking_id == booking.pk else "deposit"
            return {"title": f"{event.get_event_type_display()} \u00b7 {venue}", "payee": _person(venue.owner), "note": note}

    elif kind == "services.ServiceRequest":
        from services.models import ServiceRequest
        job = ServiceRequest.objects.select_related("technician").filter(pk=target_id).first()
        if job:
            label = job.get_category_display()
            return {"title": f"{label} \u00b7 {_snippet(job.description)}" if job.description else label, "payee": _person(job.technician), "note": ""}

    return fallback


def is_stuck(booking) -> bool:
    return booking.status == BookingStatus.PAYMENT_PROCESSING and booking.updated_at <= timezone.now() - STUCK_AFTER


def money(value) -> str:
    return f"{Decimal(value or 0):.2f}"


def payment_row(booking) -> dict:
    escrow = getattr(booking, "escrow", None)
    dispute = getattr(escrow, "dispute_case", None) if escrow else None
    described = describe_booking(booking)
    return {
        "id": str(booking.pk),
        "booking_type": booking.booking_type,
        "status": booking.status,
        "amount_xaf": money(booking.amount_xaf),
        "currency": booking.currency,
        "created_at": booking.created_at,
        "updated_at": booking.updated_at,
        "requester": _person(booking.requester),
        "title": described["title"],
        "payee": described["payee"],
        "note": described["note"],
        "stuck": is_stuck(booking),
        "escrow": {
            "status": escrow.status, "gross_xaf": money(escrow.gross_amount_xaf), "fee_xaf": money(escrow.platform_fee_xaf),
            "payee_xaf": money(escrow.payee_amount_xaf), "refunded_xaf": money(escrow.refunded_amount_xaf), "provider": escrow.provider,
            "provider_reference": escrow.provider_reference or "", "held_at": escrow.held_at, "released_at": escrow.released_at,
        } if escrow else None,
        "dispute": {"id": str(dispute.pk), "status": dispute.status} if dispute else None,
    }


def payments_queryset(*, booking_type: str = "", state: str = "all", query: str = "", since=None, until=None):
    qs = Booking.objects.select_related("requester", "escrow", "escrow__dispute_case")
    if booking_type:
        qs = qs.filter(booking_type=booking_type)
    if state in ("held", "released", "refunded", "disputed"):
        qs = qs.filter(escrow__status=state.upper())
    elif state == "failed":
        qs = qs.filter(status=BookingStatus.PAYMENT_FAILED)
    elif state == "processing":
        qs = qs.filter(status=BookingStatus.PAYMENT_PROCESSING)
    if since:
        qs = qs.filter(created_at__date__gte=since)
    if until:
        qs = qs.filter(created_at__date__lte=until)
    for term in query.split()[:4]:
        match = (
            Q(requester__username__icontains=term) | Q(requester__first_name__icontains=term)
            | Q(requester__last_name__icontains=term) | Q(requester__phone__icontains=term)
            | Q(escrow__provider_reference__icontains=term)
        )
        try:
            match |= Q(pk=uuid.UUID(term))
        except ValueError:
            pass
        qs = qs.filter(match)
    return qs.order_by("-created_at")


def payments_summary(days: int) -> dict:
    """Money by service for payments made in the last `days` days, plus what needs attention right now."""
    since = timezone.now() - timedelta(days=days)
    escrows = Booking.objects.filter(escrow__isnull=False, escrow__held_at__gte=since)

    by_type = []
    # A payment split by a dispute is RELEASED with part refunded, so released and refunded money are counted by
    # amount, not by the payment's status alone.
    released_part = F("escrow__gross_amount_xaf") - F("escrow__refunded_amount_xaf")
    rows = escrows.values("booking_type").annotate(
        count=Count("pk"), gross=Sum("escrow__gross_amount_xaf"), fees=Sum("escrow__platform_fee_xaf"),
        held=Sum("escrow__gross_amount_xaf", filter=Q(escrow__status=EscrowStatus.HELD)),
        disputed=Sum("escrow__gross_amount_xaf", filter=Q(escrow__status=EscrowStatus.DISPUTED)),
        refunded=Sum("escrow__refunded_amount_xaf"),
    ).order_by("-gross")
    labels = dict(BookingType.choices)
    for row in rows:
        by_type.append({
            "booking_type": row["booking_type"], "label": labels.get(row["booking_type"], row["booking_type"]),
            "count": row["count"], "gross_xaf": money(row["gross"]), "fees_xaf": money(row["fees"]),
            "held_xaf": money(row["held"]), "disputed_xaf": money(row["disputed"]), "refunded_xaf": money(row["refunded"]),
        })

    def total(status):
        return money(escrows.filter(escrow__status=status).aggregate(t=Sum("escrow__gross_amount_xaf"))["t"])

    return {
        "days": days,
        "totals": {
            "held_xaf": total(EscrowStatus.HELD),
            "released_xaf": money(escrows.filter(escrow__status=EscrowStatus.RELEASED).aggregate(t=Sum(released_part))["t"]),
            "refunded_xaf": money(escrows.aggregate(t=Sum("escrow__refunded_amount_xaf"))["t"]),
            "disputed_xaf": total(EscrowStatus.DISPUTED),
            "fees_xaf": money(escrows.filter(escrow__status=EscrowStatus.RELEASED).aggregate(t=Sum("escrow__platform_fee_xaf"))["t"]),
        },
        "by_type": by_type,
        "attention": attention_counts(),
    }


def attention_counts() -> dict:
    now = timezone.now()
    return {
        "stuck": Booking.objects.filter(status=BookingStatus.PAYMENT_PROCESSING, updated_at__lte=now - STUCK_AFTER).count(),
        "failed_24h": Booking.objects.filter(status=BookingStatus.PAYMENT_FAILED, updated_at__gte=now - timedelta(hours=24)).count(),
    }


def stuck_payment_count() -> int:
    return attention_counts()["stuck"]
