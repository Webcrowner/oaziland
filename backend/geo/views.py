"""geo.views — read-only reference data (used to populate search
filters and registration forms) — public, no auth required."""
from rest_framework import viewsets, permissions
from .models import Quarter
from .serializers import QuarterSerializer


class QuarterViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Quarter.objects.all()
    serializer_class = QuarterSerializer
    permission_classes = [permissions.AllowAny]
