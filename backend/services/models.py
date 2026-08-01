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
    requested_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "service_requests"
        indexes = [models.Index(fields=["category", "status"])]


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
    code deployment. This is the OPEN QUESTION Prompt 10 explicitly asked
    to leave unresolved: does a technician already verified on Taskln
    arrive pre-verified on Oaziland, or does Oaziland always run its own
    separate KYC pass? Defaults to False (always re-verify) — the safer
    default until the founder explicitly decides otherwise."""
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
