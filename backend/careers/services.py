"""
careers.services — job posting/application lifecycle and training
enrollment/completion, reusing engagement.build_whatsapp_action() for
sharing rather than a separate share mechanism.
"""


def apply_to_job(*, job_posting, applicant, cover_message: str = ""):
    from .models import JobApplication
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


def enroll_in_training(*, program, student):
    from .models import TrainingEnrollment
    return TrainingEnrollment.objects.create(program=program, student=student)


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
