"""
careers.services — job posting/application lifecycle and training
enrollment/completion, reusing engagement.build_whatsapp_action() for
sharing rather than a separate share mechanism.
"""


class AlreadyAppliedError(Exception):
    pass


def apply_to_job(*, job_posting, applicant, cover_message: str = ""):
    """WHY this checks first rather than letting the real
    unique_together constraint raise a raw IntegrityError: the same
    class of bug already found and fixed for training enrollment
    (AlreadyEnrolledError) — a real person re-applying to a job they
    already applied to should see a clean, specific message, not an
    uncaught 500."""
    from .models import JobApplication

    if JobApplication.objects.filter(job_posting=job_posting, applicant=applicant).exists():
        raise AlreadyAppliedError("You have already applied to this job posting.")
    return JobApplication.objects.create(job_posting=job_posting, applicant=applicant, cover_message=cover_message)


def update_application_status(*, application, new_status: str):
    application.status = new_status
    application.save(update_fields=["status"])
    return application


def share_job_posting_via_whatsapp(*, job_posting, shared_by, recipient_phone: str):
    """Reuses Part B's build_whatsapp_action() exactly as the spec
    requires ('reuse of the WhatsAppActionButton from Part B') — no
    separate sharing mechanism for job postings."""
    from engagement.services import build_whatsapp_action
    from engagement.models import WhatsAppContext

    return build_whatsapp_action(
        context=WhatsAppContext.SHARE_JOB_POSTING, triggered_by=shared_by, target_object=job_posting,
        recipient_phone=recipient_phone, template_vars={"job_title": job_posting.title},
    )


# ---------------------------------------------------------------------------
# Training/course enrollment.
# ---------------------------------------------------------------------------
class AlreadyEnrolledError(Exception):
    pass


def enroll_in_training(*, program, student):
    """unique_together on (program, student) already prevents a
    duplicate row at the database level — this turns that into a
    clear, catchable error instead of a raw IntegrityError reaching
    an API caller. (This upgrades the original version of this
    function, which let that IntegrityError propagate raw.)"""
    from django.db import IntegrityError
    from .models import TrainingEnrollment

    try:
        return TrainingEnrollment.objects.create(program=program, student=student)
    except IntegrityError:
        raise AlreadyEnrolledError("This student is already enrolled in this program.")


def mark_training_in_progress(enrollment):
    from .models import TrainingEnrollmentStatus
    enrollment.status = TrainingEnrollmentStatus.IN_PROGRESS
    enrollment.save(update_fields=["status"])
    return enrollment


def mark_training_completed(enrollment):
    """Issues a certificate automatically ONLY if the program actually
    offers one — completion and certification are tracked as distinct
    events, since a program might complete without ever having promised
    a certificate."""
    from django.utils import timezone
    from .models import TrainingEnrollmentStatus

    enrollment.status = TrainingEnrollmentStatus.COMPLETED
    enrollment.completed_at = timezone.now()
    if enrollment.program.issues_certification:
        enrollment.certificate_issued_at = timezone.now()
    enrollment.save(update_fields=["status", "completed_at", "certificate_issued_at"])
    return enrollment


def drop_training(enrollment):
    from .models import TrainingEnrollmentStatus
    enrollment.status = TrainingEnrollmentStatus.DROPPED
    enrollment.save(update_fields=["status"])
    return enrollment


def list_available_trainings(category: str = None):
    from .models import TrainingProgram
    queryset = TrainingProgram.objects.all().order_by("title")
    if category:
        queryset = queryset.filter(category=category)
    return queryset


def get_my_enrollments(student):
    from .models import TrainingEnrollment
    return TrainingEnrollment.objects.filter(student=student).select_related("program").order_by("-enrolled_at")
