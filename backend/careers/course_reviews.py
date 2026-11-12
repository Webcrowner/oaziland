"""
careers.course_reviews — learners rate and review courses they've actually taken.

A learner may review a course once they have started it (at least one lesson done) or completed it; a course
without lessons can only be reviewed after completion. One review per enrollment, which they can update.
"""
from django.db.models import Avg, Count

MAX_TEXT_LENGTH = 2000


class CourseReviewError(Exception):
    pass


def _enrollment(program, user):
    from .models import TrainingEnrollment
    if not (user and user.is_authenticated):
        return None
    return TrainingEnrollment.objects.filter(program=program, student=user).first()


def why_cannot_review(program, user) -> str | None:
    """None when user may write (or update) their review of program now, else the reason they can't."""
    from .models import LessonProgress, TrainingEnrollmentStatus

    if not (user and user.is_authenticated):
        return "sign_in"
    if program.provider_id == user.pk:
        return "own_course"
    enrollment = _enrollment(program, user)
    if enrollment is None or enrollment.status in (TrainingEnrollmentStatus.PAYMENT_PENDING, TrainingEnrollmentStatus.DROPPED):
        return "not_enrolled"
    if enrollment.status == TrainingEnrollmentStatus.COMPLETED:
        return None
    if not LessonProgress.objects.filter(enrollment=enrollment).exists():
        return "not_started"
    return None


def rating_summary(program) -> dict:
    data = program.reviews.aggregate(average=Avg("score"), count=Count("id"))
    return {
        "average": round(float(data["average"]), 1) if data["average"] is not None else None,
        "count": data["count"],
    }


def _review_json(review, viewer) -> dict:
    student = review.enrollment.student
    return {
        "id": str(review.id), "score": review.score, "text": review.text,
        "author_name": student.full_name or student.username,
        "completed": review.enrollment.status == "COMPLETED",
        "created_at": review.created_at, "updated_at": review.updated_at,
        "is_mine": bool(viewer and viewer.is_authenticated and student.pk == viewer.pk),
    }


def reviews_payload(program, viewer) -> dict:
    reviews = program.reviews.select_related("enrollment__student").order_by("-updated_at")
    mine = next((r for r in reviews if viewer and viewer.is_authenticated and r.enrollment.student_id == viewer.pk), None)
    reason = why_cannot_review(program, viewer)
    return {
        **rating_summary(program),
        "distribution": {str(s): reviews.filter(score=s).count() for s in range(5, 0, -1)},
        "results": [_review_json(r, viewer) for r in reviews[:50]],
        "my_review": _review_json(mine, viewer) if mine else None,
        "can_review": reason is None,
        "cannot_review_reason": reason or "",
    }


def save_review(program, user, *, score, text: str = ""):
    """Creates or updates user's review of program; the provider is told about new reviews."""
    from .models import CourseReview

    try:
        score = int(score)
    except (TypeError, ValueError):
        raise CourseReviewError("Choose a score from 1 to 5 stars.")
    if not 1 <= score <= 5:
        raise CourseReviewError("Choose a score from 1 to 5 stars.")
    text = (text or "").strip()
    if len(text) > MAX_TEXT_LENGTH:
        raise CourseReviewError("Your review must be 2000 characters or fewer.")
    reason = why_cannot_review(program, user)
    if reason:
        raise CourseReviewError({
            "own_course": "You can't review your own course.",
            "not_enrolled": "Only learners enrolled in this course can review it.",
            "not_started": "Complete at least one lesson before reviewing this course.",
        }.get(reason, "Sign in to review this course."))

    review, created = CourseReview.objects.update_or_create(
        enrollment=_enrollment(program, user), defaults={"program": program, "score": score, "text": text},
    )
    if created:
        from .services import _in_language, _send
        learner = user.full_name or user.username
        provider = program.provider
        quote = f" \u201c{text[:140]}\u201d" if text else ""
        _send(
            recipient=provider, notification_type="NEW_REVIEW",
            title=_in_language(provider, "New review of your course", "Nouvel avis sur votre formation"),
            message=_in_language(
                provider,
                f"{learner} gave \"{program.title}\" {score}/5.{quote}",
                f"{learner} a donné {score}/5 à « {program.title} ».{quote}",
            ),
            related_reference=str(program.pk),
        )
    return review


def delete_review(program, user) -> bool:
    from .models import CourseReview
    enrollment = _enrollment(program, user)
    if enrollment is None:
        return False
    deleted, _ = CourseReview.objects.filter(enrollment=enrollment).delete()
    return bool(deleted)
