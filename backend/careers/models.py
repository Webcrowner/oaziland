"""
careers — Part D: real-estate/hospitality-adjacent job postings and
training programs, reusing the Event model (engagement app, Part C) for
scheduling rather than a second events system, and the
WhatsAppActionButton (Part B) for sharing postings.
"""
import uuid
from decimal import Decimal

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


def private_storage():
    """Learner submissions are personal documents: kept outside MEDIA_ROOT
    so they're never served as a public static URL — only through the
    permission-checked download endpoints."""
    return FileSystemStorage(location=settings.BASE_DIR / "private_media")


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
    date fields here.

    A program with no modules is a legacy "simple" course (enroll, then
    self-report completion). A program with modules/lessons is a full
    Coursera-style course: completion is earned through lessons/quizzes."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="training_programs_offered")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=30, choices=TrainingCategory.choices)
    event = models.ForeignKey("engagement.Event", on_delete=models.SET_NULL, null=True, blank=True, related_name="training_program")
    price_xaf = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # null = free
    issues_certification = models.BooleanField(default=False)
    is_published = models.BooleanField(default=True)  # drafts are visible only to admins and course staff
    # Shown on the catalogue card and course page; uploaded by an admin or the course's lecturer.
    cover_image = models.ImageField(upload_to="course_covers/", blank=True)
    # The certificate design for this course; null = the platform's default template (see certificate_templates).
    certificate_template = models.ForeignKey(
        "CertificateTemplate", on_delete=models.SET_NULL, null=True, blank=True, related_name="courses",
    )
    # Set when a trainer without publishing rights asks an admin to review and publish their draft.
    review_requested_at = models.DateTimeField(null=True, blank=True)
    # Shown on the course page and printed on certificates ({course_hours}); null = not stated.
    duration_hours = models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0.5")), MaxValueValidator(Decimal("9999"))],
    )
    # How long a certificate stays valid after it's issued ({expiry_date}); null = it never expires.
    certificate_validity_months = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(240)],
    )

    class Meta:
        db_table = "training_programs"


class CourseStaffRole(models.TextChoices):
    LECTURER = "LECTURER", "Lecturer"      # edits the course content
    SUPERVISOR = "SUPERVISOR", "Supervisor"  # tracks learners, reviews quiz results and PDFs


class CourseStaff(models.Model):
    program = models.ForeignKey(TrainingProgram, on_delete=models.CASCADE, related_name="staff")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="course_staff_roles")
    role = models.CharField(max_length=15, choices=CourseStaffRole.choices)
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "course_staff"
        unique_together = [("program", "user")]  # one role per person per course


class CourseModule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(TrainingProgram, on_delete=models.CASCADE, related_name="modules")
    title = models.CharField(max_length=200)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "course_modules"
        ordering = ["position", "title"]


class LessonKind(models.TextChoices):
    TEXT = "TEXT", "Reading"
    VIDEO = "VIDEO", "Video"
    PDF = "PDF", "PDF document"
    QUIZ = "QUIZ", "Quiz"
    ASSIGNMENT = "ASSIGNMENT", "PDF assignment"  # learner uploads a PDF; a lecturer/supervisor approves it


class Lesson(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    module = models.ForeignKey(CourseModule, on_delete=models.CASCADE, related_name="lessons")
    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=10, choices=LessonKind.choices, default=LessonKind.TEXT)
    position = models.PositiveIntegerField(default=0)
    content_text = models.TextField(blank=True)
    video_url = models.URLField(blank=True, max_length=500)  # external link (YouTube, Vimeo, direct file)
    # Uploaded lesson files are private: served only through careers.course_media's signed, access-checked links.
    video_file = models.FileField(upload_to="course_videos/", blank=True, storage=private_storage)  # or a video uploaded by staff
    pdf_file = models.FileField(upload_to="course_pdfs/", blank=True, storage=private_storage)
    pass_mark_percent = models.PositiveSmallIntegerField(default=70)  # quizzes only

    class Meta:
        db_table = "course_lessons"
        ordering = ["position", "title"]


