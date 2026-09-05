"""
land.views — real Land creation, the highest-fraud-risk property type
on the platform, so create requires the same MFA+KYC gate as
House/Shop — no lighter-weight path for land specifically."""
from rest_framework import viewsets, permissions
from .models import Land
from .serializers import LandCreateSerializer
from oaziland.permissions import IsOwnerOrReadOnly, IsVerifiedAndMfaEnabled


class LandViewSet(viewsets.ModelViewSet):
    serializer_class = LandCreateSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.AllowAny()]
        if self.action == "create":
            return [IsVerifiedAndMfaEnabled()]
        return [permissions.IsAuthenticated(), IsOwnerOrReadOnly()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Land.objects.none()
        return Land.objects.all()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user, type="LAND")
