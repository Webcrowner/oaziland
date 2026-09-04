"""
student_hostels.views — hostel search/browse (public) and a student's
own room allocations. Room allocation itself stays admin/warden-
initiated (allocate_room already enforces priority ordering) rather
than a self-service create-your-own-allocation endpoint, so this is
deliberately read-only from a student's side.
"""
from rest_framework import viewsets, permissions
from .models import StudentHostel, RoomAllocation
from .serializers import StudentHostelSerializer, RoomAllocationSerializer


class StudentHostelViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StudentHostelSerializer
    # WHY no prefetch_related("units") here: that relation returns base
    # Unit rows (see StudentHostelSerializer's own docstring for why),
    # not the HostelUnit subclass instances the serializer actually
    # needs — the serializer queries HostelUnit directly instead.
    queryset = StudentHostel.objects.order_by("-created_at")
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return StudentHostel.objects.none()
        return self.queryset


class MyRoomAllocationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RoomAllocationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return RoomAllocation.objects.none()
        return RoomAllocation.objects.filter(student=self.request.user).order_by("-allocated_at")
