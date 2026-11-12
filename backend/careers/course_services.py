"""Business rules for full (Coursera-style) courses: who may edit or
supervise, lesson progress, quiz grading, and finishing a course."""
from datetime import timedelta

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from .models import (
    AssignmentSubmission, CourseStaff, CourseStaffRole, Lesson, LessonKind, LessonProgress, QuizAttempt,
    SubmissionStatus, TrainingEnrollmentStatus, TrainingProgram, QuizQuestion,
)
from .services import InvalidEnrollmentTransitionError, mark_training_completed
from .course_media import media_url

MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_VIDEO_BYTES = 500 * 1024 * 1024
VIDEO_CONTENT_TYPES = {"video/mp4", "video/webm", "video/ogg", "video/quicktime"}


class CourseError(Exception):
    pass


OWNER = "OWNER"  # a trainer with course-creator access, on a course they created (they're its provider)


def is_platform_admin(user) -> bool:
    return bool(
        user and user.is_authenticated
        and (hasattr(user, "admin_profile") or user.is_staff or user.is_superuser)
    )


def course_creator_access(user):
    """The admin's grant letting this user create their own courses, or None."""
    if not (user and user.is_authenticated):
        return None
    from .models import CourseCreatorAccess
    return CourseCreatorAccess.objects.filter(user=user).first()


def can_create_courses(user) -> bool:
    return is_platform_admin(user) or course_creator_access(user) is not None


def can_publish_own_courses(user) -> bool:
    if is_platform_admin(user):
        return True
    access = course_creator_access(user)
    return bool(access and access.can_publish)


def manageable_programs(user):
    """Programs a user may see in the management area: admins see all,
    everyone else the ones they created or have been assigned to."""
    if is_platform_admin(user):
        return TrainingProgram.objects.all()
    return TrainingProgram.objects.filter(Q(staff__user=user) | Q(provider=user)).distinct()


def editable_programs(user):
    if is_platform_admin(user):
        return TrainingProgram.objects.all()
    return TrainingProgram.objects.filter(
        Q(staff__user=user, staff__role=CourseStaffRole.LECTURER) | Q(provider=user)
    ).distinct()


def staff_role_for(user, program):
    if is_platform_admin(user):
        return "ADMIN"
    if program.provider_id == getattr(user, "pk", None):
        return OWNER
    row = CourseStaff.objects.filter(program=program, user=user).first()
    return row.role if row else None


def can_edit_course(user, program) -> bool:
    return staff_role_for(user, program) in ("ADMIN", OWNER, CourseStaffRole.LECTURER)


def may_publish(user, program) -> bool:
    """Admins publish anything. Otherwise the course's provider decides: an admin-made course can be published by its
    editors, a trainer's course only if that trainer was given publishing rights."""
    if is_platform_admin(user):
        return True
    if not can_edit_course(user, program):
        return False
    return is_platform_admin(program.provider) or can_publish_own_courses(program.provider)


def can_manage_team(user, program) -> bool:
    return staff_role_for(user, program) in ("ADMIN", OWNER)


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


def empty_quizzes(program):
    """Quizzes without any question. Learners can't pass them, so a course can't be published (or submitted for
    review) while it has one, and a published course's quiz can't lose its last question."""
    return lessons_of(program).filter(kind=LessonKind.QUIZ).exclude(Exists(QuizQuestion.objects.filter(lesson=OuterRef("pk"))))


def require_no_empty_quizzes(program):
    titles = list(empty_quizzes(program).order_by("module__position", "position", "title").values_list("title", flat=True))
    if titles:
        quoted = ", ".join(f"“{title}”" for title in titles)
        raise CourseError(f"Add at least one question to every quiz first. Without questions: {quoted}.")


def course_progress(enrollment) -> dict:
    total = lessons_of(enrollment.program).count()
    done = LessonProgress.objects.filter(enrollment=enrollment, lesson__module__program=enrollment.program).count()
    return {"total": total, "done": done, "percent": round(done * 100 / total) if total else 0}


