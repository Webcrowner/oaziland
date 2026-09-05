"""
trust_safety.views — the real Admin Console API. Every endpoint here
is IsAdminRole-only: this is a queue of real, sensitive moderation
actions, never intended for anyone browsing anonymously or as a
regular user.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema

from .models import ContentReport, ReportStatus
from .serializers import VerificationRequestSerializer, ContentReportSerializer, DisputeCaseSerializer
from .services import get_admin_console_summary, resolve_content_report
from oaziland.permissions import IsAdminRole
from engagement.models import VerificationRequest, VerificationRequestStatus
from engagement.services import approve_verification_request, reject_verification_request
from property_management.models import DisputeCase, DisputeStatus
from property_management.services import admin_respond_to_dispute, resolve_dispute


class AdminConsoleSummaryView(APIView):
    """The real dashboard — reuses the EXISTING get_admin_console_summary()
    exactly, so the API never drifts from what the aggregation function
    actually returns."""
    permission_classes = [IsAdminRole]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(get_admin_console_summary())


class AdminVerificationRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """A real gap this closes: VerificationRequest could be CREATED,
    but nothing ever let an admin actually approve or reject one."""
    serializer_class = VerificationRequestSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return VerificationRequest.objects.none()
        return VerificationRequest.objects.filter(status=VerificationRequestStatus.PENDING).order_by("submitted_at")

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        verification_request = self.get_object()
        approve_verification_request(verification_request=verification_request, reviewed_by=request.user)
        return Response(VerificationRequestSerializer(verification_request).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        verification_request = self.get_object()
        reject_verification_request(verification_request=verification_request, reviewed_by=request.user, reason=request.data.get("reason", ""))
        return Response(VerificationRequestSerializer(verification_request).data)


class AdminContentReportViewSet(viewsets.ReadOnlyModelViewSet):
    """A real gap this closes: ContentReport could be FILED, but
    nothing ever let an admin actually resolve one."""
    serializer_class = ContentReportSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ContentReport.objects.none()
        return ContentReport.objects.filter(status=ReportStatus.OPEN).order_by("created_at")

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        report = self.get_object()
        action_taken = request.data.get("action_taken", "")
        if not action_taken:
            return Response({"detail": "action_taken is required."}, status=status.HTTP_400_BAD_REQUEST)
        issue_strike = bool(request.data.get("issue_strike", False))
        resolve_content_report(report=report, resolved_by=request.user, action_taken=action_taken, issue_strike=issue_strike)
        return Response(ContentReportSerializer(report).data)


class AdminDisputeCaseViewSet(viewsets.ReadOnlyModelViewSet):
    """Dispute resolution already had real service-layer logic
    (admin_respond_to_dispute, resolve_dispute) — this is what finally
    exposes it over the API, closing the same class of gap as the two
    ViewSets above."""
    serializer_class = DisputeCaseSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return DisputeCase.objects.none()
        return DisputeCase.objects.filter(status__in=[DisputeStatus.OPEN, DisputeStatus.ADMIN_RESPONDED]).order_by("created_at")

    @action(detail=True, methods=["post"])
    def respond(self, request, pk=None):
        dispute = self.get_object()
        admin_respond_to_dispute(dispute)
        return Response(DisputeCaseSerializer(dispute).data)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        dispute = self.get_object()
        outcome = request.data.get("outcome")
        if outcome not in ("RELEASE", "REFUND"):
            return Response({"detail": "outcome must be RELEASE or REFUND."}, status=status.HTTP_400_BAD_REQUEST)
        resolve_dispute(dispute=dispute, outcome=outcome, notes=request.data.get("notes", ""))
        return Response(DisputeCaseSerializer(dispute).data)
