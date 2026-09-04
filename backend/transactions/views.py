"""
transactions.views — the booking reservation API. Reuses reserve_
booking() (Prompt 5) directly, so the SAME race-condition protection
tested at the service layer applies over real HTTP.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from .models import Booking
from .serializers import BookingSerializer
from .services import reserve_booking, InventoryConflictError
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
