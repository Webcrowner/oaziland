"""Support's view of marketplace return requests: what buyers asked for, what sellers answered and which ones reached
support as a dispute (those are decided in the console's disputes queue, which this links to)."""
from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from oaziland.permissions import IsAdminRole
from .fulfilment import buyer_decide_by, respond_by
from .models import MarketplaceReturnRequest, ReturnStatus

STATES = {
    "all": Q(),
    "waiting": Q(status=ReturnStatus.REQUESTED),
    "rejected": Q(status=ReturnStatus.REJECTED),
    "escalated": Q(status=ReturnStatus.ESCALATED),
    "accepted": Q(status=ReturnStatus.ACCEPTED),
    "closed": Q(status__in=[ReturnStatus.WITHDRAWN, ReturnStatus.CLOSED]),
}


def _person(user) -> dict:
    return {"id": str(user.pk), "name": user.full_name or user.username, "username": user.username}


def request_row(request) -> dict:
    from .offers import category_of
    order = request.order
    listing = order.listing
    return {
        "id": str(request.pk), "status": request.status, "kind": request.kind, "reason": request.reason,
        "description": request.description, "evidence_urls": request.evidence_urls,
        "requested_amount_xaf": str(request.requested_amount_xaf) if request.requested_amount_xaf is not None else None,
        "seller_note": request.seller_note, "created_at": request.created_at, "responded_at": request.responded_at,
        "resolved_at": request.resolved_at, "respond_by": respond_by(request), "buyer_decide_by": buyer_decide_by(request),
        "age_hours": int((timezone.now() - request.created_at).total_seconds() // 3600),
        "order": {
            "id": str(order.pk), "status": order.status, "amount_xaf": str(order.amount_xaf), "quantity": order.quantity,
            "listing_id": str(listing.pk), "listing_title": listing.title, "category": category_of(listing),
            "delivery_method": order.delivery_method, "shipment_status": order.shipment_status,
        },
        "buyer": _person(order.buyer), "seller": _person(listing.lister_user),
        "dispute_id": getattr(request, "dispute_id", None),
    }


class AdminReturnRequestViewSet(viewsets.GenericViewSet):
    """GET ?state=all|waiting|rejected|escalated|accepted|closed &q= (listing title, buyer or seller name, order id), paged.
    GET summary/ for the counts. Read-only: refunds are decided by sellers, or by support through the disputes queue."""
    permission_classes = [IsAdminRole]
    queryset = MarketplaceReturnRequest.objects.none()

    def _queryset(self, state: str, query: str):
        rows = MarketplaceReturnRequest.objects.filter(STATES[state]).select_related(
            "order__listing__lister_user", "order__buyer", "order__booking",
            "order__listing__warehouselisting", "order__listing__storelisting", "order__listing__businesslisting",
            "order__listing__carlisting", "order__listing__goodslisting",
        )
        if query:
            rows = rows.filter(
                Q(order__listing__title__icontains=query) | Q(order__buyer__username__icontains=query)
                | Q(order__buyer__first_name__icontains=query) | Q(order__buyer__last_name__icontains=query)
                | Q(order__listing__lister_user__username__icontains=query) | Q(order__id__icontains=query),
            )
        return rows.order_by("-created_at")

    @extend_schema(responses={200: dict, 400: dict})
    def list(self, request):
        from property_management.models import DisputeCase
        state = request.query_params.get("state", "waiting")
        if state not in STATES:
            return Response({"detail": f"Choose one of: {', '.join(STATES)}."}, status=400)
        page = self.paginate_queryset(self._queryset(state, request.query_params.get("q", "").strip()))
        escrows = [r.order.booking.escrow.pk for r in page if r.status == ReturnStatus.ESCALATED and hasattr(r.order.booking, "escrow")]
        disputes = dict(DisputeCase.objects.filter(escrow_id__in=escrows).order_by("created_at").values_list("escrow_id", "id"))
        for r in page:
            if r.status == ReturnStatus.ESCALATED and hasattr(r.order.booking, "escrow"):
                r.dispute_id = str(disputes.get(r.order.booking.escrow.pk) or "") or None
        return self.get_paginated_response([request_row(r) for r in page])

    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"])
    def summary(self, request):
        now = timezone.now()
        counts = {row["status"]: row["n"] for row in MarketplaceReturnRequest.objects.values("status").annotate(n=Count("id"))}
        overdue = MarketplaceReturnRequest.objects.filter(status=ReturnStatus.REQUESTED, created_at__lt=now - timedelta(hours=48)).count()
        return Response({
            "waiting": counts.get(ReturnStatus.REQUESTED, 0), "rejected": counts.get(ReturnStatus.REJECTED, 0),
            "escalated": counts.get(ReturnStatus.ESCALATED, 0), "accepted": counts.get(ReturnStatus.ACCEPTED, 0),
            "closed": counts.get(ReturnStatus.WITHDRAWN, 0) + counts.get(ReturnStatus.CLOSED, 0),
            "waiting_over_48h": overdue, "total": sum(counts.values()),
        })
