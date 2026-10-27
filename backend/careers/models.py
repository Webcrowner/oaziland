"""
careers — Part D: real-estate/hospitality-adjacent job postings and
training programs, reusing the Event model (engagement app, Part C) for
scheduling rather than a second events system, and the
WhatsAppActionButton (Part B) for sharing postings.
"""
import uuid
from django.conf import settings
from django.core.files.storage import FileSystemStorage
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
    video_file = models.FileField(upload_to="course_videos/", blank=True)  # or a video uploaded by staff
    pdf_file = models.FileField(upload_to="course_pdfs/", blank=True)
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


class SubmissionStatus(models.TextChoices):
    SUBMITTED = "SUBMITTED", "Awaiting review"
    APPROVED = "APPROVED", "Approved"
    CHANGES_REQUESTED = "CHANGES_REQUESTED", "Changes requested"


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
