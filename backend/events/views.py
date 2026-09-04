"""
events.views — venue search/browse (public) and event booking creation
(reuses create_event_booking's real availability-conflict checking).
"""
from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from .models import Venue, EventBooking
from .serializers import VenueSerializer, EventBookingSerializer
from .services import create_event_booking, VenueUnavailableError
from oaziland.permissions import IsVerifiedAndMfaEnabled


class VenueViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = VenueSerializer
    queryset = Venue.objects.filter(verified=True).prefetch_related("spaces").order_by("-created_at")
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Venue.objects.none()
        return self.queryset


class EventBookingViewSet(viewsets.ModelViewSet):
    serializer_class = EventBookingSerializer

    def get_permissions(self):
        if self.action == "create":
            return [IsVerifiedAndMfaEnabled()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return EventBooking.objects.none()
        return EventBooking.objects.filter(organiser=self.request.user).order_by("-created_at")

    def create(self, request, *args, **kwargs):
        from .models import VenueSpace
        try:
            venue_space = VenueSpace.objects.get(id=request.data.get("venue_space"))
            booking = create_event_booking(
                organiser=request.user, venue_space=venue_space, event_type=request.data.get("event_type"),
                event_date=request.data.get("event_date"), start_time=request.data.get("start_time"),
                end_time=request.data.get("end_time"), guest_count=request.data.get("guest_count"),
            )
        except VenueSpace.DoesNotExist:
            return Response({"detail": "Unknown venue space."}, status=status.HTTP_404_NOT_FOUND)
        except VenueUnavailableError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(EventBookingSerializer(booking).data, status=status.HTTP_201_CREATED)
