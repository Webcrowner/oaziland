"""
property_management.views — the real gap this closes: maintenance
tracking, tenant screening, agent safety check-ins, and lease renewal
reminders all had real, working service functions, but nothing ever
exposed any of them. The most serious single piece here:
open_dispute() was never called anywhere in the real codebase —
meaning a real person affected by a payment problem had NO way to
actually raise a dispute in the first place, only admins could
respond to ones that (impossibly) already existed.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import MaintenanceRequest, TenantScreeningRequest, AgentSafetyCheckIn, Lease, DisputeCase, DisputeMessage
from .serializers import (
    MaintenanceRequestSerializer, AddMaintenanceCostSerializer,
    TenantScreeningRequestSerializer, AgentSafetyCheckInSerializer, StartCheckInSerializer,
    LeaseSerializer, OpenDisputeSerializer, DisputeMessageSerializer,
)
from .services import (
    add_maintenance_cost, request_tenant_screening, tenant_grants_consent, generate_screening_report,
    ConsentRequiredError, start_safety_check_in, check_out_safely, CheckInAlreadyClosedError,
    open_dispute, schedule_renewal_reminders,
)


class MaintenanceRequestViewSet(viewsets.ModelViewSet):
    """Scoped to requests the current user filed OR requests on
    property they own — a landlord needs to see maintenance reported
    on their own property, not just what they personally reported."""
    serializer_class = MaintenanceRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return MaintenanceRequest.objects.none()
        from django.db.models import Q
        user = self.request.user
        return MaintenanceRequest.objects.filter(
            Q(reported_by=user) | Q(property_asset__owner=user)
        ).distinct().select_related("property_asset", "reported_by").order_by("-reported_at")

    def perform_create(self, serializer):
        serializer.save(reported_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="add-cost")
    @extend_schema(request=AddMaintenanceCostSerializer, responses={201: dict})
    def add_cost(self, request, pk=None):
        maintenance_request = self.get_object()
        input_serializer = AddMaintenanceCostSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        entry = add_maintenance_cost(request=maintenance_request, **input_serializer.validated_data)
        return Response({"id": entry.id, "amount_xaf": str(entry.amount_xaf), "note": entry.note}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        maintenance_request = self.get_object()
        maintenance_request.close()
        return Response(MaintenanceRequestSerializer(maintenance_request).data)


class TenantScreeningRequestViewSet(viewsets.ModelViewSet):
    """create/list/retrieve only, no raw update/delete — every real
    state change goes through the two actions below (consent,
    report), which enforce the actual real rules themselves."""
    serializer_class = TenantScreeningRequestSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return TenantScreeningRequest.objects.none()
        from django.db.models import Q
        user = self.request.user
        # A landlord sees requests THEY made; a prospective tenant
        # sees requests made ABOUT them — never anyone else's.
        return TenantScreeningRequest.objects.filter(
            Q(landlord=user) | Q(prospective_tenant=user)
        ).distinct().order_by("-requested_at")

    def create(self, request, *args, **kwargs):
        prospective_tenant_id = request.data.get("prospective_tenant")
        if not prospective_tenant_id:
            return Response({"detail": "prospective_tenant is required."}, status=status.HTTP_400_BAD_REQUEST)
        from identity.models import User
        try:
            prospective_tenant = User.objects.get(id=prospective_tenant_id)
        except User.DoesNotExist:
            return Response({"detail": "That user was not found."}, status=status.HTTP_404_NOT_FOUND)
        screening_request = request_tenant_screening(landlord=request.user, prospective_tenant=prospective_tenant)
        return Response(TenantScreeningRequestSerializer(screening_request).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def consent(self, request, pk=None):
        """WHY this is its own action, not a generic PATCH: consent
        is a real state transition ONLY the tenant themselves can
        trigger — tenant_grants_consent() enforces this directly,
        raising PermissionError for anyone else, verified in tests."""
        screening_request = self.get_object()
        try:
            tenant_grants_consent(screening_request=screening_request, tenant=request.user)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(TenantScreeningRequestSerializer(screening_request).data)

    @action(detail=True, methods=["post"], url_path="generate-report")
    def generate_report(self, request, pk=None):
        screening_request = self.get_object()
        if screening_request.landlord_id != request.user.id:
            return Response({"detail": "Only the requesting landlord can generate this report."}, status=status.HTTP_403_FORBIDDEN)
        try:
            summary = generate_screening_report(screening_request)
        except ConsentRequiredError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(summary)


class AgentSafetyCheckInViewSet(viewsets.ModelViewSet):
    """Scoped to the agent's own check-ins — a real field-safety tool,
    not something anyone else should see or manage on their behalf."""
    serializer_class = AgentSafetyCheckInSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AgentSafetyCheckIn.objects.none()
        return AgentSafetyCheckIn.objects.filter(agent=self.request.user).order_by("-started_at")

    @extend_schema(request=StartCheckInSerializer, responses={201: AgentSafetyCheckInSerializer})
    def create(self, request, *args, **kwargs):
        input_serializer = StartCheckInSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        from property.models import PropertyAsset
        property_asset = None
        if input_serializer.validated_data.get("property_asset"):
            property_asset = PropertyAsset.objects.filter(id=input_serializer.validated_data["property_asset"]).first()
        check_in = start_safety_check_in(
            agent=request.user, property_asset=property_asset,
            emergency_contact_name=input_serializer.validated_data["emergency_contact_name"],
            emergency_contact_phone=input_serializer.validated_data["emergency_contact_phone"],
            expected_duration_minutes=input_serializer.validated_data["expected_duration_minutes"],
        )
        return Response(AgentSafetyCheckInSerializer(check_in).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="check-out")
    def check_out(self, request, pk=None):
        check_in = self.get_object()
        try:
            check_out_safely(check_in)
        except CheckInAlreadyClosedError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(AgentSafetyCheckInSerializer(check_in).data)


class LeaseViewSet(viewsets.ModelViewSet):
    """A real gap this closes: Lease.objects.create() was never
    called anywhere in the real codebase — a completed rental booking
    had no way to actually become a tracked lease with real renewal
    reminders. Creating one immediately schedules the real 60/30/7-day
    reminders (schedule_renewal_reminders), matching how the feature
    was designed to work end-to-end, not as two disconnected steps."""
    serializer_class = LeaseSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Lease.objects.none()
        return Lease.objects.filter(booking__requester=self.request.user).select_related("booking")

    def perform_create(self, serializer):
        """A real gap this closes: nothing here previously checked that
        the booking being wrapped into a lease actually belonged to the
        requesting user, or was even completed — any authenticated user
        could pass ANY booking id and create a lease against someone
        else's booking (a straightforward IDOR)."""
        from rest_framework.exceptions import PermissionDenied, ValidationError
        from transactions.models import BookingStatus

        booking = serializer.validated_data["booking"]
        if booking.requester_id != self.request.user.id:
            raise PermissionDenied("Only the booking's own requester can create a lease for it.")
        if booking.status != BookingStatus.COMPLETED:
            raise ValidationError({"booking": "A lease can only be created for a completed booking."})

        lease = serializer.save()
        schedule_renewal_reminders(lease)


