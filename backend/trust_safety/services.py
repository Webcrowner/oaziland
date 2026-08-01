"""
trust_safety.services — the actual ENFORCEMENT that makes moderation
mean something: scoring content before it goes live, and applying real
account consequences once someone accumulates strikes.

POLICY FLAG FOR THE FOUNDER (per Standing Rule 4 — this is a real policy
decision, not just a technical detail): the strike thresholds below (3 =
temporary suspension, 5 = permanent ban) are implemented exactly as
Prompt 9 specified. Please explicitly confirm this is the policy you
want live in production before launch — these numbers are one line to
change, but the human impact of getting them wrong (banning someone too
readily, or not readily enough) is real.
"""
from django.db import transaction as db_transaction

from .moderation_providers import get_active_moderation_provider
from .models import AIModerationResult, ModerationAction, UserWarning, WarningReason


class ContentBlockedError(Exception):
    """Raised when content fails moderation and cannot be published."""


SUSPENSION_STRIKE_THRESHOLD = 3
BAN_STRIKE_THRESHOLD = 5
SUSPENSION_DURATION_DAYS = 7  # length of a temporary suspension


def score_text(text: str, *, target_post=None, target_listing_id=None, target_comment=None) -> list:
    """Runs text through the active moderation provider and records
    EVERY result — even 'allow' results are saved, so there's a complete
    audit trail proving a piece of content WAS checked, not just an
    absence of records for content that happened to be fine."""
    provider = get_active_moderation_provider()
    scores = provider.analyze_text(text)
    return [_save_result(s, target_post, target_listing_id, target_comment) for s in scores]


def score_image(image_url: str, *, target_post=None, target_listing_id=None, target_comment=None) -> list:
    provider = get_active_moderation_provider()
    scores = provider.analyze_image(image_url)
    return [_save_result(s, target_post, target_listing_id, target_comment) for s in scores]


def _save_result(score, target_post, target_listing_id, target_comment) -> AIModerationResult:
    return AIModerationResult.objects.create(
        category=score.category, confidence_score=score.confidence_score, action=score.action,
        model_version="sandbox-v1", target_post=target_post,
        target_listing_id=target_listing_id, target_comment=target_comment,
    )


def _worst_action(results) -> str:
    """If multiple moderation results came back (e.g. text AND images),
    the STRICTEST action wins — one flagged image should block the whole
    post, even if the caption text alone would have been fine."""
    severity_order = [
        ModerationAction.ALLOW, ModerationAction.FLAG_FOR_REVIEW,
        ModerationAction.ESCALATE_ADMIN, ModerationAction.AUTO_REMOVE,
    ]
    worst = ModerationAction.ALLOW
    for result in results:
        if severity_order.index(result.action) > severity_order.index(worst):
            worst = result.action
    return worst


def publish_post_with_moderation(post):
    """THE enforced publish pathway for a Post — this is what real
    application code (API views) should call, not post.publish()
    directly. Runs the caption AND every attached photo/video through
    moderation BEFORE the post goes live; AUTO_REMOVE blocks publishing
    entirely rather than publishing first and cleaning up after."""
    text_results = score_text(post.caption, target_post=post) if post.caption else []

    image_results = []
    for media in post.media.all():
        image_results.extend(score_image(media.file_url, target_post=post))

    worst = _worst_action(text_results + image_results)
    if worst == ModerationAction.AUTO_REMOVE:
        raise ContentBlockedError(
            "This post was automatically blocked by content moderation and cannot be published."
        )

    post.publish()
    return worst  # caller can still see FLAG_FOR_REVIEW/ESCALATE_ADMIN even though it published


def publish_listing_with_moderation(listing):
    """The enforced publish pathway for a Listing — same principle as
    posts: description is scored before the listing goes live."""
    description = getattr(listing.property_asset, "description", "") or ""
    text_results = score_text(description, target_listing_id=listing.id) if description else []

    worst = _worst_action(text_results)
    if worst == ModerationAction.AUTO_REMOVE:
        raise ContentBlockedError(
            "This listing was automatically blocked by content moderation and cannot be published."
        )

    listing.publish()
    return worst


def issue_strike_and_apply_consequences(*, subject, reason: str, issued_by=None) -> UserWarning:
    """Issues the next strike AND applies the real account consequence —
    see the POLICY FLAG at the top of this file. This is what makes
    UserWarning mean something beyond a log entry nobody acts on."""
    from django.utils import timezone
    from identity.models import AccountStatus

    with db_transaction.atomic():
        warning = UserWarning.issue_next_strike(subject=subject, reason=reason, issued_by=issued_by)

        if warning.strike_number >= BAN_STRIKE_THRESHOLD:
            subject.account_status = AccountStatus.BANNED
            subject.suspended_until = None
            subject.save(update_fields=["account_status", "suspended_until"])
        elif warning.strike_number >= SUSPENSION_STRIKE_THRESHOLD:
            subject.account_status = AccountStatus.SUSPENDED
            subject.suspended_until = timezone.now() + timezone.timedelta(days=SUSPENSION_DURATION_DAYS)
            subject.save(update_fields=["account_status", "suspended_until"])

    return warning
