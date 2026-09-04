"""
student_hostels — the priority hospitality module (Prompt 11), built on
a genuine multi-owner/multi-manager model: who OWNS a hostel and who
MANAGES it are different, independently-tracked roles, since the same
hostel is very often owned by one party and operated by another.
"""
import uuid
from django.conf import settings
from django.db import models
from property.models import Building, Unit


# ---------------------------------------------------------------------------
# Ownership & Management — the core concept this prompt is built around.
# ---------------------------------------------------------------------------
class OwnerType(models.TextChoices):
    INSTITUTION = "INSTITUTION", "Institution (School/University)"
    LANDLORD = "LANDLORD", "Private Landlord"
    ORGANIZATION = "ORGANIZATION", "Organization (Company/NGO/Cooperative/Religious Body)"
    GOVERNMENT = "GOVERNMENT", "Government / Public Entity"


class OwnerProfile(models.Model):
    """WHY one model with an owner_type flag rather than four separate
    classes: every owner type needs the exact same thing from the
    platform — to be identifiable, contactable, and to hold financial
    visibility over their hostels. What differs is only a display name
    and how they're described, not their behavior in the system."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_hostel_profiles",
    )  # for LANDLORD this IS the landlord; for other types, this is whoever administers the account
    owner_type = models.CharField(max_length=15, choices=OwnerType.choices)
    organization_name = models.CharField(max_length=200, blank=True)  # used for INSTITUTION/ORGANIZATION/GOVERNMENT

    class Meta:
        db_table = "hostel_owner_profiles"

    @property
    def display_name(self):
        if self.owner_type == OwnerType.LANDLORD:
            return self.account_user.full_name or self.account_user.username
        return self.organization_name or self.account_user.full_name


class ManagerType(models.TextChoices):
    OWNER_DIRECT = "OWNER_DIRECT", "Owner (Self-Managed)"
    STAFF = "STAFF", "In-House Staff"
    AGENT = "AGENT", "Independent Agent"
    AGENCY = "AGENCY", "Agency"


class ManagerProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hostel_manager_profiles",
    )
    manager_type = models.CharField(max_length=15, choices=ManagerType.choices)
    agency = models.ForeignKey(
        "identity.AgencyProfile", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="managed_hostels_as_agency",
    )  # set only when manager_type=AGENCY

    class Meta:
        db_table = "hostel_manager_profiles"


class PartnerInstitution(models.Model):
    """A school/university a hostel partners with. Many-to-many with
    StudentHostel below — a privately-owned hostel can serve students
    from several institutions at once, each potentially on a different
    academic calendar (see Semester)."""
    name = models.CharField(max_length=200, unique=True)

    class Meta:
        db_table = "partner_institutions"

    def __str__(self):
        return self.name


class HostelPropertyType(models.TextChoices):
    BLOCK = "BLOCK", "Block"
    SELF_CONTAIN_COMPOUND = "SELF_CONTAIN_COMPOUND", "Self-Contain Compound"
    STUDIO_COMPLEX = "STUDIO_COMPLEX", "Studio Complex"
    APARTMENT_BUILDING = "APARTMENT_BUILDING", "Apartment Building"
    MIXED = "MIXED", "Mixed"


class StudentHostel(Building):
    """WHY owner_profile is separate from the owner field inherited from
    PropertyAsset: PropertyAsset.owner is a plain User (the simple
    ownership model every other property type uses). StudentHostel needs
    the richer OwnerProfile (institution/landlord/organization/
    government) instead — owner_profile.account_user should always equal
    this hostel's inherited owner field; callers creating a StudentHostel
    are expected to set both consistently (see services.py's
    create_student_hostel helper, which does this for you)."""
    owner_profile = models.ForeignKey(OwnerProfile, on_delete=models.PROTECT, related_name="hostels")
    property_type = models.CharField(max_length=25, choices=HostelPropertyType.choices, default=HostelPropertyType.BLOCK)
    institution_partnerships = models.ManyToManyField(PartnerInstitution, blank=True, related_name="partner_hostels")

    class Meta:
        db_table = "student_hostels"

    @property
    def current_manager(self):
        """Reads the ACTIVE (not revoked, not expired) management
        contract rather than storing a manager FK directly on the
        hostel — this is what lets a hostel change managers over time
        while keeping the full history (see HostelManagementContract)."""
        from django.utils import timezone
        contract = self.management_contracts.filter(
            revoked_at__isnull=True,
        ).filter(
            models.Q(end_date__isnull=True) | models.Q(end_date__gte=timezone.now().date())
        ).order_by("-start_date").first()
        return contract.manager if contract else None


class ManagementScope(models.TextChoices):
    FULL = "FULL", "Full Management"
    BOOKINGS_ONLY = "BOOKINGS_ONLY", "Bookings Only"
    MAINTENANCE_ONLY = "MAINTENANCE_ONLY", "Maintenance Only"
    BILLING_ONLY = "BILLING_ONLY", "Billing Only"


class HostelManagementContract(models.Model):
    """Links a hostel to its manager, with a defined scope. WHY this is
    its own table rather than a manager FK on StudentHostel: a hostel
    changing managers must NOT lose the historical record of who managed
    it when — every past booking, bill, and welfare alert stays
    attributable to whoever was actually in charge at the time."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hostel = models.ForeignKey(StudentHostel, on_delete=models.CASCADE, related_name="management_contracts")
    manager = models.ForeignKey(ManagerProfile, on_delete=models.PROTECT, related_name="contracts")
    scope = models.CharField(max_length=20, choices=ManagementScope.choices, default=ManagementScope.FULL)
    commission_or_fee_terms = models.TextField(blank=True)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revocation_reason = models.TextField(blank=True)

    class Meta:
        db_table = "hostel_management_contracts"

    def revoke(self, reason: str = ""):
        from django.utils import timezone
        self.revoked_at = timezone.now()
        self.revocation_reason = reason
        self.save(update_fields=["revoked_at", "revocation_reason"])


