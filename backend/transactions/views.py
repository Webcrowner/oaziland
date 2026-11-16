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
from .models import Booking, BookingStatus, BookingType
from .serializers import BookingSerializer
from .services import (
    reserve_booking, confirm_payment, cancel_booking, refund_unconfirmable_payment, InventoryConflictError,
    WebhookSignatureError, BookingAlreadySettledError,
)
from oaziland.permissions import IsKycVerified
from .locks import get_booking_lock_client


def _priced_booking_request(data, requester):
    """(booking_type, amount_xaf, error) for a booking made through POST /api/bookings/. Only targets with a real
    price on the server can be booked here; everything else (hotels, events, marketplace, rides...) has its own
    priced flow. Hostel room types are handled before this (student_hostels.room_types.reserve_room_type)."""
    import uuid
    from property.models import Listing, ListingStatus, ListingType

    if data.get("target_content_type") != "property.Listing":
        return None, None, "Online reservation isn't available for this yet. Contact the owner to arrange it."
    try:
        target_id = uuid.UUID(str(data.get("target_id")))
    except (TypeError, ValueError):
        return None, None, "That listing was not found."
    listing = Listing.objects.select_related("property_asset").filter(pk=target_id, status=ListingStatus.PUBLISHED).first()
    if listing is None:
        return None, None, "That listing was not found or is no longer available."
    if listing.listed_by_id == requester.id or listing.property_asset.owner_id == requester.id:
        return None, None, "You can't book your own listing."
    booking_type = BookingType.GENERAL_RENTAL if listing.listing_type == ListingType.RENT else BookingType.LAND_RESERVATION
    return booking_type, listing.price_xaf, None


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
        # The amount is never taken from the request: anyone could otherwise edit it and book for 1 XAF.
        # It comes from the target's own price on the server, and only for targets that have one.
        from student_hostels.room_types import ROOM_TYPE_TARGET, RoomTypeError, reserve_room_type
        if request.data.get("target_content_type") == ROOM_TYPE_TARGET:
            try:
                booking = reserve_room_type(
                    requester=request.user, room_type_id=request.data.get("target_id"), periods=request.data.get("quantity"),
                )
            except RoomTypeError as e:
                return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
            except InventoryConflictError as e:
                return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
            return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)

        booking_type, amount_xaf, error = _priced_booking_request(request.data, request.user)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        try:
            booking = reserve_booking(
                lock_client=get_booking_lock_client(),
                requester=request.user,
                booking_type=booking_type,
                target_content_type=request.data.get("target_content_type"),
                target_id=request.data.get("target_id"),
                amount_xaf=amount_xaf,
            )
        except InventoryConflictError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        """Starts the Mobile Money / Orange Money payment for this booking. With the sandbox gateway it is confirmed at
        once (200, funds HELD in escrow); with a real gateway it is 202 until the payer approves on their phone and
        the provider's webhook confirms it, so clients poll GET /api/bookings/<id>/."""
        from django.utils import timezone
        from .services import initiate_booking_payment, confirm_sandbox_payment, fail_payment, expire_hold
        from payments.gateways import get_active_gateway, confirms_instantly

        booking = self.get_object()
        phone_number = request.data.get("phone_number")
        if not phone_number:
            return Response({"detail": "phone_number is required."}, status=status.HTTP_400_BAD_REQUEST)

        if booking.requester_id != request.user.id:
            return Response({"detail": "Only the person who made this booking can pay for it."}, status=status.HTTP_403_FORBIDDEN)
        if booking.status != BookingStatus.PENDING:
            return Response({"detail": f"This booking can't be paid while it is {booking.get_status_display().lower()}."}, status=status.HTTP_409_CONFLICT)
        if booking.hold_expires_at and booking.hold_expires_at <= timezone.now():
            # Nothing else sweeps these, and starting the payment now would charge the phone for a booking that
            # can no longer be confirmed.
            expire_hold(lock_client=get_booking_lock_client(), booking=booking)
            return Response({"detail": "The time to pay for this booking ran out. Start the booking again."}, status=status.HTTP_409_CONFLICT)
        gateway = get_active_gateway()
        debit = initiate_booking_payment(booking=booking, payment_gateway=gateway, phone_number=phone_number)
        if not debit.success:
            fail_payment(lock_client=get_booking_lock_client(), booking=booking)
            return Response({"detail": "The payment could not be started. Check the phone number and try again."}, status=status.HTTP_400_BAD_REQUEST)
        if not confirms_instantly(gateway):
            booking.refresh_from_db()
            return Response(BookingSerializer(booking).data, status=status.HTTP_202_ACCEPTED)
        try:
            confirm_sandbox_payment(lock_client=get_booking_lock_client(), booking=booking, payment_gateway=gateway)
        except BookingAlreadySettledError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        booking.refresh_from_db()
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
            cancel_booking(lock_client=get_booking_lock_client(), booking=booking)
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
    gateway = get_active_gateway()

    def refund_late_payment():
        """The provider has the money but the booking can't be confirmed any more (hold ran out, or it was cancelled,
        expired or failed): give it back to the payer's wallet instead of turning the webhook away."""
        from marketplace.services import fail_marketplace_order_payment

        try:
            escrow = refund_unconfirmable_payment(
                booking=booking, payment_gateway=gateway, raw_payload=raw_body, signature_header=signature_header,
                provider=provider, provider_reference=provider_reference,
            )
        except WebhookSignatureError:
            return Response({"detail": "Invalid webhook signature."}, status=status.HTTP_403_FORBIDDEN)
        if escrow is None:
            return Response(
                {"detail": f"Payment confirmation is not valid while this booking is {booking.status}."},
                status=status.HTTP_409_CONFLICT,
            )
        fail_marketplace_order_payment(booking=booking)
        return Response({"detail": "Payment arrived too late for this booking and was refunded to the payer's wallet."}, status=status.HTTP_200_OK)

    if booking.status not in ("PAYMENT_PROCESSING", "CONFIRMED"):
        if booking.status == "PENDING":
            return Response(
                {"detail": f"Payment confirmation is not valid while this booking is {booking.status}."},
                status=status.HTTP_409_CONFLICT,
            )
        return refund_late_payment()
    try:
        confirm_payment(
            lock_client=get_booking_lock_client(), booking=booking, provider=provider, provider_reference=provider_reference,
            payment_gateway=gateway, raw_webhook_payload=raw_body,
            webhook_signature_header=signature_header,
        )
    except WebhookSignatureError:
        return Response({"detail": "Invalid webhook signature."}, status=status.HTTP_403_FORBIDDEN)
    except BookingAlreadySettledError:
        # Its hold ran out before the payer approved (no escrow exists yet, or confirm_payment would have returned it).
        return refund_late_payment()
    except ValueError:
        from marketplace.services import fail_marketplace_order_payment

        fail_marketplace_order_payment(booking=booking)
        return Response({"detail": "Payment failure recorded."}, status=status.HTTP_200_OK)

    from marketplace.services import confirm_marketplace_order_payment
    confirm_marketplace_order_payment(booking=booking)
    from careers.services import confirm_training_payment
    confirm_training_payment(booking=booking)
    from hotels.services import confirm_reservation_after_payment
    confirm_reservation_after_payment(booking)
    from events.services import confirm_event_booking_after_payment
    confirm_event_booking_after_payment(booking)
    from services.services import confirm_service_funding_after_payment
    confirm_service_funding_after_payment(booking)
    from marketplace.services import confirm_ride_after_payment
    confirm_ride_after_payment(booking)

    return Response({"detail": "Payment confirmed."}, status=status.HTTP_200_OK)