def course_is_finished(enrollment) -> bool:
    """A program without lessons is a simple self-reported course and is
    never blocked; otherwise every lesson (and quiz) must be done."""
    progress = course_progress(enrollment)
    return progress["total"] == 0 or progress["done"] >= progress["total"]


def final_grade_percent(enrollment):
    """The average of the learner's best score on each of the course's quizzes, or None for a course without quizzes.
    A quiz never attempted counts as 0."""
    from django.db.models import Max

    quizzes = list(lessons_of(enrollment.program).filter(kind=LessonKind.QUIZ).values_list("pk", flat=True))
    if not quizzes:
        return None
    best = dict(
        QuizAttempt.objects.filter(enrollment=enrollment, lesson_id__in=quizzes)
        .values_list("lesson_id").annotate(best=Max("score_percent")).values_list("lesson_id", "best")
    )
    return round(sum(best.get(pk, 0) for pk in quizzes) / len(quizzes))


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


QUIZ_ATTEMPTS_PER_WINDOW = 3
QUIZ_ATTEMPT_WINDOW = timedelta(hours=8)


class QuizLockedError(CourseError):
    """A quiz that can't be taken right now: already passed, or out of attempts until retry_at."""
    def __init__(self, message, retry_at=None):
        super().__init__(message)
        self.retry_at = retry_at


def quiz_attempt_status(enrollment, lesson, attempts=None) -> dict:
    """Whether the learner has passed this quiz, how many attempts they have left right now and, when none, the
    moment the next one opens. Learners get QUIZ_ATTEMPTS_PER_WINDOW attempts per QUIZ_ATTEMPT_WINDOW, so they can't
    guess their way through by resubmitting; a passed quiz is closed (its answers have been shown)."""
    if attempts is None:
        attempts = list(QuizAttempt.objects.filter(enrollment=enrollment, lesson=lesson))
    passed = any(a.passed for a in attempts)
    window_start = timezone.now() - QUIZ_ATTEMPT_WINDOW
    recent = sorted(a.submitted_at for a in attempts if a.submitted_at > window_start)
    left = 0 if passed else max(QUIZ_ATTEMPTS_PER_WINDOW - len(recent), 0)
    retry_at = recent[-QUIZ_ATTEMPTS_PER_WINDOW] + QUIZ_ATTEMPT_WINDOW if not passed and not left else None
    return {"passed": passed, "attempts_left": left, "retry_at": retry_at, "attempts_per_window": QUIZ_ATTEMPTS_PER_WINDOW}


def _graded(question, selected) -> dict:
    correct = {str(c.id) for c in question.choices.all() if c.is_correct}
    return {"question": str(question.id), "correct": bool(correct) and set(selected) == correct, "correct_choices": sorted(correct)}


def submit_quiz(enrollment, lesson_id, answers: dict) -> dict:
    """Grades an attempt. A failed attempt only says which questions were wrong; the correct answers and
    explanations are revealed once the quiz is passed (see quiz_attempt_status for the attempt limit)."""
    _require_active(enrollment)
    lesson = _lesson_for(enrollment, lesson_id)
    if lesson.kind != LessonKind.QUIZ:
        raise CourseError("This lesson is not a quiz.")
    questions = list(QuizQuestion.objects.filter(lesson=lesson).prefetch_related("choices"))
    if not questions:
        raise CourseError("This quiz has no questions yet.")
    attempt_status = quiz_attempt_status(enrollment, lesson)
    if attempt_status["passed"]:
        raise QuizLockedError("You've already passed this quiz.")
    if not attempt_status["attempts_left"]:
        raise QuizLockedError("You've used all your attempts for now.", retry_at=attempt_status["retry_at"])

    results = []
    for question in questions:
        results.append({**_graded(question, {str(c) for c in (answers.get(str(question.id)) or [])}), "explanation": question.explanation})

    score = round(sum(r["correct"] for r in results) * 100 / len(questions))
    passed = score >= lesson.pass_mark_percent
    QuizAttempt.objects.create(
        enrollment=enrollment, lesson=lesson, score_percent=score, passed=passed,
        answers={str(k): [str(c) for c in v] for k, v in answers.items() if isinstance(v, list)},
    )
    if passed:
        _record_progress(enrollment, lesson)
    else:
        results = [{"question": r["question"], "correct": r["correct"]} for r in results]
    return {
        "score_percent": score, "passed": passed, "pass_mark_percent": lesson.pass_mark_percent, "results": results,
        **{key: value for key, value in quiz_attempt_status(enrollment, lesson).items() if key != "passed"},
    }


