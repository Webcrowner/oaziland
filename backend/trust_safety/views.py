"""
trust_safety.views — mostly the real Admin Console API (IsAdminRole-only:
a queue of real, sensitive moderation actions). FileContentReportView is
the one deliberate exception — the real, user-facing way to actually
FILE a report in the first place, which nothing in this file (or
anywhere else) previously exposed; every other report-related endpoint
here is about an admin resolving one that already exists.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema

from .models import ContentReport, ReportStatus
from .serializers import VerificationRequestSerializer, ContentReportSerializer, FileContentReportSerializer, DisputeCaseSerializer
from .services import get_admin_console_summary, resolve_content_report, file_content_report, CannotReportSelfError
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


class FileContentReportView(APIView):
    """The real, user-facing way to file a report — against a post,
    listing, comment, OR a person directly (an agent, agency,
    landlord, or owner). Requires login: an anonymous, unaccountable
    reporting endpoint is itself a real abuse vector."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=FileContentReportSerializer, responses={201: ContentReportSerializer, 400: dict})
    def post(self, request):
        input_serializer = FileContentReportSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        target_user = None
        if data.get("target_user"):
            from identity.models import User
            target_user = User.objects.filter(id=data["target_user"]).first()
            if target_user is None:
                return Response({"detail": "That user was not found."}, status=status.HTTP_404_NOT_FOUND)

        target_post = None
        if data.get("target_post"):
            from social.models import Post
            target_post = Post.objects.filter(id=data["target_post"]).first()

        target_comment = None
        if data.get("target_comment"):
            from social.models import Comment
            target_comment = Comment.objects.filter(id=data["target_comment"]).first()

        try:
            report = file_content_report(
                reported_by=request.user, reason=data["reason"], notes=data["notes"],
                target_post=target_post, target_listing_id=data.get("target_listing_id"),
                target_comment=target_comment, target_user=target_user,
            )
        except (ValueError, CannotReportSelfError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(ContentReportSerializer(report).data, status=status.HTTP_201_CREATED)
