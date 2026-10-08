from rest_framework import serializers
from .models import ContentReport
from engagement.models import VerificationRequest
from property_management.models import DisputeCase
from identity.models import User


class AdminUserSerializer(serializers.ModelSerializer):
    """Real gap this closes: the admin console could suspend/warn ANY
    user, but had no way to tell what kind of user they even were —
    a landlord, an agent, an agency owner, a student, a technician, a
    driver, or a plain renter/buyer with no role at all. Mirrors the
    exact same role-flag pattern as identity.UserProfileSerializer."""
    strikes_count = serializers.IntegerField(source="warnings.count", read_only=True)
    full_name = serializers.CharField(read_only=True)
    is_admin = serializers.SerializerMethodField()
    is_agent = serializers.SerializerMethodField()
    is_landlord = serializers.SerializerMethodField()
    is_agency = serializers.SerializerMethodField()
    is_student = serializers.SerializerMethodField()
    is_technician = serializers.SerializerMethodField()
    is_driver = serializers.SerializerMethodField()
    kyc_status = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "phone", "email", "full_name",
            "verification_status", "account_status", "suspended_until",
            "strikes_count", "date_joined",
            "is_admin", "is_agent", "is_landlord", "is_agency",
            "is_student", "is_technician", "is_driver", "kyc_status",
        ]

    def get_is_admin(self, obj) -> bool:
        return hasattr(obj, "admin_profile") or obj.is_staff or obj.is_superuser

    def get_is_agent(self, obj) -> bool:
        return hasattr(obj, "agent_profile")

    def get_is_landlord(self, obj) -> bool:
        return hasattr(obj, "landlord_profile")

    def get_is_agency(self, obj) -> bool:
        return hasattr(obj, "agency_profile")

    def get_is_student(self, obj) -> bool:
        return hasattr(obj, "student_profile")

    def get_is_technician(self, obj) -> bool:
        return hasattr(obj, "technician_profile")

    def get_is_driver(self, obj) -> bool:
        return hasattr(obj, "driver_profile")

    def get_kyc_status(self, obj) -> str | None:
        return obj.kyc_profile.kyc_status if hasattr(obj, "kyc_profile") else None


class VerificationRequestSerializer(serializers.ModelSerializer):
    requester_name = serializers.CharField(source="requester.full_name", read_only=True)

    class Meta:
        model = VerificationRequest
        fields = ["id", "requester", "requester_name", "request_type", "subject_content_type", "subject_id", "status", "supporting_document_url", "submitted_at"]
        read_only_fields = ["status", "submitted_at"]


class ContentReportSerializer(serializers.ModelSerializer):
    reported_by_name = serializers.CharField(source="reported_by.full_name", read_only=True)

    class Meta:
        model = ContentReport
        fields = ["id", "reported_by", "reported_by_name", "reason", "status", "target_post", "target_listing_id", "target_comment", "target_user", "notes", "created_at"]
        read_only_fields = ["status", "created_at"]


class FileContentReportSerializer(serializers.Serializer):
    """Write-only input for the real user-facing filing endpoint —
    deliberately separate from ContentReportSerializer above (which
    stays the read/admin shape) since exactly one target field should
    be provided here, a constraint that doesn't belong on the general
    read serializer."""
    reason = serializers.ChoiceField(choices=ContentReport._meta.get_field("reason").choices)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    target_post = serializers.UUIDField(required=False, allow_null=True)
    target_listing_id = serializers.UUIDField(required=False, allow_null=True)
    target_comment = serializers.UUIDField(required=False, allow_null=True)
    target_user = serializers.UUIDField(required=False, allow_null=True)


class DisputeCaseSerializer(serializers.ModelSerializer):
    raised_by_name = serializers.CharField(source="raised_by.full_name", read_only=True)

    class Meta:
        model = DisputeCase
        fields = ["id", "escrow", "raised_by", "raised_by_name", "status", "reason", "created_at", "response_due_at", "resolution_due_at"]
        read_only_fields = ["status", "created_at", "response_due_at", "resolution_due_at"]
