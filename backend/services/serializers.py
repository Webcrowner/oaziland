from rest_framework import serializers
from identity.models import TechnicianProfile
from .models import (
    ServiceRequest, ServiceRequestPhoto, ServiceRequestMessage, TechnicianAvailabilitySlot, FacilityManagementContract,
    FacilityVisitLog, ProjectManagementCase, ProjectMilestone, ServiceDisputeResolution,
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
    requested_technician_name = serializers.CharField(source="requested_technician.full_name", read_only=True, default=None)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True, default=None)
    photos = ServiceRequestPhotoSerializer(many=True, read_only=True)
    technician_location = serializers.SerializerMethodField()
    escrow_funded = serializers.SerializerMethodField()
    distance_km = serializers.SerializerMethodField()
    quote_deadline = serializers.SerializerMethodField()
    auto_release_at = serializers.SerializerMethodField()
    requester_rating = serializers.SerializerMethodField()
    my_review = serializers.SerializerMethodField()
    their_review = serializers.SerializerMethodField()
    technician_overdue = serializers.SerializerMethodField()
    # Photos of the problem, attached when posting so technicians can quote with something to look at.
    photo_urls = serializers.ListField(child=serializers.URLField(), required=False, write_only=True, max_length=5)

    class Meta:
        model = ServiceRequest
        fields = [
            "id", "requester", "requester_name", "technician", "technician_name", "category", "priority",
            "requested_technician", "requested_technician_name", "distance_km", "quote_deadline",
            "work_completed_at", "auto_release_at", "requester_rating", "my_review", "their_review", "photo_urls", "technician_overdue",
            "status", "description", "quarter", "quarter_name", "latitude", "longitude", "address_note", "area_label",
            "quoted_amount_xaf", "quoted_labor_xaf", "quoted_materials_xaf", "quote_approved", "dispute_reason",
            "dispute_resolution", "dispute_resolution_notes", "escrow_funded",
            "scheduled_for", "technician_location",
            "requested_at", "accepted_at", "en_route_at", "started_at", "completed_at", "photos",
        ]
        read_only_fields = [
            "requester", "technician", "status", "quoted_amount_xaf", "quoted_labor_xaf", "quoted_materials_xaf",
            "quote_approved", "dispute_reason", "dispute_resolution", "dispute_resolution_notes",
            "requested_at", "accepted_at", "en_route_at", "started_at", "completed_at", "work_completed_at",
        ]

    def validate(self, attrs):
        has_area = bool((attrs.get("area_label") or "").strip())
        if not attrs.get("quarter") and not has_area and (attrs.get("latitude") is None or attrs.get("longitude") is None):
            raise serializers.ValidationError("Share a GPS location, pick a quarter, or name the town or neighbourhood so technicians can tell where the job is.")
        if attrs.get("priority") == "URGENT" and attrs.get("scheduled_for") is not None:
            raise serializers.ValidationError({"scheduled_for": "An urgent request cannot be scheduled for later."})
        from .services import contains_contact_details, CONTACT_SHARING_MESSAGE
        if contains_contact_details(attrs.get("description") or ""):
            raise serializers.ValidationError({"description": CONTACT_SHARING_MESSAGE})
        if contains_contact_details(attrs.get("area_label") or ""):
            raise serializers.ValidationError({"area_label": CONTACT_SHARING_MESSAGE})
        chosen = attrs.get("requested_technician")
        if chosen is not None:
            from .services import validate_requested_technician, InvalidDirectRequestError
            try:
                validate_requested_technician(requester=self.context["request"].user, technician=chosen, category=attrs["category"])
            except InvalidDirectRequestError as e:
                raise serializers.ValidationError({"requested_technician": str(e)})
        return attrs

    def _viewer_id(self):
        request = self.context.get("request")
        return getattr(getattr(request, "user", None), "id", None)

    def get_escrow_funded(self, obj) -> bool:
        from .services import is_escrow_funded
        return is_escrow_funded(obj)

    def get_technician_overdue(self, obj) -> bool:
        # True once the assigned technician is a no-show, which lets the requester replace them even after paying.
        from .services import is_technician_overdue
        return is_technician_overdue(obj)

    def get_requester_rating(self, obj) -> dict:
        # The client's reputation with technicians, so a technician can judge a job before accepting it.
        cache = self.context.setdefault("requester_ratings", {})
        if obj.requester_id not in cache:
            from .services import get_requester_reputation
            cache[obj.requester_id] = get_requester_reputation(obj.requester)
        return cache[obj.requester_id]

    @staticmethod
    def _review_payload(review) -> dict:
        return {"score": float(review.score), "comment": review.comment}

    def get_my_review(self, obj) -> dict:
        viewer_id = self._viewer_id()
        mine = next((r for r in obj.reviews.all() if r.author_id == viewer_id), None)
        return self._review_payload(mine) if mine else None

    def get_their_review(self, obj) -> dict:
        # Blind until the viewer has reviewed too, so neither side can retaliate.
        viewer_id = self._viewer_id()
        if viewer_id not in (obj.requester_id, obj.technician_id):
            return None
        reviews = list(obj.reviews.all())
        if not any(r.author_id == viewer_id for r in reviews):
            return None
        theirs = next((r for r in reviews if r.author_id != viewer_id), None)
        return self._review_payload(theirs) if theirs else None

    def get_auto_release_at(self, obj) -> str:
        # When the held payment is released if the requester stays silent after the technician reports the work done.
        if obj.status != "IN_PROGRESS" or obj.work_completed_at is None:
            return None
        from datetime import timedelta
        from .services import AUTO_RELEASE_HOURS, is_escrow_funded
        if not is_escrow_funded(obj):
            return None
        return (obj.work_completed_at + timedelta(hours=AUTO_RELEASE_HOURS)).isoformat()

    def get_quote_deadline(self, obj) -> str:
        # When an accepted-but-unquoted job goes back to the board.
        if obj.status != "ACCEPTED" or obj.quoted_amount_xaf is not None or obj.accepted_at is None:
            return None
        from datetime import timedelta
        from .services import quote_deadline_hours
        return (obj.accepted_at + timedelta(hours=quote_deadline_hours(obj))).isoformat()

    def get_distance_km(self, obj) -> float:
        # Job-board viewers only: how far the site is from the technician's last known position, to the nearest 0.5 km.
        viewer_id = self._viewer_id()
        if viewer_id is None or viewer_id in (obj.requester_id, obj.technician_id) or obj.latitude is None or obj.longitude is None:
            return None
        if "technician_point" not in self.context:
            from .services import get_technician_reference_point
            self.context["technician_point"] = get_technician_reference_point(self.context["request"].user)
        point = self.context["technician_point"]
        if point is None:
            return None
        from geo.services import haversine_distance_km
        return round(float(haversine_distance_km(obj.latitude, obj.longitude, point[0], point[1])) * 2) / 2

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
        data["address_note"] = ""
        return data


