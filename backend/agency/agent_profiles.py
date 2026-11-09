"""
agency.agent_profiles — the public, LinkedIn-style face of an agent: who they are, where they work, what they
specialise in, a short intro video, and the listings they have up right now. Also the searchable directory and
the agent's own editing of these details.
"""
from django.db.models import Avg, Count, Prefetch, Q
from django.utils import timezone

PREVIEW_LISTINGS = 3
MAX_BIO_LENGTH = 1500
MAX_AREAS = 15
MAX_INTRO_VIDEO_SECONDS = 5 * 60
MAX_INTRO_VIDEO_BYTES = 300 * 1024 * 1024


class AgentProfileError(Exception):
    pass


def _live_listings(user_ids):
    from property.models import Listing, ListingPhoto, ListingStatus

    return (
        Listing.objects.filter(listed_by_id__in=user_ids, status=ListingStatus.PUBLISHED)
        .select_related("property_asset__quarter")
        .prefetch_related(Prefetch("photos", queryset=ListingPhoto.objects.order_by("-is_primary", "id")))
        .order_by("-published_at", "-created_at")
    )


def listing_card(listing) -> dict:
    asset = listing.property_asset
    photo = next((p for p in listing.photos.all() if p.media_type == "PHOTO"), None)
    return {
        "id": str(listing.pk), "listing_type": listing.listing_type, "price_xaf": f"{listing.price_xaf:.2f}",
        "property_type": asset.type, "quarter_name": asset.quarter.name if asset.quarter_id else "",
        "photo_url": photo.url if photo else "", "path": f"/listing/{listing.pk}",
    }


def agent_listings_page(agent_user, *, offset: int = 0, limit: int = 12) -> dict:
    """All of an agent's live listings, a page at a time ('See more')."""
    queryset = _live_listings([agent_user.pk])
    total = queryset.count()
    items = list(queryset[offset:offset + limit])
    return {"count": total, "results": [listing_card(listing) for listing in items], "next_offset": offset + len(items) if offset + len(items) < total else None}


def _details(agent_profile) -> dict:
    from identity.models import AgentLanguage, AgentSpecialty

    specialties = dict(AgentSpecialty.choices)
    languages = dict(AgentLanguage.choices)
    return {
        "bio": agent_profile.bio,
        "years_experience": agent_profile.years_experience,
        "specialties": [code for code in agent_profile.specialties if code in specialties],
        "languages": [code for code in agent_profile.languages if code in languages],
        "areas_served": [{"id": str(q.pk), "name": q.name} for q in agent_profile.areas_served.all()],
        "intro_video_url": agent_profile.intro_video_url,
        "intro_video_seconds": agent_profile.intro_video_seconds,
    }


def search_agents(*, query: str = "", quarter_id=None, specialty: str = "", language: str = "", verified_only: bool = False):
    """The directory's queryset: agents matching every given filter, best-rated and busiest first."""
    from identity.models import AgentProfile
    from property.models import ListingStatus

    qs = AgentProfile.objects.select_related("user__kyc_profile", "agency__user").prefetch_related("areas_served")
    for term in query.split()[:4]:
        qs = qs.filter(
            Q(user__first_name__icontains=term) | Q(user__last_name__icontains=term) | Q(user__username__icontains=term)
            | Q(agency__user__first_name__icontains=term) | Q(agency__user__last_name__icontains=term)
            | Q(bio__icontains=term) | Q(areas_served__name__icontains=term)
        )
    if quarter_id:
        qs = qs.filter(areas_served__pk=quarter_id)
    if specialty:
        qs = qs.filter(specialties__contains=[specialty]) if _json_contains_supported() else qs.filter(specialties__icontains=f'"{specialty}"')
    if language:
        qs = qs.filter(languages__contains=[language]) if _json_contains_supported() else qs.filter(languages__icontains=f'"{language}"')
    if verified_only:
        qs = qs.filter(user__kyc_profile__kyc_status="VERIFIED")
    return (
        qs.filter(user__is_active=True, user__deleted_at__isnull=True)
        .annotate(
            live_count=Count("user__listings", filter=Q(user__listings__status=ListingStatus.PUBLISHED), distinct=True),
            rating=Avg("user__ratings_received__score"),
        )
        .distinct()
        .order_by("-rating", "-live_count", "-user__date_joined")
    )


def _json_contains_supported() -> bool:
    from django.db import connection

    return connection.vendor == "postgresql"


