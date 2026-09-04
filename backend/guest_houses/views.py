"""
guest_houses.views — browse only. Booking a guest house goes through
the EXISTING generic /api/bookings/ endpoint (transactions.
BookingViewSet, Prompt 16) — guest houses don't need a second booking
endpoint, since they settle through the same Booking/PaymentEscrow
flow as everything else, with the guest_houses app only adding the
operational layer (channel sync, verification, splits) on top.
"""
from rest_framework import viewsets, permissions
from property.models import GuestHouseLodge
from .serializers import GuestHouseLodgeSerializer


class GuestHouseLodgeViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = GuestHouseLodgeSerializer
    queryset = GuestHouseLodge.objects.order_by("-created_at")
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return GuestHouseLodge.objects.none()
        return self.queryset
