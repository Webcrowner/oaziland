"""
property_management — post-booking landlord/agency tools and agent
field-safety tools (Prompt 14).

Deliberately separate from services.ServiceRequest (Prompt 10, the
Taskln-scoped paid technician marketplace) and from student_hostels.
MaintenanceRequest (hostel-unit-specific): this MaintenanceRequest is
the general, property-wide ongoing maintenance LOG a landlord or agency
keeps — not every maintenance entry becomes a paid marketplace booking.
"""
import uuid
from django.conf import settings
from django.db import models


class MaintenanceCategory(models.TextChoices):
    ROUTINE = "ROUTINE", "Routine"
    EMERGENCY = "EMERGENCY", "Emergency"


class MaintenanceStatus(models.TextChoices):
    REPORTED = "REPORTED", "Reported"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    RESOLVED = "RESOLVED", "Resolved"
    CLOSED = "CLOSED", "Closed"


class MaintenanceRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property_asset = models.ForeignKey("property.PropertyAsset", on_delete=models.CASCADE, related_name="maintenance_requests")
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="maintenance_requests_filed")
    category = models.CharField(max_length=10, choices=MaintenanceCategory.choices)
    description = models.TextField()
    cost_estimate_xaf = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=15, choices=MaintenanceStatus.choices, default=MaintenanceStatus.REPORTED)
    reported_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "property_maintenance_requests"

    def close(self):
        from django.utils import timezone
        self.status = MaintenanceStatus.CLOSED
        self.resolved_at = self.resolved_at or timezone.now()
        self.save(update_fields=["status", "resolved_at"])


class MaintenanceCostEntry(models.Model):
    """The 'cost_history' log — a running record of every cost added to
    a request over time, rather than a single number silently
    overwritten as a job's real cost becomes clearer."""
    request = models.ForeignKey(MaintenanceRequest, on_delete=models.CASCADE, related_name="cost_entries")
    amount_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=255, blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "maintenance_cost_entries"


class Lease(models.Model):
    """A defined rental term wrapping a completed Booking — kept
    separate from Booking itself (rather than adding start/end dates
    directly to it) since a lease term only applies to CONFIRMED/
    COMPLETED rental bookings, not a land sale or a one-off service
    payment."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.OneToOneField("transactions.Booking", on_delete=models.CASCADE, related_name="lease")
    start_date = models.DateField()
    end_date = models.DateField()

    class Meta:
        db_table = "leases"


class LeaseRenewalReminder(models.Model):
    """One row per reminder MILESTONE (60/30/7 days out) per lease —
    proves all three reminders were actually sent, not just the most
    recent one."""
    lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name="renewal_reminders")
    days_before_end = models.PositiveSmallIntegerField()
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "lease_renewal_reminders"
        unique_together = [("lease", "days_before_end")]


class TenantScreeningStatus(models.TextChoices):
    PENDING_CONSENT = "PENDING_CONSENT", "Pending Tenant Consent"
    CONSENTED = "CONSENTED", "Consented"
    DENIED = "DENIED", "Denied"
    COMPLETED = "COMPLETED", "Completed"


class TenantScreeningRequest(models.Model):
    """Consent is a real STATE TRANSITION the tenant themselves must
    trigger — a landlord being able to mark their own request
    'consented' would defeat the entire point of asking permission."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    landlord = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tenant_screenings_requested")
    prospective_tenant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tenant_screenings_about_me")
    status = models.CharField(max_length=20, choices=TenantScreeningStatus.choices, default=TenantScreeningStatus.PENDING_CONSENT)
    report_summary = models.JSONField(null=True, blank=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    consented_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "tenant_screening_requests"


class CheckInStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    CHECKED_OUT = "CHECKED_OUT", "Checked Out"
    ALERT_TRIGGERED = "ALERT_TRIGGERED", "Alert Triggered"


class AgentSafetyCheckIn(models.Model):
    """expected_checkout_at is required up front, not recorded after the
    fact — detecting an OVERDUE check-in is only possible if the system
    knows in advance when to expect a check-out."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agent = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="safety_check_ins")
    property_asset = models.ForeignKey("property.PropertyAsset", on_delete=models.SET_NULL, null=True, related_name="agent_check_ins")
    emergency_contact_name = models.CharField(max_length=200)
    emergency_contact_phone = models.CharField(max_length=20)
    started_at = models.DateTimeField(auto_now_add=True)
    expected_checkout_at = models.DateTimeField()
    checked_out_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=CheckInStatus.choices, default=CheckInStatus.ACTIVE)

    class Meta:
        db_table = "agent_safety_check_ins"
        indexes = [models.Index(fields=["status", "expected_checkout_at"])]


class DisputeStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    ADMIN_RESPONDED = "ADMIN_RESPONDED", "Admin Responded"
    RESOLVED = "RESOLVED", "Resolved"
    ESCALATED = "ESCALATED", "Escalated"


class DisputeCase(models.Model):
    """Attaches to a disputed PaymentEscrow. EscrowStatus.DISPUTED
    already existed as a status value before this prompt — nothing
    previously created a DisputeCase when it was set; that's the actual
    gap this closes.

    WHY created_at is a plain field, not auto_now_add: the SLA deadlines
    (response_due_at, resolution_due_at) must be computed from the EXACT
    SAME timestamp as created_at. auto_now_add fires at save() time,
    microseconds after any 'now' captured earlier in Python — that tiny
    gap was enough to make a 7-day SLA compute as 6 days.days in testing.
    Passing created_at explicitly from the service function that also
    computes the due dates keeps all three timestamps consistent."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    escrow = models.OneToOneField("transactions.PaymentEscrow", on_delete=models.CASCADE, related_name="dispute_case")
    raised_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="disputes_raised")
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=DisputeStatus.choices, default=DisputeStatus.OPEN)
    created_at = models.DateTimeField()
    response_due_at = models.DateTimeField()
    resolution_due_at = models.DateTimeField()
    admin_responded_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_notes = models.TextField(blank=True)

    class Meta:
        db_table = "dispute_cases"
