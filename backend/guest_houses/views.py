"""
guest_houses.views — browse AND real creation. Booking a guest house
goes through the EXISTING generic /api/bookings/ endpoint
(transactions.BookingViewSet, Prompt 16) — guest houses don't need a
second booking endpoint, since they settle through the same Booking/
PaymentEscrow flow as everything else, with the guest_houses app only
adding the operational layer (channel sync, verification, splits) on
top.

GuestHouseLodgeViewSet is no longer ReadOnlyModelViewSet — the real
gap this closes: no real owner could ever list their own property.
No verification gate (unlike Hotel/Venue) — matches the model's own
real fields.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from property.models import GuestHouseLodge, PropertyAssetPhoto
from .serializers import GuestHouseLodgeSerializer, GuestHouseLodgeCreateSerializer


class GuestHouseLodgeViewSet(viewsets.ModelViewSet):
    serializer_class = GuestHouseLodgeSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return GuestHouseLodge.objects.none()
        return GuestHouseLodge.objects.order_by("-created_at")

    @extend_schema(request=GuestHouseLodgeCreateSerializer, responses={201: GuestHouseLodgeSerializer})
    def create(self, request, *args, **kwargs):
        input_serializer = GuestHouseLodgeCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        guest_house = GuestHouseLodge.objects.create(
            owner=request.user, quarter_id=data["quarter"], type="HOUSE",
            is_coastal_leisure=data["is_coastal_leisure"], finish_level=data["finish_level"],
        )
        return Response(GuestHouseLodgeSerializer(guest_house).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="add-photo")
    def add_photo(self, request, pk=None):
        guest_house = self.get_object()
        if guest_house.owner_id != request.user.id:
            return Response({"detail": "Only the guest house's own owner can add photos to it."}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required — upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        is_first = not guest_house.asset_photos.exists()
        photo = PropertyAssetPhoto.objects.create(property_asset=guest_house, url=url, media_type=media_type, is_primary=is_first)
        return Response({"id": photo.id, "url": photo.url, "media_type": photo.media_type, "is_primary": photo.is_primary}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-photo")
    def remove_photo(self, request, pk=None):
        guest_house = self.get_object()
        if guest_house.owner_id != request.user.id:
            return Response({"detail": "Only the guest house's own owner can remove its photos."}, status=status.HTTP_403_FORBIDDEN)
        photo_id = request.data.get("photo_id")
        deleted_count, _ = PropertyAssetPhoto.objects.filter(property_asset=guest_house, id=photo_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Photo not found on this guest house."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
