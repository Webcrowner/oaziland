"""
careers — Part D: real-estate/hospitality-adjacent job postings and
training programs, reusing the Event model (engagement app, Part C) for
scheduling rather than a second events system, and the
WhatsAppActionButton (Part B) for sharing postings.
"""
import uuid
from django.conf import settings
from django.db import models


class JobRoleCategory(models.TextChoices):
    PROPERTY_MANAGER = "PROPERTY_MANAGER", "Property Manager"
    AGENT = "AGENT", "Agent"
    HOSTEL_WARDEN = "HOSTEL_WARDEN", "Hostel Warden"
    MAINTENANCE_STAFF = "MAINTENANCE_STAFF", "Maintenance Staff"
    DRIVER = "DRIVER", "Driver"
    OTHER = "OTHER", "Other"


class JobPostingStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    CLOSED = "CLOSED", "Closed"


class JobPosting(models.Model):
    """Postable by Owners/Agencies/Institutions — deliberately just a
    plain User FK (posted_by) rather than a new polymorphic role, since
    'who can post a job' is already answered by the existing Role
    system (an AgencyProfile-holding User, an OwnerProfile-holding
    User, etc.) without needing a fourth ownership concept."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    posted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="job_postings")
    title = models.CharField(max_length=200)
    role_category = models.CharField(max_length=20, choices=JobRoleCategory.choices)
    description = models.TextField()
    quarter = models.ForeignKey("geo.Quarter", on_delete=models.SET_NULL, null=True, blank=True)
    salary_min_xaf = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    salary_max_xaf = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=10, choices=JobPostingStatus.choices, default=JobPostingStatus.OPEN)
    posted_at = models.DateTimeField(auto_now_add=True)
    closes_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "job_postings"
        indexes = [models.Index(fields=["status", "role_category"])]


class JobApplicationStatus(models.TextChoices):
    SUBMITTED = "SUBMITTED", "Submitted"
    REVIEWED = "REVIEWED", "Reviewed"
    SHORTLISTED = "SHORTLISTED", "Shortlisted"
    REJECTED = "REJECTED", "Rejected"
    HIRED = "HIRED", "Hired"


class JobApplication(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job_posting = models.ForeignKey(JobPosting, on_delete=models.CASCADE, related_name="applications")
    applicant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="job_applications")
    cover_message = models.TextField(blank=True)
    status = models.CharField(max_length=15, choices=JobApplicationStatus.choices, default=JobApplicationStatus.SUBMITTED)
    applied_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "job_applications"
        unique_together = [("job_posting", "applicant")]  # one application per person per posting


class TrainingCategory(models.TextChoices):
    PROPERTY_MANAGEMENT_BASICS = "PROPERTY_MANAGEMENT_BASICS", "Property Management Basics"
    TENANT_LAW = "TENANT_LAW", "Tenant Law"
    AGENCY_LICENSING_PREP = "AGENCY_LICENSING_PREP", "Agency Licensing Prep"
    HOSPITALITY_OPERATIONS = "HOSPITALITY_OPERATIONS", "Hospitality Operations"
    OTHER = "OTHER", "Other"


class TrainingProgram(models.Model):
    """event is OPTIONAL and reuses engagement.Event directly for
    scheduling — a training program IS a kind of event, so this
    composes with Part C's Event rather than duplicating start/end
    date fields here."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="training_programs_offered")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=30, choices=TrainingCategory.choices)
    event = models.ForeignKey("engagement.Event", on_delete=models.SET_NULL, null=True, blank=True, related_name="training_program")
    price_xaf = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # null = free
    issues_certification = models.BooleanField(default=False)

    class Meta:
        db_table = "training_programs"


class TrainingEnrollmentStatus(models.TextChoices):
    ENROLLED = "ENROLLED", "Enrolled"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    COMPLETED = "COMPLETED", "Completed"
    DROPPED = "DROPPED", "Dropped"


class TrainingEnrollment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(TrainingProgram, on_delete=models.CASCADE, related_name="enrollments")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="training_enrollments")
    status = models.CharField(max_length=15, choices=TrainingEnrollmentStatus.choices, default=TrainingEnrollmentStatus.ENROLLED)
    enrolled_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    certificate_issued_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "training_enrollments"
        unique_together = [("program", "student")]
