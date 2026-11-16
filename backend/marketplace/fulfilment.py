"""
What happens between the handover and the money moving, for orders paid into escrow:

* Shipment tracking for goods the seller delivers or sends by courier: courier, tracking number, a timeline and a
  delivery proof photo. The first update also hands the order over, so the seller's deadline and the buyer's
  confirmation flow work as they do for a plain handover; a parcel still on its way keeps the payment held longer.
* Return requests (full or partial refund, or a replacement) while the payment is still held. The seller accepts or
  rejects; a rejected or unanswered request can go to support, and while one is open nothing is released automatically.
"""
from datetime import timedelta
from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils import timezone

# services imports this module only inside functions, so importing it here is safe.
from . import services
from .models import (
    MarketplaceOrder, MarketplaceOrderStatus, MarketplaceReturnRequest, ReturnKind, ReturnReason, ReturnStatus, ShipmentStatus,
)

# How long a parcel that left the seller may take before the payment is released as if it had been delivered.
SHIPPING_TRANSIT_DAYS = 7
RETURN_RESPONSE_HOURS = 72
# After a seller rejects a request the buyer has this long to take it to support before it closes.
RETURN_BUYER_DECISION_HOURS = 72
MAX_EVIDENCE_PHOTOS = 5
OPEN_RETURN_STATUSES = (ReturnStatus.REQUESTED, ReturnStatus.REJECTED)
SHIPMENT_FLOW = (ShipmentStatus.IN_TRANSIT, ShipmentStatus.OUT_FOR_DELIVERY, ShipmentStatus.DELIVERED)
TRACKED_DELIVERY_METHODS = ("SELLER", "COURIER")

SHIPMENT_TEXT = {
    ShipmentStatus.IN_TRANSIT: "is on its way",
    ShipmentStatus.OUT_FOR_DELIVERY: "is out for delivery",
    ShipmentStatus.DELIVERED: "was delivered",
}


def auto_release_at(order):
    """When the payment of a handed-over order is released if the buyer does nothing: ORDER_AUTO_RELEASE_HOURS after
    the handover, after the delivery for a tracked parcel, or after SHIPPING_TRANSIT_DAYS for one not yet delivered."""
    if order.status != MarketplaceOrderStatus.HANDED_OVER or order.handed_over_at is None:
        return None
    base = order.handed_over_at
    if order.shipment_status == ShipmentStatus.DELIVERED and order.delivered_at:
        base = max(base, order.delivered_at)
    elif order.shipment_status:
        base = max(base, order.shipped_at or base) + timedelta(days=SHIPPING_TRANSIT_DAYS)
    return base + timedelta(hours=services.ORDER_AUTO_RELEASE_HOURS)


def is_tracked(order) -> bool:
    return order.delivery_method in TRACKED_DELIVERY_METHODS


def update_shipment(*, order, seller, status: str, courier_name: str = "", tracking_number: str = "", note: str = "", proof_url: str = ""):
    """The seller posts where the parcel is. Only goods the seller delivers or sends by courier can be tracked."""
    services._require_seller(order, seller)
    if not is_tracked(order):
        raise services.OrderError("Only orders with delivery can be tracked. Use \"Mark as handed over\" for a pickup.")
    if order.status not in (MarketplaceOrderStatus.PAID, MarketplaceOrderStatus.HANDED_OVER) or not services._escrow_is_held(order):
        raise services.OrderError("This order can't be updated right now.")
    if status not in SHIPMENT_FLOW:
        raise services.OrderError("Choose a valid shipment status.")
    if order.shipment_status and SHIPMENT_FLOW.index(status) < SHIPMENT_FLOW.index(order.shipment_status):
        raise services.OrderError("A parcel can't go back to an earlier step.")
    note = note.strip()
    courier_name = (courier_name or order.courier_name).strip()
    if order.delivery_method == "COURIER" and not courier_name:
        raise services.OrderError("Enter the name of the courier or agency.")
    if status == ShipmentStatus.DELIVERED and not (proof_url or note):
        raise services.OrderError("Add a photo of the delivery or a short note as proof.")
    if order.status == MarketplaceOrderStatus.PAID:
        services.mark_handed_over(order=order, seller=seller)
    now = timezone.now()
    events = list(order.shipment_events or []) + [{"status": status, "note": note[:300], "at": now.isoformat()}]
    changes = {
        "shipment_status": status, "courier_name": courier_name[:80],
        "tracking_number": (tracking_number or order.tracking_number).strip()[:60],
        "shipped_at": order.shipped_at or now, "shipment_events": events,
    }
    if status == ShipmentStatus.DELIVERED:
        changes.update(delivered_at=now, delivery_proof_url=proof_url, delivery_note=note[:300])
    if not MarketplaceOrder.objects.filter(pk=order.pk, status=MarketplaceOrderStatus.HANDED_OVER).update(**changes):
        raise services.OrderError("This order can't be updated right now.")
    order.refresh_from_db()
    what = SHIPMENT_TEXT[status]
    detail = f" Tracking number: {order.tracking_number} ({order.courier_name})." if order.tracking_number else ""
    if status == ShipmentStatus.DELIVERED:
        detail += (
            f" Confirm you received it or ask for a return. If you do nothing, the payment is released to the seller on "
            f"{services.timezone_local_text(auto_release_at(order))}."
        )
    services._notify_order(order.buyer, f"Your parcel {what}", f"\"{order.listing.title}\" {what}.{detail}", order)
    return order


