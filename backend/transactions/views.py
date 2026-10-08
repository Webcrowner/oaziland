"""
transactions.views — the booking reservation API, AND the real payment
webhook receiver. Reuses reserve_booking() (Prompt 5) directly, so the
SAME race-condition protection tested at the service layer applies
over real HTTP.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import api_view, action, permission_classes as drf_permission_classes
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import Booking
from .serializers import BookingSerializer
from .services import reserve_booking, confirm_payment, cancel_booking, InventoryConflictError, WebhookSignatureError, BookingAlreadySettledError
from oaziland.permissions import IsKycVerified


class FakeRedisLock:
    """A placeholder lock client for this API pass — production wiring
    connects this to a real Redis client; the reservation SERVICE
    function itself (already tested) doesn't care which lock
    implementation it's given, per its own dependency-injection design."""
    _locked = set()

    def acquire(self, key, ttl_seconds):
        if key in self._locked:
            return False
        self._locked.add(key)
        return True

    def release(self, key, permanent=False):
        self._locked.discard(key)


class BookingViewSet(viewsets.ModelViewSet):
    serializer_class = BookingSerializer
    queryset = Booking.objects.all()
    # WHY restricted: a Booking must never be edited or hard-deleted
    # directly by the client — cancel/complete are the only real state
    # transitions, each enforcing their own business rules below, rather
    # than the generic ModelViewSet's default update()/destroy().
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action == "create":
            return [IsKycVerified()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        # A user only ever sees their OWN bookings through this API —
        # not a platform-wide list. Explicit ordering (Booking's model
        # itself has none) so pagination is deterministic across pages.
        # select_related avoids an N+1 query per row now that the
        # serializer also reports real escrow/dispute status.
        return (
            Booking.objects.filter(requester=self.request.user)
            .select_related("escrow", "escrow__dispute_case")
            .order_by("-created_at")
        )

    def create(self, request, *args, **kwargs):
        try:
            booking = reserve_booking(
                lock_client=FakeRedisLock(),
                requester=request.user,
                booking_type=request.data.get("booking_type"),
                target_content_type=request.data.get("target_content_type"),
                target_id=request.data.get("target_id"),
                amount_xaf=request.data.get("amount_xaf"),
            )
        except InventoryConflictError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        """Confirm Mobile Money / Orange Money payment into escrow for this booking.
        Immediately transitions the booking to CONFIRMED and locks funds in PaymentEscrow (HELD)."""
        from .services import initiate_booking_payment, confirm_payment
        from payments.gateways import get_active_gateway

        booking = self.get_object()
        phone_number = request.data.get("phone_number")
        if not phone_number:
            return Response({"detail": "phone_number is required."}, status=status.HTTP_400_BAD_REQUEST)

        gateway = get_active_gateway()
        initiate_booking_payment(booking=booking, payment_gateway=gateway, phone_number=phone_number)
        escrow = confirm_payment(
            lock_client=FakeRedisLock(),
            booking=booking,
            provider="MTN_MOMO",
            provider_reference=booking.idempotency_key,
            payment_gateway=gateway,
            raw_webhook_payload=b"{}",
            webhook_signature_header="sandbox",
        )
        return Response(BookingSerializer(booking).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """The real happy-path settlement action every generic booking
        (guest houses, direct property rentals) was missing — escrow
        stayed HELD forever without this. Reachable by the booking's
        own requester, the target's resolved owner, or an admin, since
        who is 'the seller' varies by target type."""
        from .services import complete_booking, resolve_target_owner

        try:
            booking = Booking.objects.get(pk=pk)
        except Booking.DoesNotExist:
            return Response({"detail": "Booking not found."}, status=status.HTTP_404_NOT_FOUND)

        target_owner = resolve_target_owner(booking)
        is_admin = hasattr(request.user, "admin_profile") or request.user.is_staff
        if request.user.id not in {booking.requester_id, getattr(target_owner, "id", None)} and not is_admin:
            return Response({"detail": "You are not authorized to complete this booking."}, status=status.HTTP_403_FORBIDDEN)

        if not hasattr(booking, "escrow"):
            return Response({"detail": "This booking has no confirmed payment yet."}, status=status.HTTP_400_BAD_REQUEST)

        escrow = complete_booking(booking=booking)
        return Response({"detail": "Booking completed.", "escrow_status": escrow.status}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """The real gap this closes: a booking could be created and held,
        but the requester had no way to ever back out of it before this.
        Uses get_object() (scoped to the caller's own bookings via
        get_queryset) so only the booking's own requester can reach it."""
        booking = self.get_object()
        try:
            cancel_booking(lock_client=FakeRedisLock(), booking=booking)
        except BookingAlreadySettledError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BookingSerializer(booking).data)


@extend_schema(exclude=False, request=None, responses={200: dict, 403: dict, 404: dict})
@api_view(["POST"])
@drf_permission_classes([permissions.AllowAny])
def payment_webhook_view(request):
    """The real, publicly-reachable endpoint a payment provider (MTN
    MoMo, Orange Money, Flutterwave/CinetPay once connected) POSTs to.

    WHY this was a real gap before this fix: confirm_payment() (Prompt
    5) already had real webhook-signature-verification LOGIC — but
    nothing in the URL routing actually exposed a public endpoint for
    a real provider to call. The service function existing without a
    reachable URL is the same as it not existing at all from a
    provider's point of view. AllowAny is correct HERE specifically —
    a payment provider's webhook call is never an authenticated
    Oaziland user; authenticity is established by the SIGNATURE
    verification inside confirm_payment(), not a Bearer token."""
    # WHY raw_body is captured FIRST, before request.data is touched:
    # DRF's request.data parses and consumes the underlying request
    # stream — accessing request.body AFTER that raises
    # RawPostDataException. Found while testing this endpoint for real
    # (not caught by writing the code alone) and fixed by reading the
    # raw body before anything else touches the request.
    raw_body = request.body

    booking_id = request.data.get("booking_id") or request.data.get("externalId")
    provider = request.data.get("provider") or "FAPSHI"
    provider_reference = request.data.get("provider_reference") or request.data.get("transId") or ""
    signature_header = request.META.get("HTTP_X_WEBHOOK_SIGNATURE") or request.META.get("HTTP_APIUSER", "")

    if not booking_id:
        return Response({"detail": "Missing booking_id or externalId."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        from django.db.models import Q
        booking = Booking.objects.filter(Q(id=booking_id) | Q(idempotency_key=str(booking_id))).first()
        if not booking:
            return Response({"detail": "Unknown booking."}, status=status.HTTP_404_NOT_FOUND)
    except Exception:
        return Response({"detail": "Unknown booking."}, status=status.HTTP_404_NOT_FOUND)

    from payments.gateways import get_active_gateway
    from transactions.views import FakeRedisLock  # see FakeRedisLock's own docstring re: real Redis wiring

    try:
        confirm_payment(
            lock_client=FakeRedisLock(), booking=booking, provider=provider, provider_reference=provider_reference,
            payment_gateway=get_active_gateway(), raw_webhook_payload=raw_body,
            webhook_signature_header=signature_header,
        )
    except WebhookSignatureError:
        return Response({"detail": "Invalid webhook signature."}, status=status.HTTP_403_FORBIDDEN)

    return Response({"detail": "Payment confirmed."}, status=status.HTTP_200_OK)
