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


class InvalidEnrollmentTransitionError(Exception):
    pass


class PaymentRequiredError(Exception):
    """A paid course can only be joined by paying for it (see pay_for_training)."""


class CoursePaymentError(Exception):
    """The Mobile Money payment for a course could not be started."""


class CoursePaymentInProgressError(Exception):
    """A payment for this enrollment is already waiting for the learner's approval."""


def requires_payment(program, student) -> bool:
    """A course with a price must be paid for, except by the person offering it."""
    return bool(program.price_xaf and program.price_xaf > 0) and program.provider_id != getattr(student, "pk", None)


def enroll_in_training(*, program, student):
    """unique_together on (program, student) already prevents a
    duplicate row at the database level — this turns that into a
    clear, catchable error instead of a raw IntegrityError reaching
    an API caller. A student who previously DROPPED the program is
    allowed to come back: their existing enrollment is reactivated
    (the unique constraint means a second row is impossible). A paid
    course goes through pay_for_training instead, unless this learner
    has already paid for it."""
    from django.db import IntegrityError, transaction
    from .models import TrainingEnrollment, TrainingEnrollmentStatus

    existing = TrainingEnrollment.objects.filter(program=program, student=student).select_related("booking").first()
    if requires_payment(program, student) and not (existing and existing.is_paid):
        raise PaymentRequiredError(f"This course costs {program.price_xaf:.0f} XAF. Pay for it to enroll.")
    try:
        with transaction.atomic():
            return TrainingEnrollment.objects.create(program=program, student=student)
    except IntegrityError:
        enrollment = TrainingEnrollment.objects.get(program=program, student=student)
        if enrollment.status not in (TrainingEnrollmentStatus.DROPPED, TrainingEnrollmentStatus.PAYMENT_PENDING):
            raise AlreadyEnrolledError("This student is already enrolled in this program.")
        enrollment.status = TrainingEnrollmentStatus.ENROLLED
        enrollment.completed_at = None
        enrollment.certificate_issued_at = None
        enrollment.save(update_fields=["status", "completed_at", "certificate_issued_at"])
        return enrollment


def pay_for_training(*, program, student, phone_number: str, lock_client, payment_gateway):
    """Starts the Mobile Money payment for a paid course. The learner gets access once the provider's webhook
    confirms the payment (confirm_training_payment); the money then stays in escrow until they complete the course.
    Someone who already paid (and later dropped) is re-enrolled without paying again."""
    from django.db import IntegrityError, transaction
    from transactions.models import BookingType
    from transactions.services import reserve_booking, initiate_booking_payment, fail_payment, InventoryConflictError
    from .models import TrainingEnrollment, TrainingEnrollmentStatus

    if not requires_payment(program, student):
        return enroll_in_training(program=program, student=student)

    existing = TrainingEnrollment.objects.select_related("booking").filter(program=program, student=student).first()
    if existing is not None and existing.is_paid:
        return enroll_in_training(program=program, student=student)
    if existing is not None and existing.status not in (TrainingEnrollmentStatus.PAYMENT_PENDING, TrainingEnrollmentStatus.DROPPED):
        raise AlreadyEnrolledError("You are already enrolled in this course.")
    phone_number = (phone_number or "").strip()
    if not phone_number:
        raise CoursePaymentError("Enter the Mobile Money number to pay with.")

    if existing is None:
        try:
            with transaction.atomic():
                existing = TrainingEnrollment.objects.create(
                    program=program, student=student, status=TrainingEnrollmentStatus.PAYMENT_PENDING,
                )
        except IntegrityError:
            raise CoursePaymentInProgressError("A payment for this course was just started. Check your phone.")
    enrollment = existing
    if enrollment.status != TrainingEnrollmentStatus.PAYMENT_PENDING:
        enrollment.status = TrainingEnrollmentStatus.PAYMENT_PENDING
        enrollment.completed_at = None
        enrollment.certificate_issued_at = None
        enrollment.save(update_fields=["status", "completed_at", "certificate_issued_at"])

    _expire_stale_course_payment(enrollment, lock_client)
    try:
        booking = reserve_booking(
            lock_client=lock_client, requester=student, booking_type=BookingType.TRAINING,
            target_content_type="careers.TrainingEnrollment", target_id=enrollment.pk, amount_xaf=program.price_xaf,
        )
    except InventoryConflictError:
        raise CoursePaymentInProgressError(
            "A payment for this course is already waiting for your approval on your phone. "
            "Approve it, or try again in a few minutes."
        )
    enrollment.booking = booking
    enrollment.save(update_fields=["booking"])
    try:
        debit = initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
    except Exception:
        fail_payment(lock_client=lock_client, booking=booking)
        raise
    if not debit.success:
        fail_payment(lock_client=lock_client, booking=booking)
        raise CoursePaymentError("The payment could not be started. Check the number and try again.")
    return enrollment


