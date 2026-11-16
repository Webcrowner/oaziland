"""
careers.course_reminders — nudges learners who've gone quiet on an online course, and course staff who haven't
reviewed a learner's assignment.

A learner is reminded when they haven't finished a lesson for INACTIVE_DAYS, at most once every INACTIVE_DAYS, and
never after GIVE_UP_DAYS without activity (so nobody is nagged forever). Courses taught by a trainer without online
lessons aren't reminded.

An assignment still waiting for review after REVIEW_REMINDER_HOURS reminds the course's reviewers (again every
REVIEW_REMINDER_HOURS until it's reviewed); after ESCALATE_AFTER_HOURS the platform admins are alerted once, so no
learner waits forever. Both run via `python manage.py send_course_reminders` (hourly in the scheduler).
"""
from datetime import timedelta

from django.db.models import Max, Q
from django.db.models.functions import Coalesce
from django.utils import timezone

INACTIVE_DAYS = 7
GIVE_UP_DAYS = 60
REVIEW_REMINDER_HOURS = 48
ESCALATE_AFTER_HOURS = 5 * 24


def due_enrollments(now=None):
    from .models import TrainingEnrollment, TrainingEnrollmentStatus
    now = now or timezone.now()
    quiet_since = now - timedelta(days=INACTIVE_DAYS)
    with_lessons = TrainingEnrollment.objects.filter(program__modules__lessons__isnull=False).values("pk")
    return (
        TrainingEnrollment.objects.filter(
            pk__in=with_lessons, student__is_active=True,
            status__in=[TrainingEnrollmentStatus.ENROLLED, TrainingEnrollmentStatus.IN_PROGRESS],
        )
        .filter(Q(last_reminded_at__isnull=True) | Q(last_reminded_at__lte=quiet_since))
        .annotate(last_active=Coalesce(Max("lesson_progress__completed_at"), "enrolled_at"))
        .filter(last_active__lte=quiet_since, last_active__gt=now - timedelta(days=GIVE_UP_DAYS))
        .select_related("program", "student")
    )


def overdue_module_titles(enrollment, now) -> list[str]:
    """Titles of the modules whose suggested finish date has passed and that the learner hasn't finished."""
    from .course_services import module_deadline
    from .models import LessonProgress

    done = set(LessonProgress.objects.filter(enrollment=enrollment).values_list("lesson_id", flat=True))
    titles = []
    for module in enrollment.program.modules.prefetch_related("lessons"):
        due_at = module_deadline(enrollment, module)
        lessons = list(module.lessons.all())
        if due_at and due_at < now and any(lesson.pk not in done for lesson in lessons):
            titles.append(module.title)
    return titles


def send_course_reminders(now=None) -> int:
    from .course_services import course_progress, lessons_of
    from .models import LessonProgress, TrainingEnrollment
    from .services import _in_language, _send

    now = now or timezone.now()
    sent = 0
    for enrollment in due_enrollments(now):
        student, program = enrollment.student, enrollment.program
        progress = course_progress(enrollment)
        done = set(LessonProgress.objects.filter(enrollment=enrollment).values_list("lesson_id", flat=True))
        next_lesson = lessons_of(program).exclude(pk__in=done).order_by("module__position", "position", "title").first()
        next_en = f" Next up: \"{next_lesson.title}\"." if next_lesson else ""
        next_fr = f" Prochaine leçon : « {next_lesson.title} »." if next_lesson else ""
        behind = overdue_module_titles(enrollment, now)
        if behind:
            next_en += f" You're behind the suggested pace for \"{behind[0]}\" — no pressure, but try to catch up."
            next_fr += f" Vous avez dépassé le rythme conseillé pour « {behind[0]} » — sans pression, mais essayez de rattraper votre retard."
        _send(
            recipient=student, notification_type="COURSE_REMINDER",
            title=_in_language(student, f"Keep going with \"{program.title}\"", f"Continuez « {program.title} »"),
            message=_in_language(
                student,
                f"You're {progress['percent']}% through \"{program.title}\".{next_en} Pick up where you left off.",
                f"Vous en êtes à {progress['percent']} % de « {program.title} ».{next_fr} Reprenez là où vous vous êtes arrêté.",
            ),
            related_reference=str(program.pk),
        )
        TrainingEnrollment.objects.filter(pk=enrollment.pk).update(last_reminded_at=now)
        sent += 1
    return sent


