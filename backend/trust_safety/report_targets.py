"""
trust_safety.report_targets — the things users can report beyond posts, listings and people.

Each kind knows how to find its item, who is responsible for it (the person a confirmed report strikes and
who cannot report it themselves), how to describe it to an admin, and how to take it down:
  - places (hotel, guest house, event venue, student hostel) are hidden from the public via deleted_at;
  - job postings are closed;
  - comments and reviews are deleted (the report keeps a copy of the text in its notes).
"""
from dataclasses import dataclass
from typing import Callable

from django.core.exceptions import ValidationError
from django.db.models import Q
from django.utils import timezone


def _name(user) -> str:
    return (user.full_name or user.username) if user else ""


def _snippet(text: str, limit: int = 160) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "\u2026"


def _hide_place(place) -> str:
    # deleted_at alone hides it; "verified" is left alone so the place doesn't land in the verification queue.
    place.deleted_at = timezone.now()
    place.save(update_fields=["deleted_at"])
    return "hidden"


def _close_job(job) -> str:
    job.status = "CLOSED"
    job.save(update_fields=["status"])
    return "closed"


def _delete(item) -> str:
    item.delete()
    return "deleted"


def _remove_intro_video(agent_profile) -> str:
    agent_profile.intro_video_url, agent_profile.intro_video_seconds, agent_profile.intro_video_uploaded_at = "", None, None
    agent_profile.save(update_fields=["intro_video_url", "intro_video_seconds", "intro_video_uploaded_at"])
    return "hidden"


def _post_path(post) -> str:
    return f"/videos/{post.id}" if post.media.filter(media_type="VIDEO").exists() else ""


@dataclass(frozen=True)
class Kind:
    load: Callable  # id -> item or None
    owner: Callable  # item -> user responsible
    label: str  # how the owner's notification names it
    title: Callable
    excerpt: Callable
    path: Callable
    available: Callable
    take_down: Callable  # item -> "hidden" | "closed" | "deleted"
    key: Callable = lambda item: item.pk  # the id a report stores for the item


def _loader(model_path: str, *related: str):
    def load(object_id):
        from django.apps import apps

        model = apps.get_model(model_path)
        try:
            return model.objects.select_related(*related).filter(pk=object_id).first()
        except (ValueError, TypeError, ValidationError):
            return None
    return load


def _place(model_path: str, url: str, label: str) -> Kind:
    return Kind(
        load=_loader(model_path, "owner", "quarter"), owner=lambda p: p.owner, label=label,
        title=lambda p: getattr(p, "name", "") or str(p), excerpt=lambda p: _snippet(p.description),
        path=lambda p: f"/{url}/{p.pk}", available=lambda p: p.deleted_at is None, take_down=_hide_place,
    )


KINDS: dict[str, Kind] = {
    "hotel": _place("hotels.Hotel", "hotels", "hotel"),
    "guest_house": _place("property.GuestHouseLodge", "guest-houses", "guest house"),
    "venue": _place("events.Venue", "events", "event venue"),
    "student_hostel": _place("student_hostels.StudentHostel", "student-hostels", "student hostel"),
    "job_posting": Kind(
        load=_loader("careers.JobPosting", "posted_by"), owner=lambda j: j.posted_by, label="job posting",
        title=lambda j: j.title, excerpt=lambda j: _snippet(j.description), path=lambda j: "/careers",
        available=lambda j: j.status == "OPEN", take_down=_close_job,
    ),
    "comment": Kind(
        load=_loader("social.Comment", "author", "post"), owner=lambda c: c.author, label="comment",
        title=lambda c: "", excerpt=lambda c: _snippet(c.text), path=lambda c: _post_path(c.post),
        available=lambda c: True, take_down=_delete,
    ),
    "review": Kind(
        load=_loader("social.Review", "author"), owner=lambda r: r.author, label="review",
        title=lambda r: f"{r.score}\u2605", excerpt=lambda r: _snippet(r.text), path=lambda r: "/testimonials",
        available=lambda r: True, take_down=_delete,
    ),
    "service_review": Kind(
        load=_loader("services.ServiceReview", "author", "subject"), owner=lambda r: r.author, label="review",
        title=lambda r: f"{r.score}\u2605 \u00b7 {_name(r.subject)}", excerpt=lambda r: _snippet(r.comment),
        path=lambda r: "", available=lambda r: True, take_down=_delete,
    ),
    "hostel_review": Kind(
        load=_loader("student_hostels.HostelReview", "reviewer", "hostel__quarter"), owner=lambda r: r.reviewer,
        label="review", title=lambda r: f"{r.score}\u2605 \u00b7 {r.hostel}", excerpt=lambda r: _snippet(r.text),
        path=lambda r: f"/student-hostels/{r.hostel_id}", available=lambda r: True, take_down=_delete,
    ),
    "venue_review": Kind(
        load=_loader("events.VenueReview", "organiser", "venue__quarter"), owner=lambda r: r.organiser,
        label="review", title=lambda r: f"{r.rating}\u2605 \u00b7 {r.venue}", excerpt=lambda r: _snippet(r.review_text),
        path=lambda r: f"/events/{r.venue_id}", available=lambda r: True, take_down=_delete,
    ),
    "caterer_review": Kind(
        load=_loader("events.CatererReview", "organiser", "caterer"), owner=lambda r: r.organiser,
        label="review", title=lambda r: f"{r.score}\u2605 \u00b7 {r.caterer.name}", excerpt=lambda r: _snippet(r.review_text),
        path=lambda r: "", available=lambda r: True, take_down=_delete,
    ),
    # Named by the agent's user id, since that is what the public profile page shows.
    "agent_video": Kind(
        load=lambda user_id: _agent_profile_by_user(user_id),
        owner=lambda a: a.user, label="intro video", title=lambda a: _name(a.user),
        excerpt=lambda a: a.intro_video_url, path=lambda a: f"/agents/{a.user_id}",
        available=lambda a: bool(a.intro_video_url), take_down=_remove_intro_video, key=lambda a: a.user_id,
    ),
}


def _agent_profile_by_user(user_id):
    from identity.models import AgentProfile

    try:
        return AgentProfile.objects.select_related("user").filter(user_id=user_id).first()
    except (ValueError, TypeError, ValidationError):
        return None


def describe(kind: str, object_id: str) -> dict | None:
    """The admin queue's description of a reported item, or None when it no longer exists."""
    spec = KINDS.get(kind)
    item = spec.load(object_id) if spec else None
    if item is None:
        return None
    owner = spec.owner(item)
    return {
        "type": kind, "title": spec.title(item), "excerpt": spec.excerpt(item) or "",
        "author_id": str(owner.pk) if owner else None, "author_name": _name(owner),
        "path": spec.path(item), "available": bool(spec.available(item)),
    }


def visible_places(queryset, user):
    """Places taken down after a report stay visible only to their owner and to admins."""
    if user.is_authenticated and hasattr(user, "admin_profile"):
        return queryset
    visible = Q(deleted_at__isnull=True)
    if user.is_authenticated:
        visible |= Q(owner=user)
    return queryset.filter(visible)
