"""
services — Taskln-scoped technician services (Prompt 10). Oaziland's
Technician module is a deliberately narrower subset of Taskln (Glorentech's
separate general workforce platform) — real-estate-relevant professions
only, not Taskln's full open-ended profession list.
"""
import uuid
from django.conf import settings
from django.db import models


class ServiceCategory(models.TextChoices):
    """A FIXED list, per Prompt 10 — deliberately narrower than Taskln's
    open-ended profession list. TechnicianProfile.specialties (identity
    app) is validated against this list by services/services.py rather
    than being free text, so a technician can't register as a specialty
    Oaziland doesn't actually support."""
    PLUMBING = "PLUMBING", "Plumbing"
    ELECTRICAL = "ELECTRICAL", "Electrical"
    PAINTING = "PAINTING", "Painting"
    SURVEYING = "SURVEYING", "Surveying"
    ARCHITECTURE = "ARCHITECTURE", "Architecture"
    CLEANING = "CLEANING", "Cleaning"
    MOVING = "MOVING", "Moving"
    SECURITY_INSTALLATION = "SECURITY_INSTALLATION", "Security Installation"


class ServiceRequestPriority(models.TextChoices):
    SCHEDULED = "SCHEDULED", "Scheduled"
    URGENT = "URGENT", "Urgent (Emergency)"


class ServiceRequestStatus(models.TextChoices):
    REQUESTED = "REQUESTED", "Requested"
    ACCEPTED = "ACCEPTED", "Accepted"
    EN_ROUTE = "EN_ROUTE", "Technician En Route"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"
    DISPUTED = "DISPUTED", "Disputed"


class ServiceRequest(models.Model):
    """A request for a technician. Deliberately holds an OPTIONAL link to
    a Booking (transactions app) — a request exists the moment someone
    asks for help, before any money is involved; the Booking/PaymentEscrow
    only gets created once a technician accepts and a price is agreed.
    Service payments ALWAYS flow through Oaziland's own escrow, never
    Taskln's payment rails — see transactions/services.py's
    _fee_category_for_booking_type, fixed as part of this same prompt."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="service_requests_made")
    technician = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="service_requests_received",
    )
    category = models.CharField(max_length=25, choices=ServiceCategory.choices)
    priority = models.CharField(max_length=10, choices=ServiceRequestPriority.choices, default=ServiceRequestPriority.SCHEDULED)
    status = models.CharField(max_length=15, choices=ServiceRequestStatus.choices, default=ServiceRequestStatus.REQUESTED)
    description = models.TextField(blank=True)
    quarter = models.ForeignKey("geo.Quarter", on_delete=models.SET_NULL, null=True, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    booking = models.OneToOneField("transactions.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="service_request")
    # Price is agreed up front: technician proposes, requester approves, payment settles at exactly this amount.
    quoted_amount_xaf = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Optional breakdown behind the total; null when the technician quoted a single lump sum.
    quoted_labor_xaf = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    quoted_materials_xaf = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    quote_approved = models.BooleanField(default=False)
    dispute_reason = models.TextField(blank=True)
    # When the requester wants the job done; null means as soon as possible.
    scheduled_for = models.DateTimeField(null=True, blank=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    en_route_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "service_requests"
        indexes = [models.Index(fields=["category", "status"])]


class ServiceRequestMessage(models.Model):
    """In-job chat between the requester and the assigned technician."""
    service_request = models.ForeignKey(ServiceRequest, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="service_request_messages")
    text = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "service_request_messages"
        ordering = ["created_at"]


class ServiceRequestPhotoType(models.TextChoices):
    BEFORE = "BEFORE", "Before"
    AFTER = "AFTER", "After"


class ServiceRequestPhoto(models.Model):
    """Before/after documentation — protects both the technician (proof
    of completed work) and the requester (proof of condition beforehand)
    in the event of a dispute."""
    service_request = models.ForeignKey(ServiceRequest, on_delete=models.CASCADE, related_name="photos")
    photo_type = models.CharField(max_length=10, choices=ServiceRequestPhotoType.choices)
    file_url = models.URLField()
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "service_request_photos"


class TechnicianAvailabilitySlot(models.Model):
    """A recurring weekly availability window — 'modern functionality':
    lets the matching service (services/services.py) only surface
    technicians who are actually available right now, not just ones who
    exist."""
    technician = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="availability_slots")
    day_of_week = models.PositiveSmallIntegerField()  # 0=Monday .. 6=Sunday
    start_time = models.TimeField()
    end_time = models.TimeField()

    class Meta:
        db_table = "technician_availability_slots"


class TechnicianLocationPing(models.Model):
    """A snapshot of a technician's location at a point in time — the
    DATA MODEL for live location tracking (an Uber-style 'technician is 5
    minutes away' feature). The real-time PUSH of this to a requester's
    app (via WebSockets) is NOT built yet — this only stores pings, it
    doesn't broadcast them. Flagged the same way the payment gateways and
    moderation providers are: the foundation is real, the live wiring
    is a clearly separate, later piece of work."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    technician = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="location_pings")
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=10, decimal_places=7)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "technician_location_pings"
        indexes = [models.Index(fields=["technician", "-recorded_at"])]


