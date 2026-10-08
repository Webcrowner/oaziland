"""
land.views — real Land creation. create only requires being signed in;
KYC is enforced at the point the property actually goes public
(property.ListingViewSet.create, the 'publish' step), same deferred-KYC
policy as House/Shop — no separate, lighter- or heavier-weight path for
land specifically."""
from rest_framework import viewsets, permissions
from .models import Land
from .serializers import LandCreateSerializer
from oaziland.permissions import IsOwnerOrReadOnly
from property.views import PropertyAmenitiesMixin


class LandViewSet(PropertyAmenitiesMixin, viewsets.ModelViewSet):
    serializer_class = LandCreateSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.AllowAny()]
        if self.action == "create":
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsOwnerOrReadOnly()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Land.objects.none()
        return Land.objects.all()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user, type="LAND")
