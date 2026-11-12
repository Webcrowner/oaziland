"""
careers.course_analytics — what a course's staff need to improve it: how many learners start and finish, where they
drop off, which quizzes are hard, how the course is rated and (for admins and the course's provider) what it earns.
"""
from decimal import Decimal

from django.db.models import Count, Max, Min, Q, Sum

ACTIVE = ("ENROLLED", "IN_PROGRESS", "COMPLETED", "DROPPED")


def _percent(part, whole) -> int:
    return round(part * 100 / whole) if whole else 0


def course_analytics(program, viewer) -> dict:
    from .course_reviews import rating_summary
    from .course_services import is_platform_admin, lessons_of
    from .models import LessonKind, LessonProgress, QuizAttempt, TrainingEnrollment

    enrollments = TrainingEnrollment.objects.filter(program=program)
    by_status = dict(enrollments.values_list("status").annotate(n=Count("id")))
    learners = enrollments.filter(status__in=ACTIVE)
    started_count = learners.count()
    completed = by_status.get("COMPLETED", 0)

    lessons = list(lessons_of(program).order_by("module__position", "module__title", "position", "title"))
    done_by_lesson = dict(
        LessonProgress.objects.filter(enrollment__in=learners).values_list("lesson").annotate(n=Count("enrollment", distinct=True))
    )
    funnel, previous = [], started_count
    for index, lesson in enumerate(lessons, start=1):
        done = done_by_lesson.get(lesson.id, 0)
        funnel.append({
            "position": index, "lesson_id": str(lesson.id), "title": lesson.title, "kind": lesson.kind,
            "completed": done, "percent": _percent(done, started_count),
            "drop_off_percent": max(0, _percent(previous - done, previous)) if previous else 0,
        })
        previous = done

    quizzes = []
    for lesson in (l for l in lessons if l.kind == LessonKind.QUIZ):
        attempts = QuizAttempt.objects.filter(lesson=lesson, enrollment__in=learners)
        per_learner = list(
            attempts.values("enrollment").annotate(best=Max("score_percent"), first_at=Min("submitted_at"), tries=Count("id"))
        )
        first_attempts = [
            attempts.filter(enrollment=row["enrollment"], submitted_at=row["first_at"]).values_list("passed", flat=True).first()
            for row in per_learner
        ]
        takers = len(per_learner)
        quizzes.append({
            "lesson_id": str(lesson.id), "title": lesson.title, "pass_mark_percent": lesson.pass_mark_percent,
            "learners": takers, "attempts": attempts.count(),
            "average_best_score": round(sum(r["best"] for r in per_learner) / takers) if takers else None,
            "average_attempts": round(sum(r["tries"] for r in per_learner) / takers, 1) if takers else None,
            "first_try_pass_percent": _percent(sum(1 for p in first_attempts if p), takers),
            "pass_percent": _percent(sum(1 for r in per_learner if r["best"] >= lesson.pass_mark_percent), takers),
        })

    can_see_earnings = is_platform_admin(viewer) or program.provider_id == getattr(viewer, "pk", None)
    return {
        "learners": {
            "total": started_count,
            "awaiting_payment": by_status.get("PAYMENT_PENDING", 0),
            "enrolled": by_status.get("ENROLLED", 0),
            "in_progress": by_status.get("IN_PROGRESS", 0),
            "completed": completed,
            "dropped": by_status.get("DROPPED", 0),
            "completion_percent": _percent(completed, started_count),
            "certificates": enrollments.filter(certificate_code__isnull=False).count(),
        },
        "lesson_funnel": funnel,
        "quizzes": quizzes,
        "rating": rating_summary(program),
        "earnings": _earnings(program) if can_see_earnings else None,
    }


def _earnings(program) -> dict:
    from transactions.models import EscrowStatus, PaymentEscrow

    escrows = PaymentEscrow.objects.filter(booking__training_enrollment__program=program)
    totals = escrows.aggregate(
        paid=Sum("gross_amount_xaf"),
        held=Sum("gross_amount_xaf", filter=Q(status__in=[EscrowStatus.HELD, EscrowStatus.DISPUTED])),
        to_you=Sum("payee_amount_xaf", filter=Q(status=EscrowStatus.RELEASED)),
        fees=Sum("platform_fee_xaf", filter=Q(status=EscrowStatus.RELEASED)),
        refunded=Sum("refunded_amount_xaf"),
        sales=Count("id"),
    )
    def money(value) -> str:
        return f"{Decimal(value or 0):.2f}"  # same format whatever the database returns for a sum

    return {
        "sales": totals["sales"],
        "paid_by_learners_xaf": money(totals["paid"]),
        "held_in_escrow_xaf": money(totals["held"]),
        "released_to_trainer_xaf": money(totals["to_you"]),
        "platform_fees_xaf": money(totals["fees"]),
        "refunded_xaf": money(totals["refunded"]),
    }
