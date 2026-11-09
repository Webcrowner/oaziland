"""
compliance.views — consent, data export, and public policy documents.
Consent and export are scoped to the authenticated user's OWN records;
policy documents are public (AllowAny) — anyone should be able to read
the current Terms/Privacy Policy without an account.
"""
from rest_framework import mixins, viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from oaziland.permissions import IsAdminRole
from .models import ConsentRecord, DataExportRequest, PolicyDocument
from .serializers import ConsentRecordSerializer, DataExportRequestSerializer, PolicyDocumentSerializer
from .services import record_consent, request_data_export, DataExportError


class ConsentRecordViewSet(viewsets.ModelViewSet):
    serializer_class = ConsentRecordSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # WHY this guard: drf-spectacular calls get_queryset() during
        # schema generation with no real authenticated user, which
        # previously crashed comparing AnonymousUser to a UUID field.
        if getattr(self, "swagger_fake_view", False):
            return ConsentRecord.objects.none()
        return ConsentRecord.objects.filter(user=self.request.user).order_by("-granted_at")

    def perform_create(self, serializer):
        record_consent(
            user=self.request.user,
            consent_type=serializer.validated_data["consent_type"],
            version=serializer.validated_data["version"],
        )


class DataExportRequestViewSet(mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet):
    """The caller's own data exports. POST makes a new one (at most one every few minutes); GET .../download/
    returns the file, only to its owner, until it expires."""
    serializer_class = DataExportRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # WHY this guard: drf-spectacular calls get_queryset() during
        # schema generation with no real authenticated user, which
        # previously crashed comparing AnonymousUser to a UUID field.
        if getattr(self, "swagger_fake_view", False):
            return DataExportRequest.objects.none()
        return DataExportRequest.objects.filter(user=self.request.user).order_by("-requested_at")

    def create(self, request, *args, **kwargs):
        try:
            export_request = request_data_export(request.user)
        except DataExportError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        return Response(DataExportRequestSerializer(export_request).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        from django.http import FileResponse
        from django.utils import timezone

        export_request = self.get_object()  # scoped to the caller, so anyone else gets a 404
        if export_request.status != "READY" or not export_request.export_file:
            return Response({"detail": "This export is no longer available. Ask for a new one."}, status=status.HTTP_410_GONE)
        if export_request.expires_at and export_request.expires_at <= timezone.now():
            return Response({"detail": "This export is no longer available. Ask for a new one."}, status=status.HTTP_410_GONE)
        DataExportRequest.objects.filter(pk=export_request.pk).update(downloaded_at=timezone.now())
        response = FileResponse(
            export_request.export_file.open("rb"), as_attachment=True,
            filename=f"oaziland-data-{timezone.localdate():%Y-%m-%d}.json", content_type="application/json",
        )
        response["Cache-Control"] = "no-store"
        return response


class PolicyDocumentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PolicyDocumentSerializer
    permission_classes = [permissions.AllowAny]
    queryset = PolicyDocument.objects.filter(is_current=True)


def _confirms(typed, username: str) -> bool:
    """A deletion is only accepted when the account's username was typed out, so a stray click can't delete it."""
    return isinstance(typed, str) and typed.strip() == username


def _deletion_state(user) -> dict:
    from engagement.models import AccountDeletionRequest
    from engagement.services import ACCOUNT_DELETION_RETENTION_DAYS, account_deletion_blockers

    request = AccountDeletionRequest.objects.filter(user=user).first()
    return {
        "status": request.status if request else "NONE",
        "requested_at": request.requested_at if request else None,
        "scheduled_for": request.retention_expires_at if request and request.status == "REQUESTED" else None,
        "cancelled_at": request.cancelled_at if request else None,
        "cancelled_by_team": bool(request and request.cancelled_by_id),
        "cancellation_reason": request.cancellation_reason if request else "",
        "retention_days": ACCOUNT_DELETION_RETENTION_DAYS,
        "confirmation_text": user.username,
        "blockers": account_deletion_blockers(user),
    }


class MyAccountDeletionView(APIView):
    """GET the caller's deletion status (and what would hold it up); POST {password, reason?} schedules it after
    the retention window; DELETE cancels a scheduled deletion."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(_deletion_state(request.user))

    def post(self, request):
        from engagement.services import AccountDeletionError, request_account_deletion

        if hasattr(request.user, "admin_profile"):
            return Response({"detail": "Administrator accounts cannot be deleted this way. Remove the admin role first."}, status=status.HTTP_403_FORBIDDEN)
        if not _confirms(request.data.get("confirmation"), request.user.username):
            return Response({"detail": "Type your username exactly to confirm the deletion."}, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.check_password(str(request.data.get("password") or "")):
            return Response({"detail": "That password is not correct."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            request_account_deletion(request.user, reason=str(request.data.get("reason") or ""))
        except AccountDeletionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_deletion_state(request.user), status=status.HTTP_201_CREATED)

    def delete(self, request):
        from engagement.models import AccountDeletionRequest
        from engagement.services import AccountDeletionError, cancel_account_deletion

        deletion = AccountDeletionRequest.objects.filter(user=request.user).first()
        if deletion is None:
            return Response({"detail": "Only a scheduled deletion can be cancelled."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            cancel_account_deletion(deletion)
        except AccountDeletionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_deletion_state(request.user))


class AdminAccountDeletionViewSet(viewsets.GenericViewSet):
    """Account deletion requests. GET ?state=scheduled|blocked|completed|cancelled|all (default scheduled) and ?q=,
    paged. POST complete (full-access admins only: deletes the account now, refused while money or a deal is open)
    and POST cancel {reason} (    the user is told why)."""
    permission_classes = [IsAdminRole]
    serializer_class = None

    def get_queryset(self):
        from engagement.models import AccountDeletionRequest
        return AccountDeletionRequest.objects.select_related("user", "cancelled_by").order_by("retention_expires_at")

    @staticmethod
    def _row(item, blockers):
        from django.utils import timezone

        user = item.user
        deleted = item.status == "COMPLETED"
        return {
            "id": str(item.pk), "status": item.status, "requested_at": item.requested_at,
            "scheduled_for": item.retention_expires_at, "completed_at": item.completed_at, "reason": item.reason,
            "overdue": item.status == "REQUESTED" and item.retention_expires_at <= timezone.now(),
            "cancelled_at": item.cancelled_at, "cancelled_by": item.cancelled_by.username if item.cancelled_by else "",
            "cancellation_reason": item.cancellation_reason, "blockers": blockers,
            "user": {
                "id": str(user.pk), "username": user.username, "name": "" if deleted else (user.full_name or user.username),
                "phone": "" if deleted else user.phone, "email": "" if deleted else (user.email or ""),
            },
        }

    def list(self, request):
        from django.db.models import Q
        from django.utils import timezone
        from engagement.services import account_deletion_blockers

        state = request.query_params.get("state", "scheduled")
        if state not in ("scheduled", "blocked", "completed", "cancelled", "all"):
            return Response({"detail": "Unknown state."}, status=status.HTTP_400_BAD_REQUEST)
        qs = self.get_queryset()
        if state in ("scheduled", "blocked"):
            qs = qs.filter(status="REQUESTED")
        elif state != "all":
            qs = qs.filter(status=state.upper())
        for term in request.query_params.get("q", "").split()[:4]:
            qs = qs.filter(
                Q(user__username__icontains=term) | Q(user__first_name__icontains=term) | Q(user__last_name__icontains=term)
                | Q(user__phone__icontains=term) | Q(user__email__icontains=term)
            )
        if state == "blocked":
            # Overdue but still waiting because of money or an open deal; a small set, so filtered in Python.
            rows = [item for item in qs.filter(retention_expires_at__lte=timezone.now()) if account_deletion_blockers(item.user)]
            page = self.paginate_queryset(rows)
        else:
            page = self.paginate_queryset(qs if state == "scheduled" else qs.order_by("-requested_at"))
        return self.get_paginated_response([
            self._row(item, account_deletion_blockers(item.user) if item.status == "REQUESTED" else []) for item in page
        ])

    def _get(self, pk):
        from django.shortcuts import get_object_or_404
        return get_object_or_404(self.get_queryset(), pk=pk)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        from identity.services import is_super_admin
        from trust_safety.audit import audit_note
        from engagement.services import AccountDeletionError, complete_deletion_request

        item = self._get(pk)
        audit_note(request, target_type="account-deletion", target_label=item.user.username)
        if not is_super_admin(request.user):
            return Response({"detail": "Only a full-access administrator can delete an account early."}, status=status.HTTP_403_FORBIDDEN)
        if not _confirms(request.data.get("confirmation"), item.user.username):
            return Response({"detail": "Type the account's username exactly to confirm the deletion."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            item = complete_deletion_request(item)
        except AccountDeletionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self._row(item, []))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        from trust_safety.audit import audit_note
        from engagement.services import AccountDeletionError, account_deletion_blockers, cancel_account_deletion

        item = self._get(pk)
        audit_note(request, target_type="account-deletion", target_label=item.user.username)
        try:
            cancel_account_deletion(item, by=request.user, reason=str(request.data.get("reason") or ""))
        except AccountDeletionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self._row(item, account_deletion_blockers(item.user)))


class AdminDataExportViewSet(viewsets.GenericViewSet):
    """Who asked for a copy of their data and whether it was produced and downloaded. Read-only, and admins never
    get the file itself: it is the user's personal data. GET ?state=ready|expired|failed|all &q=, paged."""
    permission_classes = [IsAdminRole]
    serializer_class = None
    queryset = DataExportRequest.objects.none()

    def list(self, request):
        from django.db.models import Q

        state = request.query_params.get("state", "all")
        if state not in ("ready", "expired", "failed", "pending", "all"):
            return Response({"detail": "Unknown state."}, status=status.HTTP_400_BAD_REQUEST)
        qs = DataExportRequest.objects.select_related("user").order_by("-requested_at")
        if state != "all":
            qs = qs.filter(status=state.upper())
        for term in request.query_params.get("q", "").split()[:4]:
            qs = qs.filter(Q(user__username__icontains=term) | Q(user__first_name__icontains=term) | Q(user__last_name__icontains=term) | Q(user__phone__icontains=term))
        page = self.paginate_queryset(qs)
        return self.get_paginated_response([
            {
                "id": str(item.pk), "status": item.status, "requested_at": item.requested_at, "completed_at": item.completed_at,
                "expires_at": item.expires_at, "downloaded_at": item.downloaded_at,
                "user": {"id": str(item.user.pk), "username": item.user.username, "name": item.user.full_name or item.user.username},
            }
            for item in page
        ])