def _expire_stale_course_payment(enrollment, lock_client):
    """A previous payment the learner never approved holds the enrollment for 7 minutes; after that it's expired so
    they can pay again. A payment still inside its hold is left alone (pay_for_training then reports it)."""
    from django.utils import timezone
    from transactions.models import BookingStatus
    from transactions.services import expire_hold

    previous = enrollment.booking
    if previous is None or previous.status not in (BookingStatus.PENDING, BookingStatus.PAYMENT_PROCESSING):
        return
    if previous.hold_expires_at and previous.hold_expires_at <= timezone.now():
        expire_hold(lock_client=lock_client, booking=previous)


def confirm_training_payment(*, booking):
    """Called by the payment webhook once a course payment is confirmed (and held in escrow): opens the course."""
    from .models import TrainingEnrollment, TrainingEnrollmentStatus

    enrollment = TrainingEnrollment.objects.select_related("program__provider", "student").filter(booking=booking).first()
    if enrollment is None:
        return None
    updated = TrainingEnrollment.objects.filter(
        pk=enrollment.pk, status=TrainingEnrollmentStatus.PAYMENT_PENDING,
    ).update(status=TrainingEnrollmentStatus.ENROLLED)
    if not updated:
        return enrollment
    enrollment.status = TrainingEnrollmentStatus.ENROLLED

    program = enrollment.program
    student, provider = enrollment.student, program.provider
    learner = student.full_name or student.username
    amount = f"{booking.amount_xaf:.0f}"
    _send(
        recipient=student, notification_type="TRAINING_ENROLLED",
        title=_in_language(student, "You're enrolled", "Inscription confirmée"),
        message=_in_language(
            student,
            f"Your payment of {amount} XAF for \"{program.title}\" was received. You can start the course now.",
            f"Votre paiement de {amount} XAF pour « {program.title} » a bien été reçu. Vous pouvez commencer la formation.",
        ),
        related_reference=str(program.pk),
    )
    _send(
        recipient=provider, notification_type="TRAINING_ENROLLED",
        title=_in_language(provider, "New paid enrollment", "Nouvelle inscription payée"),
        message=_in_language(
            provider,
            f"{learner} paid {amount} XAF for \"{program.title}\". The payment is held in escrow and paid to you when they complete the course.",
            f"{learner} a payé {amount} XAF pour « {program.title} ». Le paiement est conservé en séquestre et vous est versé quand la formation est terminée.",
        ),
        related_reference=str(program.pk),
    )
    return enrollment


def _require_status(enrollment, allowed, action: str):
    if enrollment.status not in allowed:
        raise InvalidEnrollmentTransitionError(
            f"Cannot {action} an enrollment that is {enrollment.get_status_display().lower()}."
        )


def mark_training_in_progress(enrollment):
    from .models import TrainingEnrollmentStatus
    _require_status(enrollment, {TrainingEnrollmentStatus.ENROLLED}, "start")
    enrollment.status = TrainingEnrollmentStatus.IN_PROGRESS
    enrollment.save(update_fields=["status"])
    return enrollment


def mark_training_completed(enrollment):
    """Issues a certificate automatically ONLY if the program actually
    offers one — completion and certification are tracked as distinct
    events, since a program might complete without ever having promised
    a certificate. A finished or dropped enrollment can't be completed
    again, so the completion/certificate timestamps are never rewritten."""
    from django.utils import timezone
    from .models import TrainingEnrollmentStatus

    _require_status(enrollment, {TrainingEnrollmentStatus.ENROLLED, TrainingEnrollmentStatus.IN_PROGRESS}, "complete")
    from .course_services import course_is_finished
    if not course_is_finished(enrollment):
        raise InvalidEnrollmentTransitionError("Finish every lesson and pass every quiz to complete this course.")
    enrollment.status = TrainingEnrollmentStatus.COMPLETED
    enrollment.completed_at = timezone.now()
    if enrollment.program.issues_certification:
        enrollment.certificate_issued_at = timezone.now()
        enrollment.certificate_code = enrollment.certificate_code or new_certificate_code()
        from .certificate_templates import freeze_design, template_for_program
        from .course_services import final_grade_percent
        program = enrollment.program
        enrollment.certificate_design = freeze_design(template_for_program(program))
        enrollment.certificate_hours = program.duration_hours
        enrollment.certificate_grade_percent = final_grade_percent(enrollment)
        enrollment.certificate_expires_at = (
            add_months(enrollment.certificate_issued_at, program.certificate_validity_months)
            if program.certificate_validity_months else None
        )
    from django.db import transaction
    with transaction.atomic():
        enrollment.save(update_fields=[
            "status", "completed_at", "certificate_issued_at", "certificate_code", "certificate_design",
            "certificate_hours", "certificate_grade_percent", "certificate_expires_at",
        ])
        _release_course_fee(enrollment)
    _notify_completion(enrollment)
    return enrollment


