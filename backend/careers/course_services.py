"""Business rules for full (Coursera-style) courses: who may edit or
supervise, lesson progress, quiz grading, and finishing a course."""
from django.db.models import Q
from django.utils import timezone

from .models import (
    AssignmentSubmission, CourseStaff, CourseStaffRole, Lesson, LessonKind, LessonProgress, QuizAttempt,
    SubmissionStatus, TrainingEnrollmentStatus, TrainingProgram, QuizQuestion,
)
from .services import InvalidEnrollmentTransitionError, mark_training_completed

MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_VIDEO_BYTES = 500 * 1024 * 1024
VIDEO_CONTENT_TYPES = {"video/mp4", "video/webm", "video/ogg", "video/quicktime"}


class CourseError(Exception):
    pass


def is_platform_admin(user) -> bool:
    return bool(
        user and user.is_authenticated
        and (hasattr(user, "admin_profile") or user.is_staff or user.is_superuser)
    )


def manageable_programs(user):
    """Programs a user may see in the management area: admins see all,
    everyone else only the ones they've been assigned to."""
    if is_platform_admin(user):
        return TrainingProgram.objects.all()
    return TrainingProgram.objects.filter(staff__user=user)


def editable_programs(user):
    if is_platform_admin(user):
        return TrainingProgram.objects.all()
    return TrainingProgram.objects.filter(staff__user=user, staff__role=CourseStaffRole.LECTURER)


def staff_role_for(user, program):
    if is_platform_admin(user):
        return "ADMIN"
    row = CourseStaff.objects.filter(program=program, user=user).first()
    return row.role if row else None


def can_edit_course(user, program) -> bool:
    return staff_role_for(user, program) in ("ADMIN", CourseStaffRole.LECTURER)


def find_user(identifier: str):
    from identity.models import User

    identifier = (identifier or "").strip()
    if not identifier:
        return None
    return User.objects.filter(
        Q(username__iexact=identifier) | Q(phone=identifier) | Q(email__iexact=identifier)
    ).first()


def assign_staff(*, program, identifier: str, role: str):
    user = find_user(identifier)
    if user is None:
        raise CourseError("No user found with that username, phone number or email.")
    row, _ = CourseStaff.objects.update_or_create(program=program, user=user, defaults={"role": role})
    return row


def lessons_of(program):
    return Lesson.objects.filter(module__program=program)


def course_progress(enrollment) -> dict:
    total = lessons_of(enrollment.program).count()
    done = LessonProgress.objects.filter(enrollment=enrollment, lesson__module__program=enrollment.program).count()
    return {"total": total, "done": done, "percent": round(done * 100 / total) if total else 0}


def course_is_finished(enrollment) -> bool:
    """A program without lessons is a simple self-reported course and is
    never blocked; otherwise every lesson (and quiz) must be done."""
    progress = course_progress(enrollment)
    return progress["total"] == 0 or progress["done"] >= progress["total"]


def _require_active(enrollment):
    if enrollment.status not in (TrainingEnrollmentStatus.ENROLLED, TrainingEnrollmentStatus.IN_PROGRESS):
        raise InvalidEnrollmentTransitionError(
            f"Cannot make progress on an enrollment that is {enrollment.get_status_display().lower()}."
        )


def _record_progress(enrollment, lesson):
    LessonProgress.objects.get_or_create(enrollment=enrollment, lesson=lesson)
    if enrollment.status == TrainingEnrollmentStatus.ENROLLED:
        enrollment.status = TrainingEnrollmentStatus.IN_PROGRESS
        enrollment.save(update_fields=["status"])
    progress = course_progress(enrollment)
    if progress["total"] and progress["done"] >= progress["total"]:
        mark_training_completed(enrollment)


def _lesson_for(enrollment, lesson_id) -> Lesson:
    lesson = Lesson.objects.filter(pk=lesson_id, module__program=enrollment.program).first()
    if lesson is None:
        raise CourseError("This lesson is not part of the course.")
    return lesson


def complete_lesson(enrollment, lesson_id):
    _require_active(enrollment)
    lesson = _lesson_for(enrollment, lesson_id)
    if lesson.kind == LessonKind.QUIZ:
        raise CourseError("A quiz is completed by passing it.")
    if lesson.kind == LessonKind.ASSIGNMENT:
        raise CourseError("An assignment is completed when a reviewer approves your submission.")
    _record_progress(enrollment, lesson)
    return lesson


def _validate_pdf(file):
    if file.size > MAX_PDF_BYTES:
        raise CourseError("PDF files can be at most 20 MB.")
    if file.content_type != "application/pdf" or file.read(5) != b"%PDF-":
        raise CourseError("Upload a valid PDF file.")
    file.seek(0)


def submit_assignment(enrollment, lesson_id, file) -> AssignmentSubmission:
    _require_active(enrollment)
    lesson = _lesson_for(enrollment, lesson_id)
    if lesson.kind != LessonKind.ASSIGNMENT:
        raise CourseError("This lesson is not an assignment.")
    _validate_pdf(file)

    submission = AssignmentSubmission.objects.filter(enrollment=enrollment, lesson=lesson).first()
    if submission and submission.status == SubmissionStatus.APPROVED:
        raise CourseError("This assignment has already been approved.")
    if submission is None:
        return AssignmentSubmission.objects.create(enrollment=enrollment, lesson=lesson, file=file)
    submission.file.delete(save=False)  # the replaced PDF is no longer needed
    submission.file = file
    submission.status = SubmissionStatus.SUBMITTED
    submission.feedback = ""
    submission.reviewed_by = None
    submission.reviewed_at = None
    submission.save()
    return submission


