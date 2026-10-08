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
from oaziland.permissions import IsKycVerified
from property.models import GuestHouseLodge, PropertyAssetPhoto
from .serializers import GuestHouseLodgeSerializer, GuestHouseLodgeCreateSerializer
from .services import get_host_dashboard_summary


class GuestHouseLodgeViewSet(viewsets.ModelViewSet):
    serializer_class = GuestHouseLodgeSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_permissions(self):
        # Listing a property (a real financial/legal commitment) needs
        # real identity verification, same as property/hotel/venue
        # listings — browsing stays completely open to anyone.
        if self.action == "create":
            return [IsKycVerified()]
        if self.action == "my_dashboard":
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return GuestHouseLodge.objects.none()
        return GuestHouseLodge.objects.select_related("owner__agent_profile").prefetch_related("asset_photos").order_by("-created_at")

    @extend_schema(request=GuestHouseLodgeCreateSerializer, responses={201: GuestHouseLodgeSerializer})
    def create(self, request, *args, **kwargs):
        input_serializer = GuestHouseLodgeCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        guest_house = GuestHouseLodge.objects.create(
            owner=request.user,
            quarter_id=data["quarter"],
            type="HOUSE",
            is_coastal_leisure=data["is_coastal_leisure"],
            finish_level=data["finish_level"],
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
        )
        return Response(GuestHouseLodgeSerializer(guest_house).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="set-location")
    def set_location(self, request, pk=None):
        guest_house = self.get_object()
        if guest_house.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the guest house owner can set its location."}, status=status.HTTP_403_FORBIDDEN)
        lat = request.data.get("latitude")
        lng = request.data.get("longitude")
        if lat is None or lng is None:
            return Response({"detail": "latitude and longitude are required."}, status=status.HTTP_400_BAD_REQUEST)
        guest_house.latitude = lat
        guest_house.longitude = lng
        guest_house.save(update_fields=["latitude", "longitude"])
        return Response({"id": str(guest_house.id), "latitude": str(guest_house.latitude), "longitude": str(guest_house.longitude)})

    @action(detail=False, methods=["get"], url_path="my-dashboard")
    def my_dashboard(self, request):
        """A real gap this closes: get_host_dashboard_summary()
        already aggregated across every guest house a host owns, but
        nothing ever exposed it — same class of gap as the landlord
        portfolio/technician/agent dashboards."""
        return Response(get_host_dashboard_summary(request.user))

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
