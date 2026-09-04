"""
transactions.views — the booking reservation API, AND the real payment
webhook receiver. Reuses reserve_booking() (Prompt 5) directly, so the
SAME race-condition protection tested at the service layer applies
over real HTTP.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import api_view, permission_classes as drf_permission_classes
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import Booking
from .serializers import BookingSerializer
from .services import reserve_booking, confirm_payment, InventoryConflictError, WebhookSignatureError
from oaziland.permissions import IsVerifiedAndMfaEnabled


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

    def get_permissions(self):
        if self.action == "create":
            return [IsVerifiedAndMfaEnabled()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        # A user only ever sees their OWN bookings through this API —
        # not a platform-wide list. Explicit ordering (Booking's model
        # itself has none) so pagination is deterministic across pages.
        return Booking.objects.filter(requester=self.request.user).order_by("-created_at")

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

    booking_id = request.data.get("booking_id")
    provider = request.data.get("provider")
    provider_reference = request.data.get("provider_reference")
    signature_header = request.META.get("HTTP_X_WEBHOOK_SIGNATURE", "")

    try:
        booking = Booking.objects.get(id=booking_id)
    except Booking.DoesNotExist:
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
