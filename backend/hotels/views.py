"""
hotels.views — search/browse (public) and reservation creation
(reuses create_reservation's real dynamic-pricing + validation), same
pattern as property.views.ListingViewSet from Prompt 16.

HotelViewSet is no longer ReadOnlyModelViewSet — the real gap this
closes: no real hotel owner could ever list their own property before
this. New hotels start unverified (matching the field's own default),
same real moderation posture as a property listing going through
PENDING_REVIEW before it's publicly visible.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import Hotel, RoomType, Reservation
from .serializers import HotelSerializer, HotelCreateSerializer, ReservationSerializer
from .services import create_reservation
from oaziland.permissions import IsVerifiedAndMfaEnabled


class HotelViewSet(viewsets.ModelViewSet):
    """list is public and verified-only (matching how property listing
    search already works) PLUS the requester's own not-yet-verified
    hotels — an owner needs to see their own listing while it's
    awaiting review, not just once an admin has approved it. Detail
    actions (photos) use an unscoped queryset with their own explicit
    checks, the same lesson already applied to marketplace/services
    this session — scoping them the same way as list would silently
    turn a deliberate 403 into an uninformative 404."""
    serializer_class = HotelSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Hotel.objects.none()
        if self.action == "list":
            from django.db.models import Q
            user = self.request.user
            base = Q(verified=True)
            if user.is_authenticated:
                base |= Q(owner=user)
            return Hotel.objects.filter(base).prefetch_related("room_types").order_by("-created_at")
        return Hotel.objects.prefetch_related("room_types")

    @extend_schema(request=HotelCreateSerializer, responses={201: HotelSerializer})
    def create(self, request, *args, **kwargs):
        input_serializer = HotelCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        hotel = Hotel.objects.create(
            owner=request.user, quarter_id=data["quarter"], type="HOTEL", star_rating=data.get("star_rating"),
        )
        for room_type_data in data["room_types"]:
            RoomType.objects.create(
                hotel=hotel, category=room_type_data.get("category", "STANDARD"),
                capacity=room_type_data.get("capacity", 2), base_rate_xaf=room_type_data.get("base_rate_xaf", 0),
                amenities=room_type_data.get("amenities", []),
            )
        return Response(HotelSerializer(hotel).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="add-photo")
    def add_photo(self, request, pk=None):
        from property.models import PropertyAssetPhoto

        hotel = self.get_object()
        if hotel.owner_id != request.user.id:
            return Response({"detail": "Only the hotel's own owner can add photos to it."}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required — upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        is_first = not hotel.asset_photos.exists()
        photo = PropertyAssetPhoto.objects.create(property_asset=hotel, url=url, media_type=media_type, is_primary=is_first)
        return Response({"id": photo.id, "url": photo.url, "media_type": photo.media_type, "is_primary": photo.is_primary}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-photo")
    def remove_photo(self, request, pk=None):
        from property.models import PropertyAssetPhoto

        hotel = self.get_object()
        if hotel.owner_id != request.user.id:
            return Response({"detail": "Only the hotel's own owner can remove its photos."}, status=status.HTTP_403_FORBIDDEN)
        photo_id = request.data.get("photo_id")
        deleted_count, _ = PropertyAssetPhoto.objects.filter(property_asset=hotel, id=photo_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Photo not found on this hotel."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


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
