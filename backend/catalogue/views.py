"""
catalogue.views — the real, public 'Services' browse API. Public
because knowing what services a marketplace offers (before ever
signing up) is exactly the kind of thing that should be visible
without an account, same as browsing a listing.
"""
from rest_framework import viewsets, permissions
from .models import PartnerServiceCategory
from .serializers import PartnerServiceCategorySerializer


class PartnerServiceCategoryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PartnerServiceCategorySerializer
    queryset = PartnerServiceCategory.objects.prefetch_related("offerings").order_by("name")
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PartnerServiceCategory.objects.none()
        return self.queryset