class CompleteServiceRequestSerializer(serializers.Serializer):
    # Only needed for legacy jobs that were never paid into escrow before work started.
    phone_number = serializers.CharField(required=False, allow_blank=True, default="")


class FundServiceRequestSerializer(serializers.Serializer):
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


class ResolveServiceDisputeSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=ServiceDisputeResolution.choices)
    notes = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")


class AdminServiceDisputeSerializer(serializers.ModelSerializer):
    requester_name = serializers.CharField(source="requester.full_name", read_only=True)
    technician_name = serializers.CharField(source="technician.full_name", read_only=True, default=None)
    status = serializers.CharField(read_only=True)
    category = serializers.CharField(read_only=True)
    messages = serializers.SerializerMethodField()
    escrow_funded = serializers.SerializerMethodField()

    class Meta:
        model = ServiceRequest
        fields = [
            "id", "requester", "requester_name", "technician", "technician_name", "category", "description",
            "status", "dispute_reason", "quoted_amount_xaf", "quote_approved", "requested_at", "started_at",
            "messages", "escrow_funded",
        ]

    def get_escrow_funded(self, obj) -> bool:
        from .services import is_escrow_funded
        return is_escrow_funded(obj)

    def get_messages(self, obj) -> list:
        recent = list(obj.messages.select_related("sender").order_by("-created_at")[:20])
        return [
            {"id": m.id, "sender_name": m.sender.full_name or m.sender.username, "text": m.text, "created_at": m.created_at}
            for m in reversed(recent)
        ]


class ServiceRequestMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.full_name", read_only=True)

    class Meta:
        model = ServiceRequestMessage
        fields = ["id", "sender", "sender_name", "text", "created_at"]
        read_only_fields = ["sender", "created_at"]


class RateTechnicianSerializer(serializers.Serializer):
    score = serializers.DecimalField(max_digits=2, decimal_places=1, min_value=1, max_value=5)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")


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
            "rejection_reason", "credential_urls", "portfolio_urls", "created_at",
        ]
        read_only_fields = ["avg_rating", "is_verified", "rejection_reason", "credential_urls", "portfolio_urls", "created_at"]


class TechnicianReviewReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=3, max_length=1000)


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
