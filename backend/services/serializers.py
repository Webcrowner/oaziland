from rest_framework import serializers
from identity.models import TechnicianProfile
from .models import (
    ServiceRequest, ServiceRequestPhoto, ServiceRequestMessage, TechnicianAvailabilitySlot, FacilityManagementContract,
    FacilityVisitLog, ProjectManagementCase, ProjectMilestone,
)


class ServiceRequestPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceRequestPhoto
        fields = ["id", "photo_type", "file_url", "uploaded_at"]


class ServiceRequestPhotoUploadSerializer(serializers.Serializer):
    photo_type = serializers.ChoiceField(choices=["BEFORE", "AFTER"])
    file_url = serializers.URLField()


class TechnicianLocationPingSerializer(serializers.Serializer):
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)


class TechnicianAvailabilitySlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = TechnicianAvailabilitySlot
        fields = ["day_of_week", "start_time", "end_time"]


class SetTechnicianAvailabilitySerializer(serializers.Serializer):
    slots = TechnicianAvailabilitySlotSerializer(many=True)


class ServiceRequestSerializer(serializers.ModelSerializer):
    requester_name = serializers.CharField(source="requester.full_name", read_only=True)
    technician_name = serializers.CharField(source="technician.full_name", read_only=True, default=None)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True, default=None)
    photos = ServiceRequestPhotoSerializer(many=True, read_only=True)
    technician_location = serializers.SerializerMethodField()

    class Meta:
        model = ServiceRequest
        fields = [
            "id", "requester", "requester_name", "technician", "technician_name", "category", "priority",
            "status", "description", "quarter", "quarter_name", "latitude", "longitude",
            "quoted_amount_xaf", "quoted_labor_xaf", "quoted_materials_xaf", "quote_approved", "dispute_reason",
            "scheduled_for", "technician_location",
            "requested_at", "accepted_at", "en_route_at", "started_at", "completed_at", "photos",
        ]
        read_only_fields = [
            "requester", "technician", "status", "quoted_amount_xaf", "quoted_labor_xaf", "quoted_materials_xaf",
            "quote_approved", "dispute_reason",
            "requested_at", "accepted_at", "en_route_at", "started_at", "completed_at",
        ]

    def validate(self, attrs):
        if not attrs.get("quarter") and (attrs.get("latitude") is None or attrs.get("longitude") is None):
            raise serializers.ValidationError("Provide a quarter or a GPS location so technicians can find you.")
        return attrs

    def _viewer_id(self):
        request = self.context.get("request")
        return getattr(getattr(request, "user", None), "id", None)

    def get_technician_location(self, obj) -> dict:
        # Only the requester follows the technician, and only while the job is live.
        if self._viewer_id() != obj.requester_id or obj.technician_id is None:
            return None
        if obj.status not in ("ACCEPTED", "EN_ROUTE", "IN_PROGRESS"):
            return None
        ping = obj.technician.location_pings.order_by("-recorded_at").first()
        if ping is None:
            return None
        return {"latitude": str(ping.latitude), "longitude": str(ping.longitude), "recorded_at": ping.recorded_at}

    def to_representation(self, instance):
        data = super().to_representation(instance)
        viewer_id = self._viewer_id()
        if viewer_id in (instance.requester_id, instance.technician_id):
            return data
        # Job-board viewers see an approximate area and a first name only until they are on the job.
        for key in ("latitude", "longitude"):
            if data.get(key) is not None:
                data[key] = str(round(float(data[key]), 2))
        data["requester"] = None
        data["requester_name"] = (data.get("requester_name") or "").split(" ")[0]
        return data


class CompleteServiceRequestSerializer(serializers.Serializer):
    # The price is the approved quote — the requester no longer types an amount.
    phone_number = serializers.CharField()


class ProposeQuoteSerializer(serializers.Serializer):
    # Either a lump-sum amount_xaf, or an itemized labor_xaf (+ optional materials_xaf) whose sum is the total.
    amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=1, required=False)
    labor_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False)
    materials_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False)

    def validate(self, attrs):
        if "amount_xaf" not in attrs and "labor_xaf" not in attrs:
            raise serializers.ValidationError("Provide amount_xaf, or labor_xaf with optional materials_xaf.")
        if "labor_xaf" not in attrs and "materials_xaf" in attrs:
            raise serializers.ValidationError("materials_xaf needs labor_xaf.")
        return attrs


