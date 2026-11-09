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

from .models import ContentReport, ReportStatus, AuditLog
from .audit import audit_note
from .serializers import (
    VerificationRequestSerializer,
    ContentReportSerializer,
    AdminContentReportSerializer,
    FileContentReportSerializer,
    DisputeCaseSerializer,
    AdminDisputeCaseSerializer,
    AdminUserSerializer,
    AuditLogSerializer,
)
from .services import get_admin_console_summary, resolve_content_report, file_content_report, CannotReportSelfError, ReportTargetNotFound
from oaziland.permissions import IsAdminRole, IsSuperAdmin
from decimal import Decimal
from django.db.models import Q
from django.utils.dateparse import parse_date
from identity.models import User, AccountStatus
from engagement.models import VerificationRequest, VerificationRequestStatus
from engagement.services import approve_verification_request, reject_verification_request
from property_management.models import DisputeCase, DisputeStatus
from property_management.services import admin_respond_to_dispute, resolve_dispute

ADMIN_ROLE_RESERVED = "Only a full-access administrator can grant or remove the admin role."


class AdminAiFlagViewSet(viewsets.GenericViewSet):
    """Content the automated moderation flagged for review (it is still live). GET ?state=pending|reviewed
    (paged, one row per item). POST keep {type, id} closes the flags; POST remove {type, id, reason,
    issue_strike?} takes the item down, tells the owner and optionally gives them a strike."""
    permission_classes = [IsAdminRole]
    serializer_class = None
    queryset = User.objects.none()

    def list(self, request):
        from .ai_flags import STATES, describe_flags, flagged_groups

        state = request.query_params.get("state", "pending")
        if state not in STATES:
            return Response({"detail": "Unknown state."}, status=status.HTTP_400_BAD_REQUEST)
        page = self.paginate_queryset(flagged_groups(state))
        return self.get_paginated_response(describe_flags(page, state))

    def _act(self, request, verb):
        import uuid

        from .ai_flags import keep_flagged_content, remove_flagged_content
        from .content_moderation import TYPES, ContentActionError, ContentNotFound

        content_type = request.data.get("type")
        try:
            content_id = uuid.UUID(str(request.data.get("id")))
        except ValueError:
            return Response({"detail": "Unknown content type or id."}, status=status.HTTP_400_BAD_REQUEST)
        if content_type not in TYPES:
            return Response({"detail": "Unknown content type or id."}, status=status.HTTP_400_BAD_REQUEST)
        audit_note(request, target_type=content_type, content_id=str(content_id))
        try:
            if verb == "keep":
                keep_flagged_content(content_type=content_type, content_id=content_id, admin=request.user)
            else:
                strike = request.data.get("issue_strike") in (True, "true", "True", 1, "1")
                takedown = remove_flagged_content(
                    content_type=content_type, content_id=content_id, reason=request.data.get("reason", ""),
                    admin=request.user, issue_strike=strike,
                )
                audit_note(request, target_label=takedown.title)
        except ContentNotFound as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except ContentActionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "ok"}, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"])
    def keep(self, request):
        return self._act(request, "keep")

    @action(detail=False, methods=["post"])
    def remove(self, request):
        return self._act(request, "remove")