class TasklnIntegrationSettings(models.Model):
    """A single-row, DB-backed configuration flag — deliberately NOT a
    hardcoded Python constant, so it can be changed by an admin without a
    code deployment. CONFIRMED BY THE FOUNDER: Oaziland always runs its
    own separate verification pass rather than trusting a technician's
    existing Taskln verification — this was an explicit decision, not
    just an unconfirmed safe default left over from Prompt 10."""
    trust_taskln_verification = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "taskln_integration_settings"

    @classmethod
    def current(cls):
        """Returns the single settings row, creating it with safe
        defaults if it doesn't exist yet — callers never need to worry
        about whether this has been configured."""
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class TasklnWorkerRecord(models.Model):
    """A READ-ONLY local cache of a Taskln worker's real-estate-relevant
    credentials — NOT Taskln's actual data. Since Taskln's own API
    doesn't exist yet, this table holds clearly-labeled MOCK/placeholder
    data so the 'look up a Taskln worker' integration point is real and
    testable now, without importing Taskln's token economy or community-
    vouching system, per Prompt 10's explicit instruction."""
    taskln_worker_id = models.CharField(max_length=100, unique=True)  # would be Taskln's own ID, once real
    display_name = models.CharField(max_length=200)
    verified_specialties = models.JSONField(default=list)  # subset expected to overlap with ServiceCategory
    taskln_verification_status = models.CharField(max_length=20, default="UNKNOWN")
    is_mock_data = models.BooleanField(default=True)  # always True until the real Taskln API is connected
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "taskln_worker_records"


class FacilityManagementFrequency(models.TextChoices):
    WEEKLY = "WEEKLY", "Weekly"
    MONTHLY = "MONTHLY", "Monthly"
    QUARTERLY = "QUARTERLY", "Quarterly"


class FacilityManagementContract(models.Model):
    """A recurring facility-management arrangement between a property
    owner and a technician or agency — docs/01 §2.4's
    'FacilityManagementContract (property, technician/agency, recurring
    schedule, scope)', previously modeled nowhere at all. Property is a
    polymorphic reference (target_content_type/target_id) using the same
    convention Booking/ActionLog already use elsewhere in this codebase,
    since a facility contract can cover any listed property type, not
    just one app's model."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="facility_contracts_owned")
    target_content_type = models.CharField(max_length=50)  # e.g. "property.PropertyAsset"
    target_id = models.UUIDField()
    technician = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="facility_contracts_as_technician",
    )
    agency = models.ForeignKey("identity.AgencyProfile", on_delete=models.SET_NULL, null=True, blank=True, related_name="facility_contracts")
    scope = models.TextField()
    frequency = models.CharField(max_length=10, choices=FacilityManagementFrequency.choices)
    start_date = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "facility_management_contracts"
        indexes = [models.Index(fields=["target_content_type", "target_id"])]


class FacilityVisitLog(models.Model):
    """The 'routine inspection logs' from Prompt 15's Technician
    Dashboard requirement — one row per actual visit under a contract,
    filed by whoever performed it."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    contract = models.ForeignKey(FacilityManagementContract, on_delete=models.CASCADE, related_name="visit_logs")
    logged_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="facility_visit_logs")
    notes = models.TextField(blank=True)
    photo_url = models.URLField(blank=True)
    visited_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "facility_visit_logs"
        indexes = [models.Index(fields=["contract", "-visited_at"])]


class ProjectCaseStatus(models.TextChoices):
    PLANNING = "PLANNING", "Planning"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    ON_HOLD = "ON_HOLD", "On Hold"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class ProjectManagementCase(models.Model):
    """A larger job — renovation, new build — with milestones, a
    budget, and linked technicians. docs/01 §2.4's
    'ProjectManagementCase', previously modeled nowhere at all. The
    property reference is OPTIONAL: a new build genuinely may not have
    an existing property record yet."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_cases_owned")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    budget_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(max_length=15, choices=ProjectCaseStatus.choices, default=ProjectCaseStatus.PLANNING)
    target_content_type = models.CharField(max_length=50, blank=True)
    target_id = models.UUIDField(null=True, blank=True)
    technicians = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="project_cases_assigned", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "project_management_cases"


class ProjectMilestoneStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    COMPLETED = "COMPLETED", "Completed"


class ProjectMilestone(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case = models.ForeignKey(ProjectManagementCase, on_delete=models.CASCADE, related_name="milestones")
    title = models.CharField(max_length=200)
    budget_allocation_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=15, choices=ProjectMilestoneStatus.choices, default=ProjectMilestoneStatus.PENDING)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "project_milestones"
        indexes = [models.Index(fields=["case"])]