class StaffRoleType(models.TextChoices):
    FRONT_DESK = "FRONT_DESK", "Front Desk"
    MAINTENANCE = "MAINTENANCE", "Maintenance"
    WARDEN = "WARDEN", "Warden"


class HostelStaffAssignment(models.Model):
    hostel = models.ForeignKey(StudentHostel, on_delete=models.CASCADE, related_name="staff_assignments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hostel_staff_roles")
    role_type = models.CharField(max_length=15, choices=StaffRoleType.choices)

    class Meta:
        db_table = "hostel_staff_assignments"
        unique_together = [("hostel", "user", "role_type")]


# ---------------------------------------------------------------------------
# Units, beds, semesters, and allocation.
# ---------------------------------------------------------------------------
class HostelUnitType(models.TextChoices):
    SHARED_ROOM = "SHARED_ROOM", "Shared Room"
    SELF_CONTAIN = "SELF_CONTAIN", "Self-Contain"
    STUDIO = "STUDIO", "Studio"
    ONE_BED_APARTMENT = "ONE_BED_APARTMENT", "One-Bed Apartment"
    MULTI_BED_APARTMENT = "MULTI_BED_APARTMENT", "Multi-Bed Apartment"
    POSTGRAD_UNIT = "POSTGRAD_UNIT", "Postgraduate Unit"
    INTERNATIONAL_UNIT = "INTERNATIONAL_UNIT", "International Student Unit"
    ENTIRE_BUILDING = "ENTIRE_BUILDING", "Entire Building (Bulk/Corporate Lease)"


class OccupancyModel(models.TextChoices):
    PER_BED = "PER_BED", "Per Bed"          # traditional shared hostel billing
    PER_UNIT = "PER_UNIT", "Per Unit"        # whole self-contain/studio/apartment billed as one


class AmenityTier(models.TextChoices):
    BASE = "BASE", "Base"
    FURNISHED = "FURNISHED", "Furnished"
    PREMIUM = "PREMIUM", "Premium"