# ---------------------------------------------------------------------------
# Return requests
# ---------------------------------------------------------------------------
def has_open_return(order) -> bool:
    return order.return_requests.filter(status__in=OPEN_RETURN_STATUSES).exists()


def _open_request(order, *statuses):
    return order.return_requests.filter(status__in=statuses or OPEN_RETURN_STATUSES).first()


def respond_by(request):
    """When an unanswered request goes to support on its own."""
    return request.created_at + timedelta(hours=RETURN_RESPONSE_HOURS) if request.status == ReturnStatus.REQUESTED else None


def buyer_decide_by(request):
    """When a rejected request closes if the buyer does nothing."""
    if request.status != ReturnStatus.REJECTED or request.responded_at is None:
        return None
    return request.responded_at + timedelta(hours=RETURN_BUYER_DECISION_HOURS)


def request_return(*, order, buyer, kind: str, reason: str, description: str, evidence_urls=(), requested_amount_xaf=None):
    services._require_buyer(order, buyer)
    if order.booked_dates or services.is_rental(order.listing):
        raise services.OrderError("Returns are for purchases. For a rental, report a problem or use the deposit.")
    if order.status != MarketplaceOrderStatus.HANDED_OVER or not services._escrow_is_held(order):
        raise services.OrderError("You can ask for a return once the seller has handed the item over and before you confirm you received it.")
    if order.shipment_status and order.shipment_status != ShipmentStatus.DELIVERED:
        raise services.OrderError("The seller hasn't marked your parcel as delivered yet. If it never arrives, report a problem instead.")
    if kind not in ReturnKind.values or reason not in ReturnReason.values:
        raise services.OrderError("Choose what you are asking for and why.")
    evidence = [url for url in evidence_urls if url][:MAX_EVIDENCE_PHOTOS]
    amount = None
    if kind == ReturnKind.PARTIAL_REFUND:
        amount = Decimal(requested_amount_xaf or 0)
        if not 0 < amount < order.booking.escrow.gross_amount_xaf:
            raise services.OrderError("A partial refund must be more than 0 and less than what you paid.")
    with db_transaction.atomic():
        locked = MarketplaceOrder.objects.select_for_update().get(pk=order.pk)
        if locked.status != MarketplaceOrderStatus.HANDED_OVER:
            raise services.OrderError("This order has changed in the meantime. Refresh and try again.")
        if has_open_return(locked):
            raise services.OrderError("You already have an open return request on this order.")
        request = MarketplaceReturnRequest.objects.create(
            order=order, kind=kind, reason=reason, description=description.strip(), evidence_urls=evidence,
            requested_amount_xaf=amount,
        )
    services._notify_order(
        order.listing.lister_user, "A buyer asked for a return",
        f"The buyer of \"{order.listing.title}\" asks for: {request.get_kind_display().lower()} ({request.get_reason_display().lower()}). "
        f"Accept or reject within {RETURN_RESPONSE_HOURS} hours, or it goes to support.",
        order,
    )
    return request


def _reset_for_replacement(order, now):
    events = list(order.shipment_events or []) + [{"status": "REPLACEMENT", "note": "Replacement agreed", "at": now.isoformat()}]
    MarketplaceOrder.objects.filter(pk=order.pk).update(
        handed_over_at=now, shipment_status="", shipped_at=None, delivered_at=None, delivery_proof_url="",
        delivery_note="", tracking_number="", shipment_events=events,
    )