def _notify_review(submission):
    """Tell the learner the outcome, in their own language. A notification
    problem must never undo or block the review, so failures are only logged."""
    import logging

    from notifications.services import notify

    student = submission.enrollment.student
    program = submission.enrollment.program
    french = (student.preferred_language or "").upper() == "FR"
    approved = submission.status == SubmissionStatus.APPROVED
    lesson = submission.lesson.title
    if french:
        title = f"Devoir approuvé : {lesson}" if approved else f"Modifications demandées : {lesson}"
        message = f"Votre travail pour « {lesson} » ({program.title}) a été " + ("approuvé." if approved else "relu. Des modifications sont demandées.")
        if submission.feedback:
            message += f" Commentaire : {submission.feedback}"
    else:
        title = f"Assignment approved: {lesson}" if approved else f"Changes requested: {lesson}"
        message = f"Your submission for “{lesson}” ({program.title}) was " + ("approved." if approved else "reviewed and needs changes.")
        if submission.feedback:
            message += f" Feedback: {submission.feedback}"
    try:
        notify(
            recipient=student, notification_type="COURSE_ASSIGNMENT_REVIEW",
            title=title, message=message, related_reference=str(program.id),
        )
    except Exception:
        logging.getLogger(__name__).exception("Could not send the assignment review notification for %s", submission.id)


def review_submission(submission, *, reviewer, decision: str, feedback: str = ""):
    if decision not in (SubmissionStatus.APPROVED, SubmissionStatus.CHANGES_REQUESTED):
        raise CourseError("Choose approve or request changes.")
    feedback = (feedback or "").strip()
    if decision == SubmissionStatus.CHANGES_REQUESTED and not feedback:
        raise CourseError("Tell the learner what needs to change.")
    submission.status = decision
    submission.feedback = feedback
    submission.reviewed_by = reviewer
    submission.reviewed_at = timezone.now()
    submission.save()
    enrollment = submission.enrollment
    if decision == SubmissionStatus.APPROVED and enrollment.status in (
        TrainingEnrollmentStatus.ENROLLED, TrainingEnrollmentStatus.IN_PROGRESS,
    ):
        _record_progress(enrollment, submission.lesson)
    _notify_review(submission)
    return submission


def submit_quiz(enrollment, lesson_id, answers: dict) -> dict:
    _require_active(enrollment)
    lesson = _lesson_for(enrollment, lesson_id)
    if lesson.kind != LessonKind.QUIZ:
        raise CourseError("This lesson is not a quiz.")
    questions = list(QuizQuestion.objects.filter(lesson=lesson).prefetch_related("choices"))
    if not questions:
        raise CourseError("This quiz has no questions yet.")

    results, correct_count = [], 0
    for question in questions:
        selected = {str(c) for c in (answers.get(str(question.id)) or [])}
        correct = {str(c.id) for c in question.choices.all() if c.is_correct}
        is_correct = bool(correct) and selected == correct
        correct_count += is_correct
        results.append({
            "question": str(question.id),
            "correct": is_correct,
            "correct_choices": sorted(correct),
            "explanation": question.explanation,
        })

    score = round(correct_count * 100 / len(questions))
    passed = score >= lesson.pass_mark_percent
    QuizAttempt.objects.create(
        enrollment=enrollment, lesson=lesson, score_percent=score, passed=passed,
        answers={str(k): [str(c) for c in v] for k, v in answers.items() if isinstance(v, list)},
    )
    if passed:
        _record_progress(enrollment, lesson)
    return {"score_percent": score, "passed": passed, "pass_mark_percent": lesson.pass_mark_percent, "results": results}


def learner_outline(enrollment, request) -> dict:
    """Everything the course player needs. Correct answers are never
    included here — they only come back after a quiz is submitted."""
    done_ids = set(
        LessonProgress.objects.filter(enrollment=enrollment).values_list("lesson_id", flat=True)
    )
    best = {}
    for attempt in QuizAttempt.objects.filter(enrollment=enrollment):
        best[attempt.lesson_id] = max(best.get(attempt.lesson_id, 0), attempt.score_percent)

    modules = []
    program = enrollment.program
    submissions = {s.lesson_id: s for s in AssignmentSubmission.objects.filter(enrollment=enrollment)}
    for module in program.modules.prefetch_related("lessons__questions__choices"):
        lessons = []
        for lesson in module.lessons.all():
            item = {
                "id": str(lesson.id), "title": lesson.title, "kind": lesson.kind,
                "content_text": lesson.content_text, "video_url": lesson.video_url,
                                "video_file_url": request.build_absolute_uri(lesson.video_file.url) if lesson.video_file else "",
                                "pdf_url": request.build_absolute_uri(lesson.pdf_file.url) if lesson.pdf_file else "",
                "completed": lesson.id in done_ids,
            }
            if lesson.kind == LessonKind.ASSIGNMENT:
                sub = submissions.get(lesson.id)
                item["submission"] = None if sub is None else {
                    "status": sub.status, "feedback": sub.feedback, "submitted_at": sub.submitted_at,
                }
            if lesson.kind == LessonKind.QUIZ:
                item["pass_mark_percent"] = lesson.pass_mark_percent
                item["best_score_percent"] = best.get(lesson.id)
                item["questions"] = [
                    {
                        "id": str(q.id), "text": q.text,
                        "multiple": sum(c.is_correct for c in q.choices.all()) > 1,
                        "choices": [{"id": str(c.id), "text": c.text} for c in q.choices.all()],
                    }
                    for q in lesson.questions.all()
                ]
            lessons.append(item)
        modules.append({"id": str(module.id), "title": module.title, "lessons": lessons})
    return {
        "program": {"id": str(program.id), "title": program.title},
        "status": enrollment.status,
        "certificate_issued_at": enrollment.certificate_issued_at,
        "progress": course_progress(enrollment),
        "modules": modules,
    }
