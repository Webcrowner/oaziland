"""
careers.course_reminders — nudges learners who've gone quiet on an online course.

A learner is reminded when they haven't finished a lesson for INACTIVE_DAYS, at most once every INACTIVE_DAYS, and
never after GIVE_UP_DAYS without activity (so nobody is nagged forever). Courses taught by a trainer without online
lessons aren't reminded. Run daily via `python manage.py send_course_reminders`.
"""
from datetime import timedelta

from django.db.models import Max, Q
from django.db.models.functions import Coalesce
from django.utils import timezone

INACTIVE_DAYS = 7
GIVE_UP_DAYS = 60


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
