"""
careers.peer_review — classmates review each other's assignments, so one trainer isn't the bottleneck.

A lesson with `peer_review` on collects PEER_REVIEWS_REQUIRED verdicts per submission. The author and the reviewers
stay anonymous to each other. A learner can review once they have handed in their own work for that lesson, never
their own submission and each submission only once. When enough reviews are in, the submission is decided:
approved if every reviewer approved, otherwise sent back with the reviewers' comments. Course staff can still
decide any submission at any time (careers.course_services.review_submission), and the usual reminders reach them
if nobody has reviewed a submission after a couple of days (careers.course_reminders).
"""
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone

from .course_services import CourseError, _notify_review, _record_progress
from .models import AssignmentSubmission, PeerReview, SubmissionStatus, TrainingEnrollmentStatus

PEER_REVIEWS_REQUIRED = 2
QUEUE_SIZE = 3
MIN_CHANGES_FEEDBACK_CHARS = 10
ACTIVE = (TrainingEnrollmentStatus.ENROLLED, TrainingEnrollmentStatus.IN_PROGRESS, TrainingEnrollmentStatus.COMPLETED)


def _require_reviewer(enrollment, lesson):
    if enrollment.status not in ACTIVE:
        raise CourseError("You can't review work in a course you're no longer enrolled in.")
    if not lesson.peer_review:
        raise CourseError("This assignment isn't reviewed by classmates.")
    if not AssignmentSubmission.objects.filter(enrollment=enrollment, lesson=lesson).exists():
        raise CourseError("Hand in your own work first, then you can review a classmate's.")


def _open_submissions(enrollment, lesson):
    """Submissions of this lesson still waiting for peer reviews that this learner may review."""
    already = PeerReview.objects.filter(reviewer=enrollment).values("submission_id")
    return (
        AssignmentSubmission.objects.filter(
            lesson=lesson, status=SubmissionStatus.SUBMITTED, enrollment__status__in=ACTIVE,
        )
        .exclude(enrollment=enrollment).exclude(pk__in=already)
        .annotate(reviews=Count("peer_reviews")).filter(reviews__lt=PEER_REVIEWS_REQUIRED)
        .order_by("reviews", "submitted_at")
    )


def review_queue(enrollment, lesson) -> list[dict]:
    """A few classmates' submissions to review, the ones with the fewest reviews first. Anonymous: no names."""
    _require_reviewer(enrollment, lesson)
    return [
        {"id": str(s.id), "submitted_at": s.submitted_at, "reviews": s.reviews}
        for s in _open_submissions(enrollment, lesson)[:QUEUE_SIZE]
    ]


def reviewable_submission(enrollment, submission_id) -> AssignmentSubmission:
    """The submission, if this learner is allowed to read and review it (raises CourseError otherwise)."""
    submission = (
        AssignmentSubmission.objects.select_related("lesson", "enrollment")
        .filter(pk=submission_id, lesson__module__program=enrollment.program).first()
    )
    if submission is None:
        raise CourseError("This work is not part of the course.")
    _require_reviewer(enrollment, submission.lesson)
    if submission.enrollment_id == enrollment.pk:
        raise CourseError("You can't review your own work.")
    return submission


def _summary(reviews) -> str:
    return "\n".join(f"• {r.feedback.strip()}" for r in reviews if r.feedback.strip())


def _decide(submission):
    reviews = list(submission.peer_reviews.all())
    if len(reviews) < PEER_REVIEWS_REQUIRED or submission.status != SubmissionStatus.SUBMITTED:
        return
    approved = all(r.decision == SubmissionStatus.APPROVED for r in reviews)
    sent_back = [r for r in reviews if r.decision != SubmissionStatus.APPROVED]
    submission.status = SubmissionStatus.APPROVED if approved else SubmissionStatus.CHANGES_REQUESTED
    submission.feedback = _summary(reviews if approved else sent_back)
    submission.reviewed_by = None  # decided by classmates, not by a person on the course team
    submission.reviewed_at = timezone.now()
    submission.save(update_fields=["status", "feedback", "reviewed_by", "reviewed_at"])
    enrollment = submission.enrollment
    if approved and enrollment.status in (TrainingEnrollmentStatus.ENROLLED, TrainingEnrollmentStatus.IN_PROGRESS):
        _record_progress(enrollment, submission.lesson)
    _notify_review(submission)


def submit_peer_review(enrollment, submission_id, *, decision: str, feedback: str = "") -> AssignmentSubmission:
    if decision not in (SubmissionStatus.APPROVED, SubmissionStatus.CHANGES_REQUESTED):
        raise CourseError("Choose approve or request changes.")
    feedback = (feedback or "").strip()[:2000]
    if decision == SubmissionStatus.CHANGES_REQUESTED and len(feedback) < MIN_CHANGES_FEEDBACK_CHARS:
        raise CourseError("Tell your classmate what should change, in a few words.")
    submission = reviewable_submission(enrollment, submission_id)
    with transaction.atomic():
        submission = AssignmentSubmission.objects.select_for_update().select_related("lesson", "enrollment__program").get(pk=submission.pk)
        if submission.status != SubmissionStatus.SUBMITTED:
            raise CourseError("This work has already been reviewed.")
        try:
            with transaction.atomic():
                PeerReview.objects.create(submission=submission, reviewer=enrollment, decision=decision, feedback=feedback)
        except IntegrityError:
            raise CourseError("You have already reviewed this work.")
        _decide(submission)
    return submission
