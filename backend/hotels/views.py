"""
hotels.views — search/browse (public) and reservation creation
(reuses create_reservation's real dynamic-pricing + validation), same
pattern as property.views.ListingViewSet from Prompt 16.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from .models import Hotel, Reservation
from .serializers import HotelSerializer, ReservationSerializer
from .services import create_reservation
from oaziland.permissions import IsVerifiedAndMfaEnabled


class HotelViewSet(viewsets.ReadOnlyModelViewSet):
    """Public browse/search — no login required, matching how property
    listing search already works."""
    serializer_class = HotelSerializer
    queryset = Hotel.objects.filter(verified=True).prefetch_related("room_types").order_by("-created_at")
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Hotel.objects.none()
        return self.queryset


class ReservationViewSet(viewsets.ModelViewSet):
    serializer_class = ReservationSerializer

    def get_permissions(self):
        if self.action == "create":
            return [IsVerifiedAndMfaEnabled()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Reservation.objects.none()
        return Reservation.objects.filter(guest=self.request.user).order_by("-created_at")

    def create(self, request, *args, **kwargs):
        from .models import RoomType
        try:
            room_type = RoomType.objects.get(id=request.data.get("room_type"))
            reservation = create_reservation(
                hotel=room_type.hotel, guest=request.user, room_type=room_type,
                check_in=request.data.get("check_in"), check_out=request.data.get("check_out"),
                adults=request.data.get("adults", 1), children=request.data.get("children", 0),
                special_requests=request.data.get("special_requests", ""),
            )
        except RoomType.DoesNotExist:
            return Response({"detail": "Unknown room type."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ReservationSerializer(reservation).data, status=status.HTTP_201_CREATED)
