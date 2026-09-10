"""
student_hostels.views — hostel search/browse (public), real creation,
and a student's own room allocations. Room allocation itself stays
admin/warden-initiated (allocate_room already enforces priority
ordering) rather than a self-service create-your-own-allocation
endpoint, so that part is deliberately read-only from a student's side.

StudentHostelViewSet is no longer ReadOnlyModelViewSet — the real gap
this closes: no real owner could ever list their own hostel. Reuses
the existing create_student_hostel() service function rather than
reimplementing the owner_profile/PropertyAsset.owner sync it already
handles correctly.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from property.models import PropertyAssetPhoto
from .models import StudentHostel, RoomAllocation
from .serializers import StudentHostelSerializer, StudentHostelCreateSerializer, RoomAllocationSerializer
from .services import create_student_hostel


class StudentHostelViewSet(viewsets.ModelViewSet):
    # WHY no prefetch_related("units") here: that relation returns base
    # Unit rows (see StudentHostelSerializer's own docstring for why),
    # not the HostelUnit subclass instances the serializer actually
    # needs — the serializer queries HostelUnit directly instead.
    serializer_class = StudentHostelSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return StudentHostel.objects.none()
        return StudentHostel.objects.order_by("-created_at")

    @extend_schema(request=StudentHostelCreateSerializer, responses={201: StudentHostelSerializer})
    def create(self, request, *args, **kwargs):
        from student_hostels.models import OwnerProfile, OwnerType
        from geo.models import Quarter

        input_serializer = StudentHostelCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        quarter = Quarter.objects.filter(id=data["quarter"]).first()
        if quarter is None:
            return Response({"detail": "That neighborhood was not found."}, status=status.HTTP_400_BAD_REQUEST)

        # Same real auto-provisioning pattern already used for
        # marketplace listings — a first-time hostel owner shouldn't
        # need a separate manual setup step first.
        owner_profile, _ = OwnerProfile.objects.get_or_create(account_user=request.user, defaults={"owner_type": OwnerType.LANDLORD})
        hostel = create_student_hostel(owner_profile=owner_profile, quarter=quarter, property_type=data["property_type"])
        return Response(StudentHostelSerializer(hostel).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="add-photo")
    def add_photo(self, request, pk=None):
        hostel = self.get_object()
        if hostel.owner_id != request.user.id:
            return Response({"detail": "Only the hostel's own owner can add photos to it."}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required — upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        is_first = not hostel.asset_photos.exists()
        photo = PropertyAssetPhoto.objects.create(property_asset=hostel, url=url, media_type=media_type, is_primary=is_first)
        return Response({"id": photo.id, "url": photo.url, "media_type": photo.media_type, "is_primary": photo.is_primary}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-photo")
    def remove_photo(self, request, pk=None):
        hostel = self.get_object()
        if hostel.owner_id != request.user.id:
            return Response({"detail": "Only the hostel's own owner can remove its photos."}, status=status.HTTP_403_FORBIDDEN)
        photo_id = request.data.get("photo_id")
        deleted_count, _ = PropertyAssetPhoto.objects.filter(property_asset=hostel, id=photo_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Photo not found on this hostel."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyRoomAllocationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RoomAllocationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return RoomAllocation.objects.none()
        return RoomAllocation.objects.filter(student=self.request.user).order_by("-allocated_at")