def respond_return(*, order, seller, accept: bool, note: str = ""):
    """The seller accepts the request (a refund is paid back at once; a replacement restarts the buyer's confirmation
    time) or rejects it with a reason."""
    services._require_seller(order, seller)
    note = note.strip()
    now = timezone.now()
    if not accept and len(note) < 5:
        raise services.OrderError("Tell the buyer why you are rejecting the request.")
    request = _open_request(order, ReturnStatus.REQUESTED)
    if request is None:
        raise services.OrderError("There is no return request waiting for your answer.")
    if not accept:
        if not MarketplaceReturnRequest.objects.filter(pk=request.pk, status=ReturnStatus.REQUESTED).update(
            status=ReturnStatus.REJECTED, seller_note=note[:500], responded_at=now,
        ):
            raise services.OrderError("This request has already been answered.")
        services._notify_order(
            order.buyer, "Your return request was rejected",
            f"The seller of \"{order.listing.title}\" rejected it: {note}. You can send it to support within {RETURN_BUYER_DECISION_HOURS} hours.",
            order,
        )
        request.refresh_from_db()
        return request
    with db_transaction.atomic():
        if not MarketplaceReturnRequest.objects.filter(pk=request.pk, status=ReturnStatus.REQUESTED).update(
            status=ReturnStatus.ACCEPTED, seller_note=note[:500], responded_at=now, resolved_at=now,
        ):
            raise services.OrderError("This request has already been answered.")
        if request.kind == ReturnKind.REPLACEMENT:
            if order.status != MarketplaceOrderStatus.HANDED_OVER:
                raise services.OrderError("This order has changed in the meantime. Refresh and try again.")
            _reset_for_replacement(order, now)
            message = (
                f"The seller of \"{order.listing.title}\" accepted a replacement. You have {services.ORDER_AUTO_RELEASE_HOURS} hours "
                "from now to confirm what you receive or report a problem."
            )
        else:
            paid_back = order.booking.escrow.gross_amount_xaf if request.kind == ReturnKind.REFUND else request.requested_amount_xaf
            services._settle_held_order(
                order, paid_back, from_statuses=(MarketplaceOrderStatus.HANDED_OVER,), reference=f"return, order #{order.pk}",
            )
            message = f"The seller of \"{order.listing.title}\" accepted your request. {paid_back:,.0f} XAF was paid back to your Oaziland wallet."
    order.refresh_from_db()
    services._notify_order(order.buyer, "Your return request was accepted", message, order)
    request.refresh_from_db()
    return request


def withdraw_return(*, order, buyer):
    services._require_buyer(order, buyer)
    request = _open_request(order)
    if request is None or not MarketplaceReturnRequest.objects.filter(pk=request.pk, status=request.status).update(
        status=ReturnStatus.WITHDRAWN, resolved_at=timezone.now(),
    ):
        raise services.OrderError("There is no open return request to withdraw.")
    services._notify_order(order.listing.lister_user, "A return request was withdrawn", f"The buyer withdrew the return request on \"{order.listing.title}\".", order)
    request.refresh_from_db()
    return request


def escalate_return(*, order, buyer):
    """The buyer takes a rejected (or unanswered) request to support, which opens a dispute on the held payment."""
    services._require_buyer(order, buyer)
    request = _open_request(order)
    if request is None:
        raise services.OrderError("There is no open return request to send to support.")
    _escalate(order, request, buyer)
    request.refresh_from_db()
    return request


def _escalate(order, request, raised_by):
    reason = f"Return request ({request.get_kind_display()}, {request.get_reason_display()}): {request.description}"
    if request.seller_note:
        reason += f" | Seller's answer: {request.seller_note}"
    with db_transaction.atomic():
        if not MarketplaceReturnRequest.objects.filter(pk=request.pk, status=request.status).update(
            status=ReturnStatus.ESCALATED, resolved_at=timezone.now(),
        ):
            raise services.OrderError("This request has already been answered.")
        services.dispute_order(order=order, user=raised_by, reason=reason[:2000])


def process_return_requests(*, now=None) -> dict:
    """Scheduled sweep: a request the seller never answered goes to support; a rejected one the buyer let lie closes
    (the payment then follows the normal release)."""
    now = now or timezone.now()
    escalated, closed = [], []
    waiting = MarketplaceReturnRequest.objects.filter(
        status=ReturnStatus.REQUESTED, created_at__lt=now - timedelta(hours=RETURN_RESPONSE_HOURS),
    ).select_related("order__listing__lister_user", "order__buyer", "order__booking")
    for request in waiting:
        if request.order.status != MarketplaceOrderStatus.HANDED_OVER:
            # The buyer confirmed (or support settled the order) while the request was open: nothing left to decide.
            MarketplaceReturnRequest.objects.filter(pk=request.pk, status=ReturnStatus.REQUESTED).update(status=ReturnStatus.CLOSED, resolved_at=now)
            closed.append(request)
            continue
        if services._sweep_step(request.order, lambda: _escalate(request.order, request, request.order.buyer)):
            escalated.append(request)
            services._notify_order(
                request.order.buyer, "Your return request went to support",
                f"The seller of \"{request.order.listing.title}\" didn't answer in time, so support will decide.", request.order,
            )
    stale = MarketplaceReturnRequest.objects.filter(
        status=ReturnStatus.REJECTED, responded_at__lt=now - timedelta(hours=RETURN_BUYER_DECISION_HOURS),
    )
    for request in stale:
        if MarketplaceReturnRequest.objects.filter(pk=request.pk, status=ReturnStatus.REJECTED).update(status=ReturnStatus.CLOSED, resolved_at=now):
            closed.append(request)
    return {"escalated": escalated, "closed": closed}