class HostelUnit(Unit):
    unit_type = models.CharField(max_length=25, choices=HostelUnitType.choices)
    occupancy_model = models.CharField(max_length=10, choices=OccupancyModel.choices, default=OccupancyModel.PER_BED)
    amenity_tier = models.CharField(max_length=10, choices=AmenityTier.choices, default=AmenityTier.BASE)
    bed_capacity = models.PositiveSmallIntegerField(default=1)  # meaningful for SHARED_ROOM; 1 for per-unit types

    class Meta:
        db_table = "hostel_units"


class BedSlot(models.Model):
    """An addressable bed WITHIN a shared HostelUnit — this is what makes
    per-bed allocation possible (unit_type=SHARED_ROOM, occupancy_model=
    PER_BED can have up to bed_capacity separate RoomAllocations, one per
    bed). Per-unit types (studio, apartment) don't use this at all — see
    RoomAllocation.bed_slot being nullable."""
    unit = models.ForeignKey(HostelUnit, on_delete=models.CASCADE, related_name="bed_slots")
    bed_number = models.PositiveSmallIntegerField()

    class Meta:
        db_table = "bed_slots"
        unique_together = [("unit", "bed_number")]


class Semester(models.Model):
    """Institution-configurable — NOT hardcoded to one university's
    calendar. The same hostel can serve students from institutions with
    different semester dates simultaneously, since Semester references
    an institution rather than the hostel."""
    institution = models.ForeignKey(PartnerInstitution, on_delete=models.CASCADE, related_name="semesters")
    name = models.CharField(max_length=100)  # e.g. "2026/2027 First Semester"
    start_date = models.DateField()
    end_date = models.DateField()
    billing_due_date = models.DateField()

    class Meta:
        db_table = "semesters"


class RoomAllocationStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    ENDED = "ENDED", "Ended"
    CANCELLED = "CANCELLED", "Cancelled"


class RoomAllocation(models.Model):
    """WHY bed_slot is nullable: a per-unit allocation (a whole studio or
    apartment) has no individual bed to reference — the student(s) are
    allocated the ENTIRE unit. Only PER_BED allocations set bed_slot."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="room_allocations")
    unit = models.ForeignKey(HostelUnit, on_delete=models.CASCADE, related_name="allocations")
    bed_slot = models.ForeignKey(BedSlot, on_delete=models.SET_NULL, null=True, blank=True, related_name="allocations")
    semester = models.ForeignKey(Semester, on_delete=models.CASCADE, related_name="allocations")
    status = models.CharField(max_length=10, choices=RoomAllocationStatus.choices, default=RoomAllocationStatus.ACTIVE)
    allocated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "room_allocations"
        # A given bed, in a given semester, can only be allocated to one
        # student at a time — the actual mechanical prevention of a
        # double-booked bed.
        unique_together = [("bed_slot", "semester")]


class Waitlist(models.Model):
    """'Join a waitlist, get auto-notified or auto-allocated when a
    matching unit frees up' — Prompt 11's explicit modern-feature
    request. Uses the SAME priority ordering as RoomAllocation
    (see student_hostels/services.py's allocation scoring)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hostel_waitlist_entries")
    desired_unit_type = models.CharField(max_length=25, choices=HostelUnitType.choices)
    semester = models.ForeignKey(Semester, on_delete=models.CASCADE, related_name="waitlist_entries")
    hostel = models.ForeignKey(StudentHostel, on_delete=models.CASCADE, related_name="waitlist_entries")
    joined_at = models.DateTimeField(auto_now_add=True)
    fulfilled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "hostel_waitlist"


class SleepSchedule(models.TextChoices):
    EARLY_BIRD = "EARLY_BIRD", "Early Bird"
    NIGHT_OWL = "NIGHT_OWL", "Night Owl"
    FLEXIBLE = "FLEXIBLE", "Flexible"


class CleanlinessLevel(models.TextChoices):
    VERY_TIDY = "VERY_TIDY", "Very Tidy"
    MODERATE = "MODERATE", "Moderate"
    RELAXED = "RELAXED", "Relaxed"


class NoiseTolerance(models.TextChoices):
    QUIET_PREFERRED = "QUIET_PREFERRED", "Prefers Quiet"
    MODERATE = "MODERATE", "Moderate"
    TOLERANT = "TOLERANT", "Tolerant of Noise"


class StudyHabit(models.TextChoices):
    IN_ROOM = "IN_ROOM", "Studies in Room"
    LIBRARY_ONLY = "LIBRARY_ONLY", "Library/Study Hall Only"
    MIXED = "MIXED", "Mixed"


class RoommatePreferenceProfile(models.Model):
    """WHY this is a SEPARATE model from identity.StudentProfile: these
    fields exist for ONE purpose — roommate compatibility scoring — and
    are meaningfully different in kind from StudentProfile's allocation-
    priority fields (accessibility, international status, programme
    year). Keeping them apart means a change to matching criteria never
    touches the core student profile."""
    student = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="roommate_preferences")
    sleep_schedule = models.CharField(max_length=15, choices=SleepSchedule.choices, default=SleepSchedule.FLEXIBLE)
    cleanliness_level = models.CharField(max_length=15, choices=CleanlinessLevel.choices, default=CleanlinessLevel.MODERATE)
    noise_tolerance = models.CharField(max_length=20, choices=NoiseTolerance.choices, default=NoiseTolerance.MODERATE)
    study_habit = models.CharField(max_length=15, choices=StudyHabit.choices, default=StudyHabit.MIXED)

    class Meta:
        db_table = "roommate_preference_profiles"


class RoomSwapStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    MATCHED = "MATCHED", "Matched"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class RoomSwapRequest(models.Model):
    """The mid-semester room swap marketplace — a student in an
    existing allocation posts a desire to swap; matched_with links to
    the OTHER student's swap request once a mutual match is found."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    current_allocation = models.ForeignKey(RoomAllocation, on_delete=models.CASCADE, related_name="swap_requests")
    desired_unit_type = models.CharField(max_length=25, choices=HostelUnitType.choices, null=True, blank=True)
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=RoomSwapStatus.choices, default=RoomSwapStatus.OPEN)
    matched_with = models.OneToOneField("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="matched_by")
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "room_swap_requests"


class GuestPass(models.Model):
    """Guest visitor logging with security tracking — the founder's
    'guest pass system with security logging' amenity, built as a real
    dedicated model since it needs actual entry/exit tracking, not just
    a subscription record."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    host_student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="guest_passes_issued")
    guest_full_name = models.CharField(max_length=200)
    guest_id_document_note = models.CharField(max_length=100, blank=True)  # e.g. "National ID ****4821" — never the full number, per the founder's own privacy preference on receipts
    visit_date = models.DateField()
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    logged_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="guest_passes_logged")

    class Meta:
        db_table = "guest_passes"


# ---------------------------------------------------------------------------
# Billing & amenities.
# ---------------------------------------------------------------------------
class BillingCycle(models.TextChoices):
    """WHY this many options: a traditional shared room bills per
    semester; a self-contain/studio might be leased to a non-student
    tenant on a monthly or custom cycle; and — per the founder's explicit
    addition — a landlord/owner may instead structure the arrangement as
    a 6-month term, a 12-month term, or a straight deposit."""
    SEMESTER = "SEMESTER", "Per Semester"
    MONTHLY = "MONTHLY", "Monthly"
    SIX_MONTHS = "SIX_MONTHS", "6 Months"
    TWELVE_MONTHS = "TWELVE_MONTHS", "12 Months"
    DEPOSIT = "DEPOSIT", "Deposit"
    CUSTOM = "CUSTOM", "Custom"


class HostelBillingStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    PAID = "PAID", "Paid"
    OVERDUE = "OVERDUE", "Overdue"
    WAIVED = "WAIVED", "Waived"