CERTIFICATE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I, so a code read off paper is typed correctly


def add_months(moment, months: int):
    """moment + months, on the same day of the month (or the month's last day, e.g. 31 Jan + 1 month = 28/29 Feb)."""
    import calendar

    index = moment.month - 1 + months
    year, month = moment.year + index // 12, index % 12 + 1
    return moment.replace(year=year, month=month, day=min(moment.day, calendar.monthrange(year, month)[1]))


def new_certificate_code() -> str:
    import secrets
    from .models import TrainingEnrollment
    while True:
        code = "OZL-" + "".join(secrets.choice(CERTIFICATE_ALPHABET) for _ in range(10))
        if not TrainingEnrollment.objects.filter(certificate_code=code).exists():
            return code


def _send(**kwargs):
    """A notification problem must never undo or block the course action that triggered it, so failures are only logged."""
    import logging
    from notifications.services import notify
    try:
        notify(**kwargs)
    except Exception:
        logging.getLogger(__name__).exception("Could not send the %s notification", kwargs.get("notification_type"))


def _in_language(user, english: str, french: str) -> str:
    return french if (getattr(user, "preferred_language", "") or "").upper() == "FR" else english


def _notify_completion(enrollment):
    program = enrollment.program
    student, provider = enrollment.student, program.provider
    learner = student.full_name or student.username
    code = enrollment.certificate_code
    _send(
        recipient=student, notification_type="TRAINING_COMPLETED",
        title=_in_language(student, "Course completed", "Formation terminée"),
        message=_in_language(
            student,
            f"Congratulations on completing \"{program.title}\"!" + (f" Your certificate {code} is ready to view, print and share." if code else ""),
            f"Félicitations, vous avez terminé « {program.title} » !" + (f" Votre certificat {code} est prêt à être consulté, imprimé et partagé." if code else ""),
        ),
        related_reference=str(program.pk),
    )
    _send(
        recipient=provider, notification_type="TRAINING_COMPLETED",
        title=_in_language(provider, "A learner completed your course", "Un apprenant a terminé votre formation"),
        message=_in_language(
            provider,
            f"{learner} completed \"{program.title}\"." + (" Their certificate was issued." if code else ""),
            f"{learner} a terminé « {program.title} »." + (" Son certificat a été délivré." if code else ""),
        ),
        related_reference=str(program.pk),
    )


def _release_course_fee(enrollment):
    """A paid course's fee has been held in escrow since payment; finishing the course pays it to the provider."""
    from transactions.models import BookingStatus, EscrowStatus
    from transactions.services import complete_booking

    booking = enrollment.booking
    escrow = getattr(booking, "escrow", None) if booking is not None else None
    if escrow is None or escrow.status != EscrowStatus.HELD or booking.status != BookingStatus.CONFIRMED:
        return
    complete_booking(booking=booking)


def drop_training(enrollment):
    from .models import TrainingEnrollmentStatus
    _require_status(enrollment, {TrainingEnrollmentStatus.ENROLLED, TrainingEnrollmentStatus.IN_PROGRESS}, "drop")
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


def after_course_payment_settled(booking, *, refunded_in_full: bool):
    """Called when support settles a disputed course payment. A full refund takes the course back: the learner loses
    access and any certificate (re-enrolling means paying again). A release or partial refund leaves access as is."""
    from .models import TrainingEnrollment, TrainingEnrollmentStatus

    if not refunded_in_full:
        return None
    enrollment = TrainingEnrollment.objects.filter(booking=booking).first()
    if enrollment is None or enrollment.status == TrainingEnrollmentStatus.DROPPED:
        return enrollment
    enrollment.status = TrainingEnrollmentStatus.DROPPED
    enrollment.certificate_issued_at = None
    enrollment.certificate_code = None
    enrollment.certificate_design = None
    enrollment.certificate_expires_at = None
    enrollment.save(update_fields=["status", "certificate_issued_at", "certificate_code", "certificate_design", "certificate_expires_at"])
    return enrollment
