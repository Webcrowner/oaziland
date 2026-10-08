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
from .serializers import (
    VerificationRequestSerializer,
    ContentReportSerializer,
    FileContentReportSerializer,
    DisputeCaseSerializer,
    AdminUserSerializer,
)
from .services import get_admin_console_summary, resolve_content_report, file_content_report, CannotReportSelfError
from oaziland.permissions import IsAdminRole
from identity.models import User, AccountStatus
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


class AdminUserManagementViewSet(viewsets.ReadOnlyModelViewSet):
    """Admin queue for user audit, review of strike accumulations,
    account suspensions, and manual reinstatement per Trust & Safety spec.
    Also supports filtering by role (?role=agent/landlord/agency/student/
    technician/driver/admin/regular) so the admin can actually manage
    every distinct type of user on the platform, not just a flat list."""
    serializer_class = AdminUserSerializer
    permission_classes = [IsAdminRole]

    ROLE_PROFILE_FIELDS = {
        "landlord": "landlord_profile", "agent": "agent_profile", "agency": "agency_profile",
        "student": "student_profile", "technician": "technician_profile", "driver": "driver_profile",
        "admin": "admin_profile",
    }

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return User.objects.none()
        qs = User.objects.select_related(
            "landlord_profile", "agent_profile", "agency_profile", "student_profile",
            "technician_profile", "driver_profile", "admin_profile", "kyc_profile",
        ).prefetch_related("warnings").order_by("-date_joined")
        status_param = self.request.query_params.get("account_status")
        if status_param:
            qs = qs.filter(account_status=status_param)
        role_param = self.request.query_params.get("role")
        if role_param == "regular":
            for field in self.ROLE_PROFILE_FIELDS.values():
                qs = qs.filter(**{f"{field}__isnull": True})
        elif role_param in self.ROLE_PROFILE_FIELDS:
            qs = qs.filter(**{f"{self.ROLE_PROFILE_FIELDS[role_param]}__isnull": False})
        return qs

    @action(detail=True, methods=["post"], url_path="toggle-suspend")
    def toggle_suspend(self, request, pk=None):
        from django.utils import timezone
        user = self.get_object()
        suspend = bool(request.data.get("suspend", False))
        if suspend:
            user.account_status = AccountStatus.SUSPENDED
            days = int(request.data.get("days", 30))
            user.suspended_until = timezone.now() + timezone.timedelta(days=days)
        else:
            user.account_status = AccountStatus.ACTIVE
            user.suspended_until = None
        user.save(update_fields=["account_status", "suspended_until"])
        return Response(AdminUserSerializer(user).data)

    @action(detail=True, methods=["post"], url_path="issue-strike")
    def issue_strike(self, request, pk=None):
        from .services import issue_strike_and_apply_consequences
        user = self.get_object()
        reason = request.data.get("reason", "ADMIN_REVIEWED_REPORT")
        warning = issue_strike_and_apply_consequences(subject=user, reason=reason, issued_by=request.user)
        return Response({
            "strike_number": warning.strike_number,
            "account_status": user.account_status,
            "user": AdminUserSerializer(user).data,
        })

    @action(detail=True, methods=["post"], url_path="assign-role")
    def assign_role(self, request, pk=None):
        """Grants a user an ADDITIONAL role. Roles are independent
        OneToOneField profile tables (identity.models' own module
        docstring: 'a real person can hold several roles simultaneously,
        e.g. an Agent who is also a Student') — this never replaces or
        removes any role the user already has, it only ever adds one
        more on top, so an admin can freely make e.g. an existing Agent
        also a Landlord, or a Student also a Technician."""
        from decimal import Decimal
        import uuid as uuid_module
        from identity.models import (
            LandlordProfile, AgentProfile, AgencyProfile, StudentProfile,
            TechnicianProfile, AdminProfile,
        )
        from marketplace.models import DriverProfile

        user = self.get_object()
        role = request.data.get("role")

        if role == "landlord":
            LandlordProfile.objects.get_or_create(user=user)
        elif role == "agent":
            AgentProfile.objects.get_or_create(
                user=user,
                defaults={"agent_commission_percent": Decimal(str(request.data.get("commission_percent", "5.00")))},
            )
        elif role == "agency":
            AgencyProfile.objects.get_or_create(
                user=user,
                defaults={
                    "registration_number": request.data.get("registration_number") or f"AGY-{uuid_module.uuid4().hex[:10].upper()}",
                    "agency_commission_percent": Decimal(str(request.data.get("commission_percent", "10.00"))),
                },
            )
        elif role == "student":
            StudentProfile.objects.get_or_create(
                user=user, defaults={"institution_name": request.data.get("institution_name", "Unspecified")},
            )
        elif role == "technician":
            TechnicianProfile.objects.get_or_create(user=user, defaults={"specialties": []})
        elif role == "driver":
            DriverProfile.objects.get_or_create(
                user=user, defaults={"license_number": request.data.get("license_number", "PENDING-ADMIN-ASSIGNED")},
            )
        elif role == "admin":
            AdminProfile.objects.get_or_create(user=user, defaults={"permissions": []})
            if not user.is_staff:
                user.is_staff = True
                user.save(update_fields=["is_staff"])
        else:
            return Response({"detail": f"Unknown role '{role}'."}, status=status.HTTP_400_BAD_REQUEST)

        return Response(AdminUserSerializer(user).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="remove-role")
    def remove_role(self, request, pk=None):
        """The reverse of assign_role — lets an admin correct a
        mistakenly granted role without needing direct database access.
        Removing one role never touches any of the user's other roles."""
        user = self.get_object()
        role = request.data.get("role")
        profile_field = self.ROLE_PROFILE_FIELDS.get(role)
        if not profile_field:
            return Response({"detail": f"Unknown role '{role}'."}, status=status.HTTP_400_BAD_REQUEST)

        profile = getattr(user, profile_field, None)
        if profile is not None:
            profile.delete()
        if role == "admin" and user.is_staff and not user.is_superuser:
            user.is_staff = False
            user.save(update_fields=["is_staff"])

        # WHY refresh_from_db() here: get_object()'s select_related already
        # cached the (now-deleted) related profile on this instance — Django
        # doesn't invalidate that cache just because the row was deleted
        # elsewhere, so without this the serializer below would keep
        # reporting the just-removed role as still present.
        user.refresh_from_db()
        return Response(AdminUserSerializer(user).data, status=status.HTTP_200_OK)
