"""
property.place_reviews — public reviews of student hostels and event venues, written only by real customers.

- A student hostel can be reviewed by a student who has (or had) a room there.
- An event venue can be reviewed by an organiser whose confirmed or completed event there has taken place.
One review per person per place. The place's owner is told about each new review; anyone else can report a
review (trust_safety report kinds "hostel_review" and "venue_review").
"""
from django.db import IntegrityError, transaction
from django.db.models import Avg, Q
from django.utils import timezone

MAX_TEXT_LENGTH = 2000


class ReviewError(Exception):
    pass


def _name(user) -> str:
    return (user.full_name or user.username) if user else ""


def _hostel_allocation(hostel, user):
    from student_hostels.models import RoomAllocation, RoomAllocationStatus

    return (
        RoomAllocation.objects.select_related("unit")
        .filter(student=user, unit__building_id=hostel.building_ptr_id, status__in=[RoomAllocationStatus.ACTIVE, RoomAllocationStatus.ENDED])
        .order_by("-allocated_at")
        .first()
    )


def _venue_event(venue, user):
    from events.models import EventBooking, EventBookingStatus

    return (
        EventBooking.objects.filter(
            organiser=user, venue_space__venue=venue, event_date__lte=timezone.localdate(),
            status__in=[EventBookingStatus.CONFIRMED, EventBookingStatus.COMPLETED],
        )
        .order_by("-event_date")
        .first()
    )


def _reviews(kind: str, place):
    if kind == "hostel":
        return place.reviews.select_related("reviewer"), "reviewer", "score", "text"
    return place.reviews.select_related("organiser"), "organiser", "rating", "review_text"


def why_not_reviewable(kind: str, place, user) -> str | None:
    """None when user may write a review of place now, else the reason they can't."""
    if not (user and user.is_authenticated):
        return "sign_in"
    if place.owner_id == user.pk:
        return "own_place"
    queryset, author_field, _, _ = _reviews(kind, place)
    if queryset.filter(**{author_field: user}).exists():
        return "already_reviewed"
    if kind == "hostel" and _hostel_allocation(place, user) is None:
        return "no_stay"
    if kind == "venue" and _venue_event(place, user) is None:
        return "no_event"
    return None


def reviews_payload(kind: str, place, viewer) -> dict:
    queryset, author_field, score_field, text_field = _reviews(kind, place)
    queryset = queryset.order_by("-created_at")
    average = queryset.aggregate(avg=Avg(score_field))["avg"]
    results = []
    for review in queryset[:50]:
        author = getattr(review, author_field)
        results.append({
            "id": str(review.pk), "author_id": str(author.pk), "author_name": _name(author),
            "score": getattr(review, score_field), "text": getattr(review, text_field), "created_at": review.created_at,
            "detail": review.unit_type if kind == "hostel" else review.event_date,
            "is_mine": bool(viewer and viewer.is_authenticated and author.pk == viewer.pk),
        })
    blocked = why_not_reviewable(kind, place, viewer)
    return {
        "count": queryset.count(), "average": round(float(average), 2) if average is not None else None,
        "results": results, "can_review": blocked is None, "cannot_review_reason": blocked or "",
    }


def place_reviews_response(request, kind: str, place):
    """GET: the place's reviews and whether the viewer may add one. POST {score, text}: add the viewer's review."""
    from rest_framework import status as http
    from rest_framework.response import Response

    if request.method == "POST":
        if not request.user.is_authenticated:
            return Response({"detail": "Sign in to write a review."}, status=http.HTTP_401_UNAUTHORIZED)
        try:
            add_review(kind, place, request.user, score=request.data.get("score"), text=str(request.data.get("text", "")))
        except ReviewError as e:
            return Response({"detail": str(e)}, status=http.HTTP_400_BAD_REQUEST)
        return Response(reviews_payload(kind, place, request.user), status=http.HTTP_201_CREATED)
    return Response(reviews_payload(kind, place, request.user))


def add_review(kind: str, place, user, *, score, text: str = ""):
    """Saves user's review of place (kind "hostel" or "venue") and tells the owner."""
    try:
        score = int(score)
    except (TypeError, ValueError):
        raise ReviewError("Choose a score from 1 to 5 stars.")
    if not 1 <= score <= 5:
        raise ReviewError("Choose a score from 1 to 5 stars.")
    text = (text or "").strip()
    if len(text) > MAX_TEXT_LENGTH:
        raise ReviewError("Your review must be 2000 characters or fewer.")
    reason = why_not_reviewable(kind, place, user)
    if reason:
        raise ReviewError({
            "own_place": "You can't review your own place.",
            "already_reviewed": "You have already reviewed this place.",
            "no_stay": "Only students who have had a room here can review this hostel.",
            "no_event": "Only organisers whose event here has taken place can review this venue.",
        }.get(reason, "Sign in to write a review."))

    try:
        with transaction.atomic():
            if kind == "hostel":
                from student_hostels.models import HostelManagementContract, HostelReview

                today = timezone.localdate()
                contract = HostelManagementContract.objects.filter(
                    Q(end_date__isnull=True) | Q(end_date__gte=today), hostel=place, revoked_at__isnull=True, start_date__lte=today,
                ).select_related("manager").first()
                review = HostelReview.objects.create(
                    reviewer=user, hostel=place, unit_type=_hostel_allocation(place, user).unit.unit_type,
                    manager=contract.manager if contract else None, score=score, text=text,
                )
            else:
                from events.models import VenueReview

                review = VenueReview.objects.create(
                    venue=place, organiser=user, rating=score, review_text=text, event_date=_venue_event(place, user).event_date,
                )
    except IntegrityError:
        raise ReviewError("You have already reviewed this place.")

    from notifications.services import notify

    label = "hostel" if kind == "hostel" else "venue"
    notify(
        recipient=place.owner, notification_type="NEW_REVIEW", title=f"New review of your {label}",
        message=f"{_name(user)} gave your {label} {score}/5." + (f" \u201c{text[:140]}\u201d" if text else ""),
        related_reference=str(place.pk),
    )
    return review