class HostelBilling(models.Model):
    """Linked to a RoomAllocation for student billing, OR directly to a
    HostelUnit for non-student/corporate-lease billing that doesn't go
    through the student allocation flow at all — exactly one of the two
    should be set, enforced in application code (see services.py)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    allocation = models.ForeignKey(RoomAllocation, on_delete=models.CASCADE, null=True, blank=True, related_name="bills")
    unit = models.ForeignKey(HostelUnit, on_delete=models.CASCADE, null=True, blank=True, related_name="direct_bills")
    billing_cycle = models.CharField(max_length=15, choices=BillingCycle.choices)
    amount_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField()
    status = models.CharField(max_length=10, choices=HostelBillingStatus.choices, default=HostelBillingStatus.PENDING)
    booking = models.OneToOneField("transactions.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="hostel_bill")

    class Meta:
        db_table = "hostel_billing"


class InstallmentPlan(models.Model):
    """Splits ONE HostelBilling total into several smaller payments
    across the term — the catalogue document's 'installment payment
    plans split across the term'. The parent HostelBilling.amount_xaf
    remains the source of truth for the total; this just breaks it into
    a payment schedule."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    billing = models.OneToOneField(HostelBilling, on_delete=models.CASCADE, related_name="installment_plan")
    num_installments = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "installment_plans"


class InstallmentPaymentStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    PAID = "PAID", "Paid"
    OVERDUE = "OVERDUE", "Overdue"


class InstallmentPayment(models.Model):
    plan = models.ForeignKey(InstallmentPlan, on_delete=models.CASCADE, related_name="installments")
    sequence_number = models.PositiveSmallIntegerField()  # 1, 2, 3...
    amount_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField()
    status = models.CharField(max_length=10, choices=InstallmentPaymentStatus.choices, default=InstallmentPaymentStatus.PENDING)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "installment_payments"
        unique_together = [("plan", "sequence_number")]
        ordering = ["sequence_number"]


class AmenityType(models.TextChoices):
    LAUNDRY = "LAUNDRY", "Laundry"
    CAFETERIA = "CAFETERIA", "Cafeteria / Meal Plan"
    SHUTTLE = "SHUTTLE", "Shuttle / Transport"
    GYM = "GYM", "Gym / Wellness"
    STUDY_LOUNGE = "STUDY_LOUNGE", "Study Lounge Access"
    WIFI_PREMIUM = "WIFI_PREMIUM", "High-Speed Wi-Fi"
    CLEANING = "CLEANING", "Cleaning Service"
    SECURITY_CONCIERGE = "SECURITY_CONCIERGE", "Security / Concierge"


class AmenitySubscriptionStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    PAUSED = "PAUSED", "Paused"
    CANCELLED = "CANCELLED", "Cancelled"


class AmenitySubscription(models.Model):
    """Deliberately decoupled from HostelBilling — its own billing cycle,
    its own status, so pausing or cancelling laundry service never
    touches core room billing at all."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subscriber = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name="amenity_subscriptions")
    hostel = models.ForeignKey(StudentHostel, on_delete=models.CASCADE, null=True, blank=True, related_name="property_amenity_subscriptions")
    amenity_type = models.CharField(max_length=25, choices=AmenityType.choices)
    billing_cycle = models.CharField(max_length=15, choices=BillingCycle.choices, default=BillingCycle.MONTHLY)
    price_xaf = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=10, choices=AmenitySubscriptionStatus.choices, default=AmenitySubscriptionStatus.ACTIVE)
    started_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "amenity_subscriptions"

    def cancel(self):
        from django.utils import timezone
        self.status = AmenitySubscriptionStatus.CANCELLED
        self.cancelled_at = timezone.now()
        self.save(update_fields=["status", "cancelled_at"])


# ---------------------------------------------------------------------------
# Parent/guardian access & welfare — the strict read-only boundary.
# ---------------------------------------------------------------------------
class ParentGuardianAccess(models.Model):
    """Consent-gated. WHY consent lives HERE (on the access grant) rather
    than as a flag on the student: it's the STUDENT granting a specific
    parent visibility, which can be revoked — modeling it as a
    relationship with its own consent timestamp makes both the grant and
    any future revocation explicit and auditable."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    parent_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="guardian_access_grants")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="guardian_accesses")
    consented_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    also_notify_institution = models.BooleanField(default=False)  # separate consent for WelfareAlert routing to the institution

    class Meta:
        db_table = "parent_guardian_access"
        unique_together = [("parent_user", "student")]

    @property
    def is_active(self):
        return self.revoked_at is None

    def revoke(self):
        from django.utils import timezone
        self.revoked_at = timezone.now()
        self.save(update_fields=["revoked_at"])