def _quiz_review(attempt, questions) -> dict:
    """A passed quiz, as the learner answered it on their best passing attempt, with the answers and explanations."""
    return {
        "score_percent": attempt.score_percent,
        "answers": attempt.answers,
        "results": [{**_graded(q, attempt.answers.get(str(q.id)) or []), "explanation": q.explanation} for q in questions],
    }


def learner_outline(enrollment, request) -> dict:
    """Everything the course player needs. Correct answers are only included for quizzes the learner has passed
    (as a review of their passing attempt)."""
    done_ids = set(
        LessonProgress.objects.filter(enrollment=enrollment).values_list("lesson_id", flat=True)
    )
    attempts_by_lesson = {}
    for attempt in QuizAttempt.objects.filter(enrollment=enrollment):
        attempts_by_lesson.setdefault(attempt.lesson_id, []).append(attempt)

    modules = []
    program = enrollment.program
    submissions = {s.lesson_id: s for s in AssignmentSubmission.objects.filter(enrollment=enrollment)}
    for module in program.modules.prefetch_related("lessons__questions__choices"):
        lessons = []
        for lesson in module.lessons.all():
            item = {
                "id": str(lesson.id), "title": lesson.title, "kind": lesson.kind,
                "content_text": lesson.content_text, "video_url": lesson.video_url,
                "video_file_url": media_url(request, lesson, "video", enrollment.student),
                "pdf_url": media_url(request, lesson, "pdf", enrollment.student),
                "completed": lesson.id in done_ids,
            }
            if lesson.kind == LessonKind.ASSIGNMENT:
                sub = submissions.get(lesson.id)
                item["submission"] = None if sub is None else {
                    "status": sub.status, "feedback": sub.feedback, "submitted_at": sub.submitted_at,
                }
            if lesson.kind == LessonKind.QUIZ:
                attempts = attempts_by_lesson.get(lesson.id, [])
                questions = list(lesson.questions.all())
                item["pass_mark_percent"] = lesson.pass_mark_percent
                item["best_score_percent"] = max((a.score_percent for a in attempts), default=None)
                item.update({k: v for k, v in quiz_attempt_status(enrollment, lesson, attempts).items() if k != "passed"})
                item["questions"] = [
                    {
                        "id": str(q.id), "text": q.text,
                        "multiple": sum(c.is_correct for c in q.choices.all()) > 1,
                        "choices": [{"id": str(c.id), "text": c.text} for c in q.choices.all()],
                    }
                    for q in questions
                ]
                passing = max((a for a in attempts if a.passed), key=lambda a: a.score_percent, default=None)
                item["review"] = _quiz_review(passing, questions) if passing else None
            lessons.append(item)
        modules.append({"id": str(module.id), "title": module.title, "lessons": lessons})
    return {
        "program": {"id": str(program.id), "title": program.title},
        "status": enrollment.status,
        "certificate_issued_at": enrollment.certificate_issued_at,
        "certificate_code": enrollment.certificate_code,
        "progress": course_progress(enrollment),
        "modules": modules,
    }
