"""
events.views — venue search/browse (public) and event booking creation
(reuses create_event_booking's real availability-conflict checking).

VenueViewSet is no longer ReadOnlyModelViewSet — the real gap this
closes: no real venue owner could ever list their own property. New
venues start unverified (matching the field's own default).
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import Venue, VenueSpace, EventBooking
from .serializers import VenueSerializer, VenueCreateSerializer, EventBookingSerializer
from .services import create_event_booking, VenueUnavailableError
from oaziland.permissions import IsVerifiedAndMfaEnabled


class VenueViewSet(viewsets.ModelViewSet):
    """Same real visibility pattern as HotelViewSet: list is public
    and verified-only PLUS the requester's own not-yet-verified
    venues. Detail actions (photos) use an unscoped queryset with
    their own explicit checks, the same lesson already applied
    repeatedly this session."""
    serializer_class = VenueSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Venue.objects.none()
        if self.action == "list":
            from django.db.models import Q
            user = self.request.user
            base = Q(verified=True)
            if user.is_authenticated:
                base |= Q(owner=user)
            return Venue.objects.filter(base).prefetch_related("spaces").order_by("-created_at")
        return Venue.objects.prefetch_related("spaces")

    @extend_schema(request=VenueCreateSerializer, responses={201: VenueSerializer})
    def create(self, request, *args, **kwargs):
        input_serializer = VenueCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        venue = Venue.objects.create(owner=request.user, quarter_id=data["quarter"], type="EVENT_CENTER")
        for space_data in data["spaces"]:
            VenueSpace.objects.create(
                venue=venue, space_name=space_data.get("space_name", "Main Hall"),
                capacity_theatre=space_data.get("capacity_theatre"), capacity_banquet=space_data.get("capacity_banquet"),
                base_price_per_hour_xaf=space_data.get("base_price_per_hour_xaf", 0),
            )
        return Response(VenueSerializer(venue).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="add-photo")
    def add_photo(self, request, pk=None):
        from property.models import PropertyAssetPhoto

        venue = self.get_object()
        if venue.owner_id != request.user.id:
            return Response({"detail": "Only the venue's own owner can add photos to it."}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required — upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        is_first = not venue.asset_photos.exists()
        photo = PropertyAssetPhoto.objects.create(property_asset=venue, url=url, media_type=media_type, is_primary=is_first)
        return Response({"id": photo.id, "url": photo.url, "media_type": photo.media_type, "is_primary": photo.is_primary}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-photo")
    def remove_photo(self, request, pk=None):
        from property.models import PropertyAssetPhoto

        venue = self.get_object()
        if venue.owner_id != request.user.id:
            return Response({"detail": "Only the venue's own owner can remove its photos."}, status=status.HTTP_403_FORBIDDEN)
        photo_id = request.data.get("photo_id")
        deleted_count, _ = PropertyAssetPhoto.objects.filter(property_asset=venue, id=photo_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Photo not found on this venue."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


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