class QuizQuestion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="questions")
    text = models.TextField()
    explanation = models.TextField(blank=True)  # shown after submitting
    position = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "course_quiz_questions"
        ordering = ["position"]


class QuizChoice(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question = models.ForeignKey(QuizQuestion, on_delete=models.CASCADE, related_name="choices")
    text = models.CharField(max_length=500)
    is_correct = models.BooleanField(default=False)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "course_quiz_choices"
        ordering = ["position"]


class TrainingEnrollmentStatus(models.TextChoices):
    PAYMENT_PENDING = "PAYMENT_PENDING", "Awaiting payment"
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
    # Public, unguessable ID printed on the certificate; anyone can check it at /certificates/<code>.
    certificate_code = models.CharField(max_length=20, unique=True, null=True, blank=True)
    # The design frozen when the certificate was issued, so later template edits or reassignments don't change it.
    certificate_design = models.ForeignKey(
        "CertificateDesign", on_delete=models.PROTECT, null=True, blank=True, related_name="certificates",
    )
    # Fixed when the certificate is issued, like its design: the course's hours, the learner's final grade (average of
    # their best score on each quiz; null without quizzes) and the expiry date (null = never expires).
    certificate_hours = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    certificate_grade_percent = models.PositiveSmallIntegerField(null=True, blank=True)
    certificate_expires_at = models.DateTimeField(null=True, blank=True)
    # When the learner was last nudged to come back (see send_course_reminders), so reminders stay spaced out.
    last_reminded_at = models.DateTimeField(null=True, blank=True)
    # A paid course's fee: held in escrow from payment until the learner completes the course, then paid to the provider.
    booking = models.OneToOneField(
        "transactions.Booking", on_delete=models.PROTECT, null=True, blank=True, related_name="training_enrollment",
    )

    class Meta:
        db_table = "training_enrollments"
        unique_together = [("program", "student")]

    @property
    def owner(self):
        """Who is paid for this enrollment (transactions.services.resolve_target_owner reads `owner`)."""
        return self.program.provider

    @property
    def is_paid(self) -> bool:
        from transactions.models import EscrowStatus
        escrow = getattr(self.booking, "escrow", None) if self.booking_id else None
        return escrow is not None and escrow.status != EscrowStatus.REFUNDED


class SubmissionStatus(models.TextChoices):
    SUBMITTED = "SUBMITTED", "Awaiting review"
    APPROVED = "APPROVED", "Approved"
    CHANGES_REQUESTED = "CHANGES_REQUESTED", "Changes requested"


class CourseReview(models.Model):
    """A learner's star rating and comment on a course; one per enrollment, editable. Only learners who have
    actually started the course (or finished it) can write one — see course_reviews.why_cannot_review."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(TrainingProgram, on_delete=models.CASCADE, related_name="reviews")
    enrollment = models.OneToOneField(TrainingEnrollment, on_delete=models.CASCADE, related_name="review")
    score = models.PositiveSmallIntegerField()  # 1-5
    text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "course_reviews"
        ordering = ["-updated_at"]


class AssignmentSubmission(models.Model):
    """One row per learner per assignment; resubmitting after
    'changes requested' replaces the file and goes back to review."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    enrollment = models.ForeignKey(TrainingEnrollment, on_delete=models.CASCADE, related_name="submissions")
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="submissions")
    file = models.FileField(upload_to="course_submissions/", storage=private_storage)
    status = models.CharField(max_length=20, choices=SubmissionStatus.choices, default=SubmissionStatus.SUBMITTED)
    feedback = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "course_assignment_submissions"
        unique_together = [("enrollment", "lesson")]
        ordering = ["-submitted_at"]


class LessonProgress(models.Model):
    enrollment = models.ForeignKey(TrainingEnrollment, on_delete=models.CASCADE, related_name="lesson_progress")
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="progress")
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "course_lesson_progress"
        unique_together = [("enrollment", "lesson")]