def directory_rows(agent_profiles) -> list[dict]:
    """Directory cards for a page of agents: profile summary plus their latest few listings."""
    profiles = list(agent_profiles)
    user_ids = [p.user_id for p in profiles]
    previews: dict = {}
    for listing in _live_listings(user_ids):
        bucket = previews.setdefault(listing.listed_by_id, [])
        if len(bucket) < PREVIEW_LISTINGS:
            bucket.append(listing_card(listing))
    from social.models import Rating

    rating_counts = dict(
        Rating.objects.filter(subject_user_id__in=user_ids).values("subject_user_id").annotate(n=Count("pk")).values_list("subject_user_id", "n")
    )
    rows = []
    for profile in profiles:
        user = profile.user
        kyc = getattr(user, "kyc_profile", None)
        rows.append({
            "user_id": str(user.pk),
            "full_name": user.full_name or user.username,
            "profile_image_url": user.profile_image_url,
            "is_kyc_verified": bool(kyc and kyc.kyc_status == "VERIFIED"),
            "agency_name": (profile.agency.user.full_name or profile.agency.user.username) if profile.agency_id else None,
            "average_rating": round(float(profile.rating), 2) if getattr(profile, "rating", None) is not None else None,
            "rating_count": rating_counts.get(user.pk, 0),
            "active_listing_count": getattr(profile, "live_count", 0),
            "listing_preview": previews.get(user.pk, []),
            "has_intro_video": bool(profile.intro_video_url),
            **{key: value for key, value in _details(profile).items() if key not in ("intro_video_url", "intro_video_seconds")},
        })
    return rows


def public_details(agent_user) -> dict:
    """The extra profile details for the agent's public page (bio, areas, video, first listings)."""
    profile = getattr(agent_user, "agent_profile", None)
    if profile is None:
        return {}
    return {
        **_details(profile),
        "profile_image_url": agent_user.profile_image_url,
        "listings": agent_listings_page(agent_user, limit=6),
    }


def update_agent_profile(agent_user, data: dict):
    """The agent edits their own public details. Only the fields given are changed."""
    from geo.models import Quarter
    from identity.models import AgentLanguage, AgentSpecialty
    from trust_safety.moderation_providers import get_active_moderation_provider

    profile = getattr(agent_user, "agent_profile", None)
    if profile is None:
        raise AgentProfileError("Only agents have a professional profile.")
    fields = []

    if "bio" in data:
        bio = (data.get("bio") or "").strip()
        if len(bio) > MAX_BIO_LENGTH:
            raise AgentProfileError("Your bio must be 1500 characters or fewer.")
        if bio and _blocked(get_active_moderation_provider().analyze_text(bio)):
            raise AgentProfileError("Your bio was blocked by the automatic content checks. Please rewrite it.")
        profile.bio = bio
        fields.append("bio")
    if "years_experience" in data:
        years = data.get("years_experience")
        if years in (None, ""):
            profile.years_experience = None
        else:
            try:
                years = int(years)
            except (TypeError, ValueError):
                raise AgentProfileError("Years of experience must be a whole number.")
            if not 0 <= years <= 60:
                raise AgentProfileError("Years of experience must be between 0 and 60.")
            profile.years_experience = years
        fields.append("years_experience")
    if "specialties" in data:
        profile.specialties = _choices(data.get("specialties"), AgentSpecialty, "specialty")
        fields.append("specialties")
    if "languages" in data:
        profile.languages = _choices(data.get("languages"), AgentLanguage, "language")
        fields.append("languages")
    if "intro_video_url" in data:
        _set_intro_video(profile, data.get("intro_video_url") or "", data.get("intro_video_seconds"))
        fields += ["intro_video_url", "intro_video_seconds", "intro_video_uploaded_at"]

    if fields:
        profile.save(update_fields=fields)
    if "areas_served" in data:
        ids = [str(value) for value in (data.get("areas_served") or [])]
        if len(ids) > MAX_AREAS:
            raise AgentProfileError(f"Choose at most {MAX_AREAS} areas.")
        quarters = list(Quarter.objects.filter(pk__in=ids)) if ids else []
        if len(quarters) != len(set(ids)):
            raise AgentProfileError("One of the chosen areas doesn't exist.")
        profile.areas_served.set(quarters)
    return profile


def _choices(values, choices, label: str) -> list:
    values = list(dict.fromkeys(values or []))
    unknown = [value for value in values if value not in choices.values]
    if unknown:
        raise AgentProfileError(f"Unknown {label}: {unknown[0]}.")
    return values


def _blocked(scores) -> bool:
    from trust_safety.models import ModerationAction

    return any(score.action == ModerationAction.AUTO_REMOVE for score in scores)


def _set_intro_video(profile, url: str, seconds):
    from trust_safety.moderation_providers import get_active_moderation_provider
    from uploads.services import is_platform_media_url

    if not url:
        profile.intro_video_url, profile.intro_video_seconds, profile.intro_video_uploaded_at = "", None, None
        return
    if not is_platform_media_url(url):
        raise AgentProfileError("Upload your intro video through Oaziland.")
    try:
        seconds = int(seconds)
    except (TypeError, ValueError):
        raise AgentProfileError("The video's length is missing.")
    if not 1 <= seconds <= MAX_INTRO_VIDEO_SECONDS:
        raise AgentProfileError("Your intro video must be 5 minutes or shorter.")
    if _blocked(get_active_moderation_provider().analyze_image(url)):
        raise AgentProfileError("This video was blocked by the automatic content checks.")
    profile.intro_video_url, profile.intro_video_seconds, profile.intro_video_uploaded_at = url, seconds, timezone.now()
