"""geo.views — read-only reference data (used to populate search
filters and registration forms) — public, no auth required."""
from rest_framework import viewsets, permissions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from .models import Quarter, PointOfInterest, AreaSuggestion
from .serializers import QuarterSerializer, PointOfInterestSerializer, AreaSuggestionSerializer


class QuarterPagination(PageNumberPagination):
    # Reference data feeding dropdowns — the default page size (20) would silently hide most of the country.
    page_size = 2000


class QuarterViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Quarter.objects.select_related(
        "village_or_district__subdivision__division__region"
    ).order_by("village_or_district__name", "name")
    serializer_class = QuarterSerializer
    permission_classes = [permissions.AllowAny]
    pagination_class = QuarterPagination


class AreaSuggestionView(APIView):
    """A signed-in lister asks for a neighbourhood missing from the dropdown; an admin approves it."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=AreaSuggestionSerializer, responses={201: AreaSuggestionSerializer, 400: dict})
    def post(self, request):
        serializer = AreaSuggestionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(suggested_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


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