def _waiting(submission, now) -> str:
    days = int((now - submission.submitted_at).total_seconds() // 86400)
    return f"{days}"


def send_review_reminders(now=None) -> dict:
    """Reminds reviewers of assignments waiting REVIEW_REMINDER_HOURS (repeatedly) and alerts admins about those
    waiting ESCALATE_AFTER_HOURS (once). Returns how many submissions were reminded and escalated."""
    from identity.models import AdminProfile

    from .course_services import course_reviewers
    from .models import AssignmentSubmission, SubmissionStatus, TrainingEnrollmentStatus
    from .services import _in_language, _send

    now = now or timezone.now()
    waiting = AssignmentSubmission.objects.filter(
        status=SubmissionStatus.SUBMITTED,
        enrollment__status__in=[TrainingEnrollmentStatus.ENROLLED, TrainingEnrollmentStatus.IN_PROGRESS],
    ).select_related("enrollment__program", "enrollment__student", "lesson")
    reminder_due = now - timedelta(hours=REVIEW_REMINDER_HOURS)
    counts = {"reminded": 0, "escalated": 0}

    for submission in waiting.filter(submitted_at__lte=reminder_due).filter(
        Q(review_reminded_at__isnull=True) | Q(review_reminded_at__lte=reminder_due)
    ):
        program, student = submission.enrollment.program, submission.enrollment.student
        learner, lesson, days = student.full_name or student.username, submission.lesson.title, _waiting(submission, now)
        for reviewer in course_reviewers(program).exclude(pk=student.pk):
            _send(
                recipient=reviewer, notification_type="COURSE_SUBMISSION_REMINDER",
                title=_in_language(reviewer, "An assignment is waiting for your review", "Un devoir attend votre correction"),
                message=_in_language(
                    reviewer,
                    f"{learner} handed in “{lesson}” ({program.title}) {days} days ago and is waiting for your review "
                    "to continue. Review it in Manage courses → Submissions.",
                    f"{learner} a rendu « {lesson} » ({program.title}) il y a {days} jours et attend votre correction "
                    "pour continuer. Corrigez-le dans Gérer les cours → Travaux remis.",
                ),
                related_reference=str(program.id),
            )
        AssignmentSubmission.objects.filter(pk=submission.pk).update(review_reminded_at=now)
        counts["reminded"] += 1

    admins = [profile.user for profile in AdminProfile.objects.select_related("user").filter(user__is_active=True)]
    for submission in waiting.filter(submitted_at__lte=now - timedelta(hours=ESCALATE_AFTER_HOURS), escalated_at__isnull=True):
        program, student = submission.enrollment.program, submission.enrollment.student
        learner, lesson, days = student.full_name or student.username, submission.lesson.title, _waiting(submission, now)
        for admin in admins:
            _send(
                recipient=admin, notification_type="COURSE_SUBMISSION_ESCALATED",
                title=_in_language(admin, "Unreviewed assignment", "Devoir non corrigé"),
                message=_in_language(
                    admin,
                    f"{learner}'s “{lesson}” in “{program.title}” has been waiting {days} days for a review, despite "
                    "reminders to the course team. Review it yourself in Manage courses → Submissions, or contact the trainer.",
                    f"Le devoir « {lesson} » de {learner} dans « {program.title} » attend une correction depuis {days} jours, "
                    "malgré les rappels envoyés à l'équipe. Corrigez-le vous-même dans Gérer les cours → Travaux remis, "
                    "ou contactez le formateur.",
                ),
                related_reference=str(program.id),
            )
        AssignmentSubmission.objects.filter(pk=submission.pk).update(escalated_at=now)
        counts["escalated"] += 1
    return counts