class AdminContentViewSet(viewsets.GenericViewSet):
    """Browse published property listings, marketplace listings and posts, and pull one down.
    GET ?type=property|marketplace|post &state=live|removed|all &q= (paged). POST remove / restore
    with {type, id, reason}; a removal needs a reason, which is shown to the owner."""
    permission_classes = [IsAdminRole]
    serializer_class = None
    queryset = User.objects.none()

    def list(self, request):
        from .content_moderation import TYPES, STATES, content_queryset, describe_content

        params = request.query_params
        content_type = params.get("type", "marketplace")
        state = params.get("state", "live")
        if content_type not in TYPES or state not in STATES:
            return Response({"detail": "Unknown content type or state."}, status=status.HTTP_400_BAD_REQUEST)
        queryset = content_queryset(content_type, state, params.get("q", "").strip())
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(describe_content(content_type, page))

    def _act(self, request, verb):
        import uuid

        from .content_moderation import TYPES, ContentActionError, ContentNotFound, remove_content, restore_content

        content_type = request.data.get("type")
        try:
            content_id = uuid.UUID(str(request.data.get("id")))
        except ValueError:
            return Response({"detail": "Unknown content type or id."}, status=status.HTTP_400_BAD_REQUEST)
        if content_type not in TYPES:
            return Response({"detail": "Unknown content type or id."}, status=status.HTTP_400_BAD_REQUEST)
        audit_note(request, target_type=content_type, content_id=str(content_id))
        try:
            if verb == "remove":
                takedown = remove_content(
                    content_type=content_type, content_id=content_id, reason=request.data.get("reason", ""), admin=request.user,
                )
            else:
                takedown = restore_content(content_type=content_type, content_id=content_id, admin=request.user)
        except ContentNotFound as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except ContentActionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if takedown is not None:
            audit_note(request, target_label=takedown.title)
        return Response({"detail": "ok"}, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"])
    def remove(self, request):
        return self._act(request, "remove")

    @action(detail=False, methods=["post"])
    def restore(self, request):
        return self._act(request, "restore")


class AdminAnalyticsView(APIView):
    """Platform analytics for the last ?days=7|30|90|365 (default 30), compared with the period before."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        from .analytics import PERIODS, platform_analytics

        try:
            days = int(request.query_params.get("days", 30))
        except ValueError:
            days = 30
        if days not in PERIODS:
            return Response({"detail": "Choose a period of 7, 30, 90 or 365 days."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(platform_analytics(days))


class AdminConsoleSummaryView(APIView):
    """The real dashboard — reuses the EXISTING get_admin_console_summary()
    exactly, so the API never drifts from what the aggregation function
    actually returns."""
    permission_classes = [IsAdminRole]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from identity.services import is_super_admin
        data = get_admin_console_summary()
        data["is_super_admin"] = is_super_admin(request.user)
        return Response(data)


class AdminVerificationRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """Verification requests, with what an admin needs to judge each one (the thing being verified, who owns
    it, the requester's identity check, strikes and history, warning flags). GET ?state=pending|approved|
    rejected|all (default pending), ?type= and ?q= (requester name, username, phone or document link), paged.
    POST approve, or reject {reason} (a reason is required and is shown to the requester)."""
    serializer_class = VerificationRequestSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return VerificationRequest.objects.none()
        return VerificationRequest.objects.select_related("requester", "reviewed_by")

    def list(self, request, *args, **kwargs):
        from engagement.models import VerificationRequestType
        from .verification import STATES, describe_requests, verification_queryset

        params = request.query_params
        state, request_type = params.get("state", "pending"), params.get("type", "")
        if state not in STATES or (request_type and request_type not in VerificationRequestType.values):
            return Response({"detail": "Unknown state or type."}, status=status.HTTP_400_BAD_REQUEST)
        page = self.paginate_queryset(verification_queryset(state=state, request_type=request_type, query=params.get("q", "").strip()))
        return self.get_paginated_response(describe_requests(page))

    def retrieve(self, request, *args, **kwargs):
        from .verification import describe_requests

        return Response(describe_requests([self.get_object()])[0])

    def _review(self, request, handler):
        from engagement.services import VerificationReviewError
        from .verification import describe_requests

        verification_request = self.get_object()
        audit_note(
            request, target_type="verification-request",
            target_label=f"{verification_request.get_request_type_display()} \u00b7 {verification_request.requester.username}",
        )
        try:
            handler(verification_request)
        except VerificationReviewError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(describe_requests([verification_request])[0])

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._review(request, lambda item: approve_verification_request(verification_request=item, reviewed_by=request.user))

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._review(request, lambda item: reject_verification_request(
            verification_request=item, reviewed_by=request.user, reason=str(request.data.get("reason") or ""),
        ))


class AdminContentReportViewSet(viewsets.ReadOnlyModelViewSet):
    """A real gap this closes: ContentReport could be FILED, but
    nothing ever let an admin actually resolve one."""
    serializer_class = AdminContentReportSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ContentReport.objects.none()
        return ContentReport.objects.filter(status=ReportStatus.OPEN).select_related(
            "reported_by", "target_post__author", "target_comment__author", "target_comment__post", "target_user",
        ).order_by("created_at")

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        report = self.get_object()
        action_taken = request.data.get("action_taken", "")
        if not action_taken:
            return Response({"detail": "action_taken is required."}, status=status.HTTP_400_BAD_REQUEST)
        issue_strike = bool(request.data.get("issue_strike", False))
        resolve_content_report(report=report, resolved_by=request.user, action_taken=action_taken, issue_strike=issue_strike)
        return Response(AdminContentReportSerializer(report).data)


class AdminDisputeCaseViewSet(viewsets.ReadOnlyModelViewSet):
    """Dispute resolution already had real service-layer logic
    (admin_respond_to_dispute, resolve_dispute) — this is what finally
    exposes it over the API, closing the same class of gap as the two
    ViewSets above."""
    serializer_class = AdminDisputeCaseSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return DisputeCase.objects.none()
        return DisputeCase.objects.select_related("raised_by", "escrow__booking__requester").filter(
            status__in=[DisputeStatus.OPEN, DisputeStatus.ADMIN_RESPONDED],
        ).order_by("created_at")

    @action(detail=True, methods=["post"])
    def respond(self, request, pk=None):
        dispute = self.get_object()
        admin_respond_to_dispute(dispute)
        return Response(AdminDisputeCaseSerializer(dispute).data)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        from property_management.services import DISPUTE_OUTCOMES
        from transactions.services import EscrowSettlementError

        dispute = self.get_object()
        outcome = request.data.get("outcome")
        if outcome not in DISPUTE_OUTCOMES:
            return Response({"detail": "outcome must be RELEASE, REFUND or SPLIT."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            resolve_dispute(
                dispute=dispute, outcome=outcome, notes=str(request.data.get("notes", ""))[:2000],
                payer_amount_xaf=request.data.get("payer_amount_xaf"),
            )
        except EscrowSettlementError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        audit_note(request, target_label=f"Dispute {str(dispute.pk)[:8]}", target_type="dispute")
        dispute.escrow.refresh_from_db()
        return Response(AdminDisputeCaseSerializer(dispute).data)


class AdminPaymentViewSet(viewsets.GenericViewSet):
    """Every payment on the platform, by service. GET ?type=<booking type> &state=all|held|released|refunded|
    disputed|failed|processing &q= (payer name, username, phone, provider reference or booking id)
    &since= &until= (YYYY-MM-DD), paged. GET summary/?days=30 gives totals by service and what needs attention.
    Read-only: money moves through disputes, withdrawals and the services themselves."""
    permission_classes = [IsAdminRole]
    serializer_class = None
    queryset = User.objects.none()

    def list(self, request):
        from transactions.models import BookingType
        from .payments import STATES, payment_row, payments_queryset

        params = request.query_params
        booking_type, state = params.get("type", ""), params.get("state", "all")
        if (booking_type and booking_type not in BookingType.values) or state not in STATES:
            return Response({"detail": "Unknown payment type or state."}, status=status.HTTP_400_BAD_REQUEST)
        queryset = payments_queryset(
            booking_type=booking_type, state=state, query=params.get("q", "").strip(),
            since=parse_date(params.get("since", "")), until=parse_date(params.get("until", "")),
        )
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response([payment_row(booking) for booking in page])

    @action(detail=False, methods=["get"])
    def summary(self, request):
        from .payments import MAX_PERIOD_DAYS, payments_summary

        try:
            days = int(request.query_params.get("days", 30))
        except ValueError:
            days = 30
        return Response(payments_summary(max(1, min(days, MAX_PERIOD_DAYS))))


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
            if target_post is None:
                return Response({"detail": "That post was not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            report = file_content_report(
                reported_by=request.user, reason=data["reason"], notes=data["notes"],
                target_post=target_post, target_listing_id=data.get("target_listing_id"), target_user=target_user,
                target_kind=data.get("target_kind", ""), target_object_id=data.get("target_id", ""),
            )
        except ReportTargetNotFound as e:
            return Response({"detail": str(e)}, status=status.HTTP_404_NOT_FOUND)
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
        query = self.request.query_params.get("q", "").strip()
        if query:
            terms = query.split()
            for term in terms[:4]:
                qs = qs.filter(
                    Q(username__icontains=term) | Q(email__icontains=term) | Q(phone__icontains=term)
                    | Q(first_name__icontains=term) | Q(last_name__icontains=term)
                    | Q(kyc_profile__legal_full_name__icontains=term)
                )
        role_param = self.request.query_params.get("role")
        if role_param == "regular":
            for field in self.ROLE_PROFILE_FIELDS.values():
                qs = qs.filter(**{f"{field}__isnull": True})
        elif role_param in self.ROLE_PROFILE_FIELDS:
            qs = qs.filter(**{f"{self.ROLE_PROFILE_FIELDS[role_param]}__isnull": False})
        return qs

    @staticmethod
    def _refuse(detail, code=status.HTTP_403_FORBIDDEN):
        return Response({"detail": detail}, status=code)

    def _discipline_block(self, request, user):
        """Why this admin may not suspend or warn this account, or None if they may."""
        if user.pk == request.user.pk:
            return "You cannot suspend or warn your own account."
        if hasattr(user, "admin_profile") or user.is_staff or user.is_superuser:
            return "Administrators cannot be suspended or warned. Remove their admin role first."
        return None

    @action(detail=True, methods=["get"])
    def overview(self, request, pk=None):
        """Everything an admin needs to judge one account at a glance: identity check, money,
        activity, reports about them and their strike history. Read-only."""
        from django.db.models import Sum
        from marketplace.models import MarketplaceListingBase, MarketplaceOrder
        from monetization.models import WithdrawalRequest, WithdrawalStatus
        from property.models import Listing
        from social.models import Post
        from transactions.models import Booking
        from engagement.models import SupportTicket
        from .models import ContentReport, ReportStatus

        user = self.get_object()
        kyc = getattr(user, "kyc_profile", None)
        wallet = getattr(user, "wallet", None)
        presence = getattr(user, "presence", None)
        withdrawals = WithdrawalRequest.objects.filter(wallet__owner=user)
        reports_about_them = ContentReport.objects.filter(
            Q(target_user=user) | Q(target_post__author=user) | Q(target_comment__author=user)
        )

        def money(value):
            return f"{Decimal(value or 0):.2f}"

        return Response({
            "user": self.get_serializer(user).data,
            "last_seen_at": presence.last_seen_at if presence else None,
            "language": user.preferred_language,
            "kyc": {
                "status": kyc.kyc_status if kyc else "NONE",
                "legal_name": kyc.legal_full_name if kyc else "",
                "submitted_at": kyc.submitted_at if kyc else None,
                "reviewed_at": kyc.reviewed_at if kyc else None,
            },
            "wallet": {
                "balance_xaf": money(wallet.balance_xaf if wallet else 0),
                "pending_withdrawals": withdrawals.filter(status=WithdrawalStatus.PENDING).count(),
                "paid_out_xaf": money(withdrawals.filter(status=WithdrawalStatus.PAID_OUT).aggregate(t=Sum("amount_xaf"))["t"]),
            },
            "activity": {
                "property_listings": Listing.objects.filter(listed_by=user).count(),
                "marketplace_listings": MarketplaceListingBase.objects.filter(lister_user=user).count(),
                "marketplace_purchases": MarketplaceOrder.objects.filter(buyer=user).count(),
                "marketplace_sales": MarketplaceOrder.objects.filter(listing__lister_user=user).count(),
                "bookings": Booking.objects.filter(requester=user).count(),
                "posts": Post.objects.filter(author=user).count(),
                "support_chats": SupportTicket.objects.filter(submitted_by=user).count(),
            },
            "reports": {
                "filed": ContentReport.objects.filter(reported_by=user).count(),
                "against_open": reports_about_them.filter(status=ReportStatus.OPEN).count(),
                "against_total": reports_about_them.count(),
            },
            "strikes": [
                {
                    "number": w.strike_number, "reason": w.reason, "issued_at": w.issued_at,
                    "issued_by": (w.issued_by.username if w.issued_by else ""),
                }
                for w in user.warnings.select_related("issued_by").order_by("-issued_at")
            ],
        })

    @action(detail=True, methods=["post"], url_path="toggle-suspend")
    def toggle_suspend(self, request, pk=None):
        from django.utils import timezone
        user = self.get_object()
        audit_note(request, target_label=user.username, target_type="user")
        suspend = bool(request.data.get("suspend", False))
        if suspend:
            block = self._discipline_block(request, user)
            if block:
                return self._refuse(block)
            try:
                days = int(request.data.get("days", 30))
            except (TypeError, ValueError):
                return self._refuse("days must be a whole number between 1 and 365.", status.HTTP_400_BAD_REQUEST)
            if not 1 <= days <= 365:
                return self._refuse("days must be a whole number between 1 and 365.", status.HTTP_400_BAD_REQUEST)
            user.account_status = AccountStatus.SUSPENDED
            user.suspended_until = timezone.now() + timezone.timedelta(days=days)
        else:
            user.account_status = AccountStatus.ACTIVE
            user.suspended_until = None
        user.save(update_fields=["account_status", "suspended_until"])
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=["post"], url_path="issue-strike")
    def issue_strike(self, request, pk=None):
        from .services import issue_strike_and_apply_consequences
        user = self.get_object()
        audit_note(request, target_label=user.username, target_type="user")
        block = self._discipline_block(request, user)
        if block:
            return self._refuse(block)
        reason = str(request.data.get("reason") or "ADMIN_REVIEWED_REPORT").strip()
        if not reason or len(reason) > 30:
            return self._refuse("The strike reason must be between 1 and 30 characters.", status.HTTP_400_BAD_REQUEST)
        warning = issue_strike_and_apply_consequences(subject=user, reason=reason, issued_by=request.user)
        audit_note(request, strike_number=warning.strike_number)
        return Response({
            "strike_number": warning.strike_number,
            "account_status": user.account_status,
            "user": self.get_serializer(user).data,
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
        from identity.services import grant_role, is_super_admin

        user = self.get_object()
        role = request.data.get("role")
        audit_note(request, target_label=user.username, target_type="user")
        if role == "admin" and not is_super_admin(request.user):
            return self._refuse(ADMIN_ROLE_RESERVED)
        try:
            grant_role(
                user, role,
                commission_percent=request.data.get("commission_percent"),
                registration_number=request.data.get("registration_number"),
                institution_name=request.data.get("institution_name"),
                license_number=request.data.get("license_number"),
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        user.refresh_from_db()
        return Response(self.get_serializer(user).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="remove-role")
    def remove_role(self, request, pk=None):
        """The reverse of assign_role — lets an admin correct a
        mistakenly granted role without needing direct database access.
        Removing one role never touches any of the user's other roles.
        The admin role is protected: only a full-access admin may remove
        it, never from themselves, and never from the last administrator."""
        from identity.models import AdminProfile
        from identity.services import is_super_admin

        user = self.get_object()
        role = request.data.get("role")
        audit_note(request, target_label=user.username, target_type="user")
        profile_field = self.ROLE_PROFILE_FIELDS.get(role)
        if not profile_field:
            return Response({"detail": f"Unknown role '{role}'."}, status=status.HTTP_400_BAD_REQUEST)

        if role == "admin":
            if not is_super_admin(request.user):
                return self._refuse(ADMIN_ROLE_RESERVED)
            if user.pk == request.user.pk:
                return self._refuse("You cannot remove your own admin role.")
            if AdminProfile.objects.count() <= 1:
                return self._refuse("This is the last administrator; the platform must always have one.")

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
        return Response(self.get_serializer(user).data, status=status.HTTP_200_OK)


class AdminAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """The audit trail of admin actions. Full-access administrators only,
    and read-only: there is no way to edit or delete an entry over the API.
    Filters: ?q= (actor, target or action), ?actor=, ?action=, ?outcome=failed|success,
    ?since= and ?until= (YYYY-MM-DD)."""
    serializer_class = AuditLogSerializer
    permission_classes = [IsSuperAdmin]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AuditLog.objects.none()
        params = self.request.query_params
        qs = AuditLog.objects.all()
        query = params.get("q", "").strip()
        if query:
            qs = qs.filter(
                Q(actor_username__icontains=query) | Q(target_label__icontains=query)
                | Q(action__icontains=query) | Q(target_id__icontains=query)
            )
        if params.get("actor"):
            qs = qs.filter(actor_username__iexact=params["actor"])
        if params.get("action"):
            qs = qs.filter(action=params["action"])
        outcome = params.get("outcome")
        if outcome == "failed":
            qs = qs.filter(status_code__gte=400)
        elif outcome == "success":
            qs = qs.filter(status_code__lt=400)
        since = parse_date(params.get("since", ""))
        if since:
            qs = qs.filter(created_at__date__gte=since)
        until = parse_date(params.get("until", ""))
        if until:
            qs = qs.filter(created_at__date__lte=until)
        return qs