class OpenDisputeView(APIView):
    """THE most serious real gap in this whole area: open_dispute()
    existed, fully implemented (sets real SLA deadlines, flips the
    escrow to DISPUTED), but was never called from anywhere reachable
    — a real person whose payment went wrong had literally no way to
    raise the issue. Only the booking's own requester can open a
    dispute on their own booking's escrow."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=OpenDisputeSerializer, responses={201: dict, 403: dict, 404: dict})
    def post(self, request, booking_id):
        from transactions.models import Booking

        try:
            booking = Booking.objects.select_related("escrow").get(id=booking_id)
        except Booking.DoesNotExist:
            return Response({"detail": "Booking not found."}, status=status.HTTP_404_NOT_FOUND)
        if booking.requester_id != request.user.id:
            return Response({"detail": "Only the booking's own requester can open a dispute on it."}, status=status.HTTP_403_FORBIDDEN)
        if not hasattr(booking, "escrow"):
            return Response({"detail": "This booking has no payment to dispute."}, status=status.HTTP_400_BAD_REQUEST)

        input_serializer = OpenDisputeSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        dispute = open_dispute(escrow=booking.escrow, raised_by=request.user, reason=input_serializer.validated_data["reason"])
        return Response({
            "id": dispute.id, "status": dispute.status,
            "response_due_at": dispute.response_due_at, "resolution_due_at": dispute.resolution_due_at,
        }, status=status.HTTP_201_CREATED)


class DisputeMessagesView(APIView):
    """3-way private dispute chat between the complainant, respondent (booking target owner), and admin."""
    permission_classes = [permissions.IsAuthenticated]

    def _get_dispute_and_check_access(self, request, dispute_id):
        from transactions.services import resolve_target_owner
        try:
            dispute = DisputeCase.objects.select_related("escrow__booking").get(id=dispute_id)
        except DisputeCase.DoesNotExist:
            return None, Response({"detail": "Dispute case not found."}, status=status.HTTP_404_NOT_FOUND)

        booking = dispute.escrow.booking
        target_owner = resolve_target_owner(booking)
        allowed_ids = {dispute.raised_by_id, booking.requester_id}
        if target_owner:
            allowed_ids.add(target_owner.id)

        is_admin = bool(getattr(request.user, "is_staff", False) or hasattr(request.user, "admin_profile"))
        if not is_admin and request.user.id not in allowed_ids:
            return None, Response({"detail": "You are not a party to this dispute mediation."}, status=status.HTTP_403_FORBIDDEN)

        return dispute, None

    @extend_schema(responses={200: DisputeMessageSerializer(many=True), 403: dict, 404: dict})
    def get(self, request, dispute_id):
        dispute, error_resp = self._get_dispute_and_check_access(request, dispute_id)
        if error_resp:
            return error_resp
        messages = dispute.messages.select_related("sender").order_by("created_at")
        return Response(DisputeMessageSerializer(messages, many=True).data)

    @extend_schema(request=DisputeMessageSerializer, responses={201: DisputeMessageSerializer, 403: dict, 404: dict})
    def post(self, request, dispute_id):
        dispute, error_resp = self._get_dispute_and_check_access(request, dispute_id)
        if error_resp:
            return error_resp
        text = request.data.get("text", "").strip()
        if not text:
            return Response({"detail": "text is required."}, status=status.HTTP_400_BAD_REQUEST)

        message = DisputeMessage.objects.create(dispute=dispute, sender=request.user, text=text)
        return Response(DisputeMessageSerializer(message).data, status=status.HTTP_201_CREATED)
