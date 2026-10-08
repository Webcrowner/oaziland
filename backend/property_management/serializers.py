from rest_framework import serializers
from .models import MaintenanceRequest, MaintenanceCostEntry, Lease, TenantScreeningRequest, AgentSafetyCheckIn, DisputeMessage


class MaintenanceCostEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = MaintenanceCostEntry
        fields = ["id", "amount_xaf", "note", "recorded_at"]
        read_only_fields = fields


class MaintenanceRequestSerializer(serializers.ModelSerializer):
    reported_by_name = serializers.CharField(source="reported_by.full_name", read_only=True)
    cost_entries = MaintenanceCostEntrySerializer(many=True, read_only=True)

    class Meta:
        model = MaintenanceRequest
        fields = [
            "id", "property_asset", "reported_by", "reported_by_name", "category", "description",
            "cost_estimate_xaf", "status", "reported_at", "resolved_at", "cost_entries",
        ]
        read_only_fields = ["reported_by", "cost_estimate_xaf", "status", "reported_at", "resolved_at"]


class LeaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lease
        fields = ["id", "booking", "start_date", "end_date"]


class TenantScreeningRequestSerializer(serializers.ModelSerializer):
    landlord_name = serializers.CharField(source="landlord.full_name", read_only=True)
    prospective_tenant_name = serializers.CharField(source="prospective_tenant.full_name", read_only=True)

    class Meta:
        model = TenantScreeningRequest
        fields = [
            "id", "landlord", "landlord_name", "prospective_tenant", "prospective_tenant_name",
            "status", "report_summary", "requested_at", "consented_at",
        ]
        read_only_fields = ["landlord", "status", "report_summary", "requested_at", "consented_at"]


class AgentSafetyCheckInSerializer(serializers.ModelSerializer):
    agent_name = serializers.CharField(source="agent.full_name", read_only=True)

    class Meta:
        model = AgentSafetyCheckIn
        fields = [
            "id", "agent", "agent_name", "property_asset", "emergency_contact_name", "emergency_contact_phone",
            "started_at", "expected_checkout_at", "checked_out_at", "status",
        ]
        read_only_fields = ["agent", "started_at", "expected_checkout_at", "checked_out_at", "status"]


class StartCheckInSerializer(serializers.Serializer):
    """Write-only input for starting a check-in — expected_checkout_at
    is COMPUTED by start_safety_check_in() from this duration, not set
    directly, matching the service function's own real signature."""
    property_asset = serializers.UUIDField(required=False, allow_null=True)
    emergency_contact_name = serializers.CharField(max_length=200)
    emergency_contact_phone = serializers.CharField(max_length=20)
    expected_duration_minutes = serializers.IntegerField(min_value=1)


class OpenDisputeSerializer(serializers.Serializer):
    reason = serializers.CharField()


class AddMaintenanceCostSerializer(serializers.Serializer):
    amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class DisputeMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.full_name", read_only=True)

    class Meta:
        model = DisputeMessage
        fields = ["id", "dispute", "sender", "sender_name", "text", "created_at"]
        read_only_fields = ["dispute", "sender", "created_at"]
