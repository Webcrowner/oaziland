"""
trust_safety.services — the actual ENFORCEMENT that makes moderation
mean something: scoring content before it goes live, and applying real
account consequences once someone accumulates strikes.

POLICY CONFIRMED BY THE FOUNDER: the strike thresholds below (3 =
temporary suspension, 5 = permanent ban) were explicitly reviewed and
confirmed as the production policy — not left as an unconfirmed
default. Changing them later is still a one-line change, but doing so
should go through the same explicit confirmation this decision did.
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


def get_admin_console_summary():
    """The Admin Console: every queue an admin needs to work through,
    in one place — verification requests, content reports, and dispute
    cases — pulled from their real, existing models rather than a
    separate 'admin summary' table that could drift out of sync.

    reports_trend answers a genuinely different question than the raw
    open-count above: not 'how many reports are open right now' but
    'is the RATE of new reports rising or falling' — the actual signal
    an admin needs to know whether a trust problem is escalating."""
    from .models import ContentReport, ReportStatus
    from property_management.models import DisputeCase, DisputeStatus
    from engagement.models import VerificationRequest, VerificationRequestStatus
    from oaziland.analytics import compute_period_over_period
    from django.db.models import F, Sum, Q
    from property.models import Listing, ListingStatus
    from hotels.models import Hotel
    from events.models import Venue
    from marketplace.models import DriverProfile
    from student_hostels.models import StudentHostel, WelfareAlert
    from identity.models import User, AgentProfile, LandlordProfile, TechnicianProfile, AccountStatus
    from transactions.models import Booking, PaymentEscrow, EscrowStatus
    from monetization.models import WithdrawalRequest, WithdrawalStatus
    from engagement.models import ContactMessage
    from engagement.services import tickets_awaiting_admin
    from .ai_flags import pending_flag_count
    from .payments import stuck_payment_count
    from engagement.models import AccountDeletionRequest, AccountDeletionStatus
    from geo.models import AreaSuggestion, AreaSuggestionStatus

    reports_trend = compute_period_over_period(queryset=ContentReport.objects.all(), date_field="created_at")

    escrow_total = PaymentEscrow.objects.aggregate(t=Sum("gross_amount_xaf"))["t"] or 0
    escrow_held = PaymentEscrow.objects.filter(status=EscrowStatus.HELD).aggregate(t=Sum("gross_amount_xaf"))["t"] or 0
    escrow_released = PaymentEscrow.objects.filter(status=EscrowStatus.RELEASED).aggregate(
        t=Sum(F("gross_amount_xaf") - F("refunded_amount_xaf"))
    )["t"] or 0
    platform_revenue = PaymentEscrow.objects.filter(status=EscrowStatus.RELEASED).aggregate(t=Sum("platform_fee_xaf"))["t"] or 0
    disputed_volume = DisputeCase.objects.filter(
        status__in=[DisputeStatus.OPEN, DisputeStatus.ADMIN_RESPONDED]
    ).aggregate(t=Sum("escrow__gross_amount_xaf"))["t"] or 0

    # Real count of users needing admin attention (suspended/banned, or
    # carrying at least one strike) — computed once here from the
    # actual DB, not by the admin console counting whatever page of
    # users happens to be loaded client-side.
    flagged_users_count = User.objects.filter(
        Q(account_status__in=[AccountStatus.SUSPENDED, AccountStatus.BANNED]) | Q(warnings__isnull=False)
    ).distinct().count()

    return {
        "pending_verification_requests": VerificationRequest.objects.filter(status=VerificationRequestStatus.PENDING).count(),
        "open_content_reports": ContentReport.objects.filter(status=ReportStatus.OPEN).count(),
        "open_dispute_cases": DisputeCase.objects.filter(status__in=[DisputeStatus.OPEN, DisputeStatus.ADMIN_RESPONDED]).count(),
        "pending_property_listings": Listing.objects.filter(status=ListingStatus.PENDING_REVIEW).count(),
        "pending_hotels": Hotel.objects.filter(verified=False).count(),
        "pending_venues": Venue.objects.filter(verified=False).count(),
        "pending_drivers": DriverProfile.objects.filter(is_verified=False).count(),
        "open_welfare_alerts": WelfareAlert.objects.filter(resolved_at__isnull=True).count(),
        "pending_withdrawals": WithdrawalRequest.objects.filter(status=WithdrawalStatus.PENDING).count(),
        "support_tickets_awaiting": tickets_awaiting_admin().count(),
        "open_contact_messages": ContactMessage.objects.filter(resolved=False).count(),
        "ai_flags_pending": pending_flag_count(),
        "pending_area_suggestions": AreaSuggestion.objects.filter(status=AreaSuggestionStatus.PENDING).count(),
        "stuck_payments": stuck_payment_count(),
        "scheduled_account_deletions": AccountDeletionRequest.objects.filter(status=AccountDeletionStatus.REQUESTED).count(),
        "flagged_users_count": flagged_users_count,
        "reports_trend": reports_trend,
        "platform_analytics": {
            "total_users": User.objects.count(),
            "total_agents": AgentProfile.objects.count(),
            "total_landlords": LandlordProfile.objects.count(),
            "total_technicians": TechnicianProfile.objects.count(),
            "total_drivers": DriverProfile.objects.count(),
            "active_listings_count": Listing.objects.filter(status=ListingStatus.PUBLISHED).count(),
            "total_hotels_count": Hotel.objects.count(),
            "total_venues_count": Venue.objects.count(),
            "total_hostels_count": StudentHostel.objects.count(),
            "total_bookings_count": Booking.objects.count(),
            "escrow_volume_xaf": str(escrow_total),
            "escrow_held_xaf": str(escrow_held),
            "escrow_released_xaf": str(escrow_released),
            "platform_revenue_xaf": str(platform_revenue),
            "total_disputed_amount_xaf": str(disputed_volume),
        },
    }


# ---------------------------------------------------------------------------
# Content report resolution — a real gap this closes: ContentReport
# could be FILED, but nothing ever let an admin actually act on one,
# despite REVIEWED/DISMISSED existing as real status values.
# ---------------------------------------------------------------------------
def resolve_content_report(*, report, resolved_by, action_taken: str, issue_strike: bool = False):
    """action_taken is a plain audit note ('removed the post', 'no
    violation found', etc.) — kept as free text rather than a rigid
    enum, since the range of real admin decisions here is wide and a
    fixed set of choices would either be too narrow or grow forever.

    WHY issue_strike is a separate, explicit flag rather than always
    striking the reported person: many reports are dismissed as not
    actually violating anything — automatically striking on every
    report would punish people for being reported, not for actually
    doing something wrong."""
    from django.utils import timezone
    from .models import ReportStatus

    report.status = ReportStatus.REVIEWED if issue_strike else ReportStatus.DISMISSED
    report.notes = f"{report.notes}\n\n[Resolved by admin]: {action_taken}".strip()

    subject = None
    if issue_strike:
        # Confirming a report takes the item down (where it is still up) and strikes whoever is responsible.
        from .content_moderation import ContentActionError, remove_content
        from .models import ContentTakedown

        if report.target_post_id:
            subject = report.target_post.author
            try:
                remove_content(content_type=ContentTakedown.ContentType.POST, content_id=report.target_post_id, reason=action_taken[:500], admin=resolved_by)
            except ContentActionError:
                pass  # already hidden
        elif report.target_comment_id:
            subject = report.target_comment.author
        elif report.target_user_id:
            # A real gap this closes: a report filed directly against
            # a person (an agent, agency, landlord, or owner) had no
            # subject this lookup would ever find — a strike decision
            # on a person-report would have silently done nothing.
            subject = report.target_user
        elif report.target_listing_id:
            # A confirmed marketplace-listing report hides the listing and strikes whoever posted it.
            from marketplace.models import MarketplaceListingBase
            from marketplace.services import take_down_listing
            from property.models import Listing
            listing = MarketplaceListingBase.objects.select_related("lister_user").filter(pk=report.target_listing_id).first()
            if listing is not None:
                take_down_listing(listing.pk)
                subject = listing.lister_user
            else:
                property_listing = Listing.objects.select_related("listed_by").filter(pk=report.target_listing_id).first()
                if property_listing is not None:
                    subject = property_listing.listed_by
                    try:
                        remove_content(
                            content_type=ContentTakedown.ContentType.PROPERTY, content_id=property_listing.pk,
                            reason=action_taken[:500], admin=resolved_by,
                        )
                    except ContentActionError:
                        pass  # not published any more
        elif report.target_kind:
            subject = _take_down_report_target(report, action_taken)

    report.save(update_fields=["status", "notes"])
    if subject:
        issue_strike_and_apply_consequences(subject=subject, reason=action_taken, issued_by=resolved_by)

    return report


def _take_down_report_target(report, reason: str):
    """Removes a reported place, comment, review or job posting, tells its owner, and returns that owner."""
    from .content_moderation import _notify_owner
    from .report_targets import KINDS

    spec = KINDS.get(report.target_kind)
    item = spec.load(report.target_object_id) if spec else None
    if item is None:
        return None
    owner = spec.owner(item)
    if not spec.available(item):
        return owner
    excerpt = spec.excerpt(item)
    name = spec.title(item) if spec.label not in ("comment", "review", "intro video") else ""
    outcome = spec.take_down(item)
    if outcome == "deleted" and excerpt:
        # The item is gone, so the report keeps what it said.
        report.notes = f"{report.notes}\n[Removed {spec.label}]: {excerpt}"
    if owner is not None:
        what = f"Your {spec.label} \u201c{name}\u201d" if name else f"Your {spec.label}"
        _notify_owner(
            owner, title="Your content was removed",
            message=f"{what} was removed by Oaziland moderators after a report. Reason: {reason}", reference=report.target_object_id,
        )
    return owner


# ---------------------------------------------------------------------------
# Real gap this closes: ContentReport had a real model (already
# consumed by AdminContentReportViewSet for RESOLUTION) but zero way
# for a real user to actually file one — only admin resolution of an
# already-existing report was ever built.
# ---------------------------------------------------------------------------
class CannotReportSelfError(Exception):
    pass


class ReportTargetNotFound(Exception):
    pass


def _display_name(user) -> str:
    return (user.full_name or user.username) if user else ""


def _snippet(text: str, limit: int = 160) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "\u2026"


def _post_path(post) -> str:
    """A video post has its own page; a plain post is only visible in the feed."""
    return f"/videos/{post.id}" if post.media.filter(media_type="VIDEO").exists() else ""


def describe_report_target(report) -> dict:
    """What a report is actually about, in words an admin can act on: the kind of thing, a short description
    or excerpt, who posted it (the person a strike would land on), and a page to open it on, when there is one."""
    empty = {"type": "unknown", "title": "", "excerpt": "", "author_id": None, "author_name": "", "path": "", "available": False}

    if report.target_post_id:
        post = report.target_post
        has_video = post.media.filter(media_type="VIDEO").exists()
        return {
            "type": "video" if has_video else "post", "title": "", "excerpt": _snippet(post.caption) or "(no caption)",
            "author_id": str(post.author_id), "author_name": _display_name(post.author), "path": _post_path(post),
            "available": post.status == "PUBLISHED",
        }
    if report.target_comment_id:
        comment = report.target_comment
        return {
            "type": "comment", "title": "", "excerpt": _snippet(comment.text),
            "author_id": str(comment.author_id), "author_name": _display_name(comment.author),
            "path": _post_path(comment.post), "available": True,
        }
    if report.target_user_id:
        user = report.target_user
        return {
            "type": "user", "title": _display_name(user), "excerpt": f"@{user.username}",
            "author_id": str(user.id), "author_name": _display_name(user), "path": f"/user/{user.id}",
            "available": True,
        }
    if report.target_listing_id:
        return _describe_listing(report.target_listing_id, empty)
    if report.target_kind:
        from .report_targets import describe
        return describe(report.target_kind, report.target_object_id) or {**empty, "type": "deleted"}
    return empty


def _describe_listing(listing_id, empty: dict) -> dict:
    from marketplace.models import MarketplaceListingBase
    from marketplace.services import category_models
    from property.models import Listing

    base = MarketplaceListingBase.objects.select_related("lister_user").filter(pk=listing_id).first()
    if base is not None:
        category = next((name for name, model in category_models().items() if model.objects.filter(pk=listing_id).exists()), "")
        return {
            "type": "marketplace_listing", "title": base.title, "excerpt": _snippet(base.description),
            "author_id": str(base.lister_user_id), "author_name": _display_name(base.lister_user),
            "path": f"/marketplace/{category}/{base.id}" if category else "",
            "available": not base.removed_by_moderation,
        }
    listing = Listing.objects.select_related("property_asset__quarter", "listed_by").filter(pk=listing_id).first()
    if listing is not None:
        return {
            "type": "property_listing", "title": str(listing.property_asset), "excerpt": _snippet(listing.property_asset.description),
            "author_id": str(listing.listed_by_id), "author_name": _display_name(listing.listed_by),
            "path": f"/listing/{listing.id}", "available": listing.status == "PUBLISHED",
        }
    return {**empty, "type": "listing_deleted"}


def file_content_report(
    *, reported_by, reason: str, notes: str = "", target_post=None, target_listing_id=None, target_comment=None,
    target_user=None, target_kind: str = "", target_object_id: str = "",
):
    """Exactly one target should be provided — matching the model's
    own documented invariant, enforced here since nothing previously
    checked it (nothing previously created a report at all).
    target_kind + target_object_id name anything in report_targets.KINDS."""
    targets_provided = sum(1 for t in [target_post, target_listing_id, target_comment, target_user, target_kind] if t)
    if targets_provided != 1:
        raise ValueError("Exactly one of target_post, target_listing_id, target_comment, target_user or target_kind must be provided.")
    if target_user is not None and target_user.id == reported_by.id:
        raise CannotReportSelfError("You cannot report yourself.")

    from .models import ContentReport, ReportStatus
    open_reports = ContentReport.objects.filter(reported_by=reported_by, status=ReportStatus.OPEN)
    if target_kind:
        from .report_targets import KINDS
        spec = KINDS.get(target_kind)
        item = spec.load(target_object_id) if spec and target_object_id else None
        if item is None:
            raise ReportTargetNotFound("That item was not found. It may already have been removed.")
        if spec.owner(item) is not None and spec.owner(item).pk == reported_by.pk:
            raise CannotReportSelfError("You cannot report your own content.")
        target_object_id = str(spec.key(item))
        if open_reports.filter(target_kind=target_kind, target_object_id=target_object_id).exists():
            raise ValueError("You have already reported this. Our team is reviewing it.")
    if target_post is not None and target_post.author_id == reported_by.id:
        raise CannotReportSelfError("You cannot report your own post.")
    if target_listing_id:
        from marketplace.models import MarketplaceListingBase
        from property.models import Listing
        if (
            MarketplaceListingBase.objects.filter(pk=target_listing_id, lister_user=reported_by).exists()
            or Listing.objects.filter(pk=target_listing_id, listed_by=reported_by).exists()
        ):
            raise CannotReportSelfError("You cannot report your own listing.")
        if open_reports.filter(target_listing_id=target_listing_id).exists():
            raise ValueError("You have already reported this listing. Our team is reviewing it.")
    return ContentReport.objects.create(
        reported_by=reported_by, reason=reason, notes=notes,
        target_post=target_post, target_listing_id=target_listing_id, target_comment=target_comment, target_user=target_user,
        target_kind=target_kind or "", target_object_id=target_object_id or "",
    )