class QuizAttempt(models.Model):
    """answers maps question id -> list of selected choice ids, kept so a
    supervisor can review exactly what the learner answered."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    enrollment = models.ForeignKey(TrainingEnrollment, on_delete=models.CASCADE, related_name="quiz_attempts")
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="attempts")
    score_percent = models.PositiveSmallIntegerField()
    passed = models.BooleanField()
    answers = models.JSONField(default=dict)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "course_quiz_attempts"
        ordering = ["-submitted_at"]


class CourseDiscussionPost(models.Model):
    """The course's Q&A forum. A post without a parent starts a thread (it has a title); replies point at the thread.
    Only enrolled learners and course staff can read or post — see careers.course_discussions."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(TrainingProgram, on_delete=models.CASCADE, related_name="discussion_posts")
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name="replies")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="course_posts")
    lesson = models.ForeignKey(Lesson, on_delete=models.SET_NULL, null=True, blank=True, related_name="discussion_posts")
    title = models.CharField(max_length=200, blank=True)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    # Bumped by every reply, so the thread list can show the most recently active threads first.
    last_activity_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "course_discussion_posts"
        indexes = [models.Index(fields=["program", "parent", "-last_activity_at"])]


class TrainerProfile(models.Model):
    """What learners see about a trainer on their public page (/trainers/<id>); the photo and name come from the
    user's account. Created the first time the trainer saves it."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trainer_profile")
    headline = models.CharField(max_length=160, blank=True)  # e.g. "Property lawyer, 12 years in Douala"
    bio = models.TextField(blank=True)
    website = models.URLField(blank=True, max_length=300)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "trainer_profiles"


class CourseCreatorAccess(models.Model):
    """Granted by an admin: the user may create their own courses (and becomes their provider, paid for them).
    With can_publish they put courses live themselves; otherwise an admin reviews and publishes each one."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="course_creator_access")
    can_publish = models.BooleanField(default=True)
    granted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    granted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "course_creator_access"


class CertificateOrientation(models.TextChoices):
    LANDSCAPE = "LANDSCAPE", "Landscape"
    PORTRAIT = "PORTRAIT", "Portrait"


class CertificateTemplate(models.Model):
    """An admin-designed certificate: an optional uploaded background (a blank certificate design), a logo and a
    list of positioned elements (texts with {placeholders}, logo, QR code, lines, frames) — see
    careers.certificate_templates. The single active template is used for every certificate the system issues;
    with none active, the built-in design is used. Issuing a certificate freezes the design (CertificateDesign), so
    editing or reassigning a template only affects certificates issued afterwards."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    orientation = models.CharField(max_length=10, choices=CertificateOrientation.choices, default=CertificateOrientation.LANDSCAPE)
    background_color = models.CharField(max_length=7, default="#FFFDF7")
    background_image = models.ImageField(upload_to="certificate_templates/", blank=True)
    logo = models.ImageField(upload_to="certificate_templates/", blank=True)  # blank = the Oaziland logo
    signature = models.ImageField(upload_to="certificate_templates/", blank=True)  # drawn in the designer or uploaded
    layout = models.JSONField(default=list)
    is_active = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "certificate_templates"
        ordering = ["-is_active", "-updated_at"]
        constraints = [
            models.UniqueConstraint(fields=["is_active"], condition=models.Q(is_active=True), name="one_active_certificate_template"),
        ]


class CertificateDesign(models.Model):
    """An immutable snapshot of a certificate design (a template, or the built-in design) taken when a certificate
    is issued, with its own copies of the background and logo files. Identical designs share one row (fingerprint).
    Has the same design fields as CertificateTemplate, so certificate_templates.render() draws either."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fingerprint = models.CharField(max_length=64, unique=True)
    source_template = models.ForeignKey(CertificateTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name="designs")
    source_name = models.CharField(max_length=120, blank=True)  # blank = the built-in design
    orientation = models.CharField(max_length=10, choices=CertificateOrientation.choices, default=CertificateOrientation.LANDSCAPE)
    background_color = models.CharField(max_length=7, default="#FFFDF7")
    background_image = models.ImageField(upload_to="certificate_designs/", blank=True)
    logo = models.ImageField(upload_to="certificate_designs/", blank=True)  # blank = the Oaziland logo
    signature = models.ImageField(upload_to="certificate_designs/", blank=True)
    layout = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "certificate_designs"
