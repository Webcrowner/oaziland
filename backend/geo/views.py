"""geo.views — read-only reference data (used to populate search
filters and registration forms) — public, no auth required."""
import logging

from django.db.models import Q
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from oaziland.permissions import IsAdminRole
from trust_safety.audit import audit_note
from .models import Quarter, PointOfInterest, AreaSuggestion
from .serializers import QuarterSerializer, PointOfInterestSerializer, AreaSuggestionSerializer, AdminAreaSuggestionSerializer
from .services import AreaSuggestionError, approve_area_suggestion, notify_admins_of_area_suggestion, reject_area_suggestion

logger = logging.getLogger(__name__)


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
        try:
            notify_admins_of_area_suggestion(serializer.instance)
        except Exception:  # a failed alert must never lose the request itself
            logger.exception("Could not alert admins about area suggestion %s", serializer.instance.pk)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AdminAreaSuggestionViewSet(viewsets.ReadOnlyModelViewSet):
    """Neighbourhood requests from listers. GET ?status=pending|approved|rejected|all (default pending) and ?q=.
    POST approve {area_name?, city_name?} creates the neighbourhood (the reviewer may fix the spelling);
    POST reject {reason} declines it. The requester is told either way."""
    serializer_class = AdminAreaSuggestionSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AreaSuggestion.objects.none()
        qs = AreaSuggestion.objects.select_related("region", "suggested_by", "reviewed_by", "created_quarter")
        wanted = self.request.query_params.get("status", "pending").lower()
        # The status filter is for browsing; acting on one request must find it whatever its state,
        # so an already-reviewed request gets a clear message instead of a 404.
        if self.action == "list" and wanted != "all":
            qs = qs.filter(status=wanted.upper())
        query = self.request.query_params.get("q", "").strip()
        for term in query.split()[:4]:
            qs = qs.filter(
                Q(area_name__icontains=term) | Q(city_name__icontains=term) | Q(region__name__icontains=term)
                | Q(suggested_by__username__icontains=term) | Q(suggested_by__first_name__icontains=term)
                | Q(suggested_by__last_name__icontains=term)
            )
        return qs.order_by("created_at") if wanted == "pending" else qs.order_by("-created_at")

    def _review(self, request, pk, handler):
        suggestion = self.get_object()
        audit_note(request, target_label=f"{suggestion.area_name} ({suggestion.city_name})", target_type="area-suggestion")
        try:
            handler(suggestion)
        except AreaSuggestionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        suggestion.refresh_from_db()
        return Response(self.get_serializer(suggestion).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        data = request.data
        return self._review(request, pk, lambda s: approve_area_suggestion(
            s, admin=request.user, area_name=str(data.get("area_name") or ""), city_name=str(data.get("city_name") or ""),
        ))

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._review(request, pk, lambda s: reject_area_suggestion(
            s, admin=request.user, reason=str(request.data.get("reason") or ""),
        ))


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
