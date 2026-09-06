"""geo.views — read-only reference data (used to populate search
filters and registration forms) — public, no auth required."""
from rest_framework import viewsets, permissions
from .models import Quarter, PointOfInterest
from .serializers import QuarterSerializer, PointOfInterestSerializer


class QuarterViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Quarter.objects.all()
    serializer_class = QuarterSerializer
    permission_classes = [permissions.AllowAny]


class PointOfInterestViewSet(viewsets.ReadOnlyModelViewSet):
    """Filterable by ?quarter=<id> — a lister picking nearby facilities
    only ever needs the real options near THEIR property's own
    neighborhood, not every point of interest on the whole platform."""
    serializer_class = PointOfInterestSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        queryset = PointOfInterest.objects.all()
        quarter_id = self.request.query_params.get("quarter")
        if quarter_id:
            queryset = queryset.filter(quarter_id=quarter_id)
        return queryset