class EnRouteSerializer(serializers.Serializer):
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False)


class DisputeServiceRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=5, max_length=2000)


class RescheduleServiceRequestSerializer(serializers.Serializer):
    scheduled_for = serializers.DateTimeField()


class ServiceRequestMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.full_name", read_only=True)

    class Meta:
        model = ServiceRequestMessage
        fields = ["id", "sender", "sender_name", "text", "created_at"]
        read_only_fields = ["sender", "created_at"]


class RateTechnicianSerializer(serializers.Serializer):
    score = serializers.DecimalField(max_digits=2, decimal_places=1, min_value=1, max_value=5)


class FindTechniciansSerializer(serializers.Serializer):
    category = serializers.CharField()
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    radius_km = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=10)


class TechnicianProfileSerializer(serializers.ModelSerializer):
    quarter_name = serializers.CharField(source="coverage_quarter.name", read_only=True, default=None)
    # The admin technician-verification queue needs to know WHO it's reviewing.
    user_name = serializers.CharField(source="user.full_name", read_only=True)

    class Meta:
        model = TechnicianProfile
        fields = [
            "id", "user_name", "specialties", "coverage_quarter", "quarter_name", "avg_rating", "is_verified",
            "credential_urls", "portfolio_urls", "created_at",
        ]
        read_only_fields = ["avg_rating", "is_verified", "credential_urls", "portfolio_urls", "created_at"]


class TechnicianDocumentsSerializer(serializers.Serializer):
    credential_urls = serializers.ListField(child=serializers.URLField(max_length=500), max_length=10)
    portfolio_urls = serializers.ListField(child=serializers.URLField(max_length=500), max_length=20)


class TechnicianRegistrationSerializer(serializers.Serializer):
    specialties = serializers.ListField(child=serializers.CharField(), allow_empty=False)
    coverage_quarter = serializers.IntegerField(required=False, allow_null=True)


class FacilityVisitLogSerializer(serializers.ModelSerializer):
    logged_by_name = serializers.CharField(source="logged_by.full_name", read_only=True)

    class Meta:
        model = FacilityVisitLog
        fields = ["id", "logged_by", "logged_by_name", "notes", "photo_url", "visited_at"]
        read_only_fields = ["logged_by"]


class LogFacilityVisitSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    photo_url = serializers.URLField(required=False, allow_blank=True, default="")


class FacilityManagementContractSerializer(serializers.ModelSerializer):
    technician_name = serializers.CharField(source="technician.full_name", read_only=True, default=None)
    agency_name = serializers.CharField(source="agency.agency_name", read_only=True, default=None)
    visit_logs = FacilityVisitLogSerializer(many=True, read_only=True)

    class Meta:
        model = FacilityManagementContract
        fields = [
            "id", "owner", "target_content_type", "target_id", "technician", "technician_name",
            "agency", "agency_name", "scope", "frequency", "start_date", "is_active", "created_at", "visit_logs",
        ]
        read_only_fields = ["owner", "is_active", "created_at"]


class ProjectMilestoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectMilestone
        fields = ["id", "case", "title", "budget_allocation_xaf", "due_date", "status", "completed_at"]
        read_only_fields = ["status", "completed_at"]


class AddProjectMilestoneSerializer(serializers.Serializer):
    title = serializers.CharField()
    budget_allocation_xaf = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)
    due_date = serializers.DateField(required=False, allow_null=True)


class CompleteProjectMilestoneSerializer(serializers.Serializer):
    milestone_id = serializers.UUIDField()


class LinkProjectTechnicianSerializer(serializers.Serializer):
    technician = serializers.UUIDField()


class ProjectManagementCaseSerializer(serializers.ModelSerializer):
    technician_names = serializers.SerializerMethodField()
    milestones = ProjectMilestoneSerializer(many=True, read_only=True)

    class Meta:
        model = ProjectManagementCase
        fields = [
            "id", "owner", "title", "description", "budget_xaf", "status", "target_content_type",
            "target_id", "technicians", "technician_names", "milestones", "created_at",
        ]
        read_only_fields = ["owner", "status", "technicians", "created_at"]

    def get_technician_names(self, obj) -> list:
        return [tech.full_name for tech in obj.technicians.all()]
