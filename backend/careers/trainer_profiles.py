"""
careers.trainer_profiles — a trainer's public page: who they are and what they teach.

A trainer is anyone who offers (provider) or lectures a published course. Their page shows their name and photo from
their account, the headline/bio/website they write themselves, their published courses, and combined stats.
"""
from django.db.models import Avg, Count, Q

MAX_BIO = 3000


class TrainerProfileError(Exception):
    pass


def taught_programs(user):
    from .models import CourseStaffRole, TrainingProgram
    return TrainingProgram.objects.filter(
        Q(provider=user) | Q(staff__user=user, staff__role=CourseStaffRole.LECTURER), is_published=True,
    ).distinct()


def public_profile(user, request) -> dict | None:
    """None when user doesn't teach any published course (so there's no public trainer page)."""
    from .models import CourseReview, TrainerProfile, TrainingEnrollment
    from .serializers import ACTIVE_LEARNER_STATUSES, TrainingProgramSerializer
    from .views import _with_catalogue_stats

    programs = taught_programs(user)
    if not programs.exists():
        return None
    profile = TrainerProfile.objects.filter(user=user).first()
    ratings = CourseReview.objects.filter(program__in=programs).aggregate(average=Avg("score"), count=Count("id"))
    courses = _with_catalogue_stats(programs.select_related("provider", "event")).order_by("title")
    return {
        "id": str(user.pk),
        "name": user.full_name or user.username,
        "photo_url": user.profile_image_url,
        "headline": profile.headline if profile else "",
        "bio": profile.bio if profile else "",
        "website": profile.website if profile else "",
        "stats": {
            "courses": programs.count(),
            "learners": TrainingEnrollment.objects.filter(program__in=programs, status__in=ACTIVE_LEARNER_STATUSES)
                        .values("student").distinct().count(),
            "rating_average": round(float(ratings["average"]), 1) if ratings["average"] is not None else None,
            "rating_count": ratings["count"],
        },
        "courses": TrainingProgramSerializer(courses, many=True, context={"request": request}).data,
    }


def my_profile_payload(user) -> dict:
    from .models import TrainerProfile
    profile = TrainerProfile.objects.filter(user=user).first()
    return {
        "id": str(user.pk),
        "headline": profile.headline if profile else "",
        "bio": profile.bio if profile else "",
        "website": profile.website if profile else "",
        "is_trainer": taught_programs(user).exists(),
    }


def save_my_profile(user, data) -> dict:
    from django.core.exceptions import ValidationError
    from django.core.validators import URLValidator
    from .models import TrainerProfile

    headline = str(data.get("headline", "")).strip()
    bio = str(data.get("bio", "")).strip()
    website = str(data.get("website", "")).strip()
    if len(headline) > 160:
        raise TrainerProfileError("The headline must be 160 characters or fewer.")
    if len(bio) > MAX_BIO:
        raise TrainerProfileError(f"The bio must be {MAX_BIO} characters or fewer.")
    if website:
        try:
            URLValidator(schemes=["http", "https"])(website)
        except ValidationError:
            raise TrainerProfileError("Enter a full website address starting with https://")
    TrainerProfile.objects.update_or_create(user=user, defaults={"headline": headline, "bio": bio, "website": website})
    return my_profile_payload(user)