class WelfareAlertReason(models.TextChoices):
    PAYMENT_DISTRESS = "PAYMENT_DISTRESS", "Payment Distress"
    PROLONGED_ABSENCE = "PROLONGED_ABSENCE", "Prolonged Absence"
    SAFETY_RISK = "SAFETY_RISK", "Safety Risk"
    BEHAVIOURAL_CONCERN = "BEHAVIOURAL_CONCERN", "Behavioural Concern"
    MEDICAL_INCIDENT = "MEDICAL_INCIDENT", "Medical Incident"
    ROOMMATE_CONFLICT = "ROOMMATE_CONFLICT", "Roommate Conflict"


class WelfareAlert(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="welfare_alerts")
    reason = models.CharField(max_length=25, choices=WelfareAlertReason.choices)
    details = models.TextField(blank=True)
    raised_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="welfare_alerts_raised")
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "welfare_alerts"


# ---------------------------------------------------------------------------
# Modern features: digital access logging, maintenance, and reviews.
# ---------------------------------------------------------------------------
class AccessType(models.TextChoices):
    ENTRY = "ENTRY", "Entry"
    EXIT = "EXIT", "Exit"


class AccessMethod(models.TextChoices):
    QR = "QR", "QR Code"
    NFC = "NFC", "NFC"


class RoomAccessLog(models.Model):
    """Digital check-in/check-out logging — viewable by management for
    SECURITY purposes only (enforced in services.py, not here — a model
    can't enforce who's allowed to query it, only store the data
    correctly)."""
    unit = models.ForeignKey(HostelUnit, on_delete=models.CASCADE, related_name="access_logs")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hostel_access_logs")
    access_type = models.CharField(max_length=10, choices=AccessType.choices)
    method = models.CharField(max_length=5, choices=AccessMethod.choices)
    logged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "room_access_logs"
        indexes = [models.Index(fields=["unit", "-logged_at"])]


class MaintenanceRequestStatus(models.TextChoices):
    REPORTED = "REPORTED", "Reported"
    ASSIGNED = "ASSIGNED", "Assigned"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    RESOLVED = "RESOLVED", "Resolved"


class MaintenanceRequest(models.Model):
    """Deliberately separate from services.ServiceRequest (the Taskln-
    scoped technician marketplace, Prompt 10): this is INTERNAL hostel
    operations — a warden or staff member handling a leaking tap, not
    necessarily a marketplace booking with a paid technician. The two
    CAN connect (a MaintenanceRequest could later spawn a
    ServiceRequest), but they're not the same concept."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey(HostelUnit, on_delete=models.CASCADE, related_name="maintenance_requests")
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hostel_maintenance_reports")
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="hostel_maintenance_assigned")
    description = models.TextField()
    status = models.CharField(max_length=15, choices=MaintenanceRequestStatus.choices, default=MaintenanceRequestStatus.REPORTED)
    sla_deadline = models.DateTimeField(null=True, blank=True)  # set per the manager's contract terms
    reported_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "hostel_maintenance_requests"


class MaintenanceRequestMedia(models.Model):
    request = models.ForeignKey(MaintenanceRequest, on_delete=models.CASCADE, related_name="media")
    file_url = models.URLField()

    class Meta:
        db_table = "hostel_maintenance_media"


class HostelReview(models.Model):
    """Scoped per UNIT TYPE and per MANAGER — deliberately not a single
    rating on the hostel as a whole, since a shared room and a premium
    studio in the same building are different products, and a review of
    the current Agency's responsiveness shouldn't get diluted by a
    previous, different manager's performance."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hostel_reviews")
    hostel = models.ForeignKey(StudentHostel, on_delete=models.CASCADE, related_name="reviews")
    unit_type = models.CharField(max_length=25, choices=HostelUnitType.choices)
    manager = models.ForeignKey(ManagerProfile, on_delete=models.SET_NULL, null=True, related_name="reviews_received")
    score = models.PositiveSmallIntegerField()  # 1-5
    text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hostel_reviews"
