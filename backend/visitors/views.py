from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from oaziland.permissions import IsAdminRole

from .services import build_summary, record_visit


class VisitInputSerializer(serializers.Serializer):
    """Only the path is required. The optional fields are passed through untouched and
    sanitised by the service, so one malformed value never costs a legitimate page view."""
    path = serializers.CharField(max_length=300)
    referrer = serializers.JSONField(required=False, allow_null=True)
    locale = serializers.JSONField(required=False, allow_null=True)
    timezone = serializers.JSONField(required=False, allow_null=True)
    screen_width = serializers.JSONField(required=False, allow_null=True)
    signed_in = serializers.JSONField(required=False, allow_null=True)


class RecordVisitView(APIView):
    """Receives one anonymous page-view ping from the website. Public by design: it takes no
    token (a stale one must never turn a harmless ping into a 401), is rate limited per address,
    and always answers 204 so the response reveals nothing about whether the visit was counted."""
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "visitor_tracking"

    @extend_schema(request=VisitInputSerializer, responses={204: None})
    def post(self, request):
        serializer = VisitInputSerializer(data=request.data)
        if serializer.is_valid():
            record_visit(request, serializer.validated_data)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminVisitorSummaryView(APIView):
    """Visitor statistics for the admin console. Query: ?days=1..365 (default 7)."""
    permission_classes = [IsAdminRole]

    @extend_schema(responses={200: dict})
    def get(self, request):
        try:
            days = int(request.query_params.get("days", 7))
        except (TypeError, ValueError):
            days = 7
        return Response(build_summary(min(max(days, 1), 365)))
