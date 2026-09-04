"""
engagement.services — Part B: composing a WhatsApp deep link with a
guaranteed-compliant message, and logging the outbound action.
"""
from urllib.parse import quote

APP_NAME = "Oaziland"


def build_whatsapp_action(*, context: str, triggered_by, target_object, recipient_phone: str, template_vars: dict = None):
    """Builds a wa.me deep link with a message that ALWAYS names the
    source (Oaziland), the reason (from the admin-configurable
    template), and includes a link to the target — regardless of what
    an admin's template wording says, per the spec's explicit
    requirement that every message include all three.

    Returns {deep_link, message, action_log}.
    """
    from .models import WhatsAppMessageTemplate, ActionLog

    try:
        template = WhatsAppMessageTemplate.objects.get(context=context, is_active=True)
        reason = template.reason_template.format(**(template_vars or {}))
    except WhatsAppMessageTemplate.DoesNotExist:
        reason = "I'm reaching out about something on " + APP_NAME

    target_content_type = f"{target_object._meta.app_label}.{target_object.__class__.__name__}"
    target_link = f"https://oaziland.com/{target_content_type.lower()}/{target_object.id}"

    # The source and link are appended HERE, structurally — never left
    # to the admin-edited reason_template to include or omit.
    message = f"{reason} on {APP_NAME} — here's the link: {target_link}"

    clean_phone = recipient_phone.replace("+", "").replace(" ", "")
    deep_link = f"https://wa.me/{clean_phone}?text={quote(message)}"

    action_log = ActionLog.objects.create(
        context=context, triggered_by=triggered_by,
        target_content_type=target_content_type, target_id=target_object.id,
        recipient_phone=recipient_phone, generated_message=message,
    )

    return {"deep_link": deep_link, "message": message, "action_log": action_log}


# ---------------------------------------------------------------------------
# Block/unblock — actually filters search/inbox, not just a flag.
# ---------------------------------------------------------------------------
def block_user(*, blocker, blocked):
    from .models import BlockRelationship
    relationship, _ = BlockRelationship.objects.get_or_create(blocker=blocker, blocked=blocked)
    return relationship


def unblock_user(*, blocker, blocked):
    from .models import BlockRelationship
    BlockRelationship.objects.filter(blocker=blocker, blocked=blocked).delete()


def is_blocked(*, blocker, blocked) -> bool:
    from .models import BlockRelationship
    return BlockRelationship.objects.filter(blocker=blocker, blocked=blocked).exists()


def exclude_blocked_users(queryset, viewer, author_field="author"):
    """Filters a queryset (posts, listings, messages...) to remove
    anything authored by someone the viewer has blocked — THE actual
    enforcement the spec asks for: 'block actually filters that user out
    of the blocker's search/inbox queries', not merely a stored
    relationship nothing reads."""
    from .models import BlockRelationship
    blocked_ids = BlockRelationship.objects.filter(blocker=viewer).values_list("blocked_id", flat=True)
    return queryset.exclude(**{f"{author_field}_id__in": list(blocked_ids)})


# ---------------------------------------------------------------------------
# Verification requests.
# ---------------------------------------------------------------------------
def submit_verification_request(*, requester, request_type: str, subject, supporting_document_url: str = ""):
    from .models import VerificationRequest
    content_type = f"{subject._meta.app_label}.{subject.__class__.__name__}"
    return VerificationRequest.objects.create(
        requester=requester, request_type=request_type,
        subject_content_type=content_type, subject_id=subject.id,
        supporting_document_url=supporting_document_url,
    )


def review_verification_request(*, request, reviewer, approved: bool):
    from django.utils import timezone
    from .models import VerificationRequestStatus
    request.status = VerificationRequestStatus.APPROVED if approved else VerificationRequestStatus.REJECTED
    request.reviewed_by = reviewer
    request.reviewed_at = timezone.now()
    request.save(update_fields=["status", "reviewed_by", "reviewed_at"])
    return request


def is_verified(subject) -> bool:
    from .models import VerificationRequest, VerificationRequestStatus
    content_type = f"{subject._meta.app_label}.{subject.__class__.__name__}"
    return VerificationRequest.objects.filter(
        subject_content_type=content_type, subject_id=subject.id, status=VerificationRequestStatus.APPROVED,
    ).exists()


# ---------------------------------------------------------------------------
# Bookmarks (generalizing social.Favorite to jobs/trainings/marketplace).
# ---------------------------------------------------------------------------
def add_bookmark(*, user, bookmark_type: str, target):
    from .models import Bookmark
    content_type = f"{target._meta.app_label}.{target.__class__.__name__}"
    bookmark, _ = Bookmark.objects.get_or_create(
        user=user, target_content_type=content_type, target_id=target.id,
        defaults={"bookmark_type": bookmark_type},
    )
    return bookmark


def remove_bookmark(*, user, target):
    from .models import Bookmark
    content_type = f"{target._meta.app_label}.{target.__class__.__name__}"
    Bookmark.objects.filter(user=user, target_content_type=content_type, target_id=target.id).delete()


# ---------------------------------------------------------------------------
# Events.
# ---------------------------------------------------------------------------
def register_for_event(*, event, attendee):
    from .models import EventAttendance
    attendance, _ = EventAttendance.objects.get_or_create(event=event, attendee=attendee)
    return attendance


# ---------------------------------------------------------------------------
# Account deletion — retention-policy compliant, not instant.
# ---------------------------------------------------------------------------
ACCOUNT_DELETION_RETENTION_DAYS = 30


def request_account_deletion(user):
    from django.utils import timezone
    from datetime import timedelta
    from .models import AccountDeletionRequest
    return AccountDeletionRequest.objects.create(
        user=user, retention_expires_at=timezone.now() + timedelta(days=ACCOUNT_DELETION_RETENTION_DAYS),
    )


def cancel_account_deletion(request):
    from .models import AccountDeletionStatus
    request.status = AccountDeletionStatus.CANCELLED
    request.save(update_fields=["status"])
    return request


def process_due_account_deletions(now=None):
    """After the retention window passes, actually soft-deletes the
    account via the EXISTING User.deleted_at field — reuses the
    already-established soft-delete mechanism rather than inventing a
    second one."""
    from django.utils import timezone
    from .models import AccountDeletionRequest, AccountDeletionStatus

    now = now or timezone.now()
    due = AccountDeletionRequest.objects.filter(
        status=AccountDeletionStatus.REQUESTED, retention_expires_at__lte=now,
    )
    completed = []
    for request in due:
        request.user.deleted_at = now
        request.user.save(update_fields=["deleted_at"])
        request.status = AccountDeletionStatus.COMPLETED
        request.completed_at = now
        request.save(update_fields=["status", "completed_at"])
        completed.append(request)
    return completed


# ---------------------------------------------------------------------------
# Support — the AI agent first, real human escalation when needed.
# ---------------------------------------------------------------------------
def create_support_ticket(*, user, subject: str, first_message: str):
    """Creates a ticket, logs the user's first message, and immediately
    gets an AI response — escalating to a human automatically if the AI
    can't help or the user asks for one."""
    from .models import SupportTicket, SupportMessage, SupportTicketStatus
    from .support_agent import get_active_support_agent_provider

    ticket = SupportTicket.objects.create(submitted_by=user, subject=subject)
    SupportMessage.objects.create(ticket=ticket, sender_type=SupportMessage.SenderType.USER, sender_user=user, text=first_message)

    provider = get_active_support_agent_provider()
    reply = provider.generate_response(ticket_subject=subject, conversation_history=[], latest_message=first_message)
    SupportMessage.objects.create(ticket=ticket, sender_type=SupportMessage.SenderType.AI_AGENT, text=reply.response_text)

    if reply.should_escalate_to_human:
        escalate_ticket_to_human(ticket)

    return ticket


def escalate_ticket_to_human(ticket):
    from .models import SupportTicketStatus
    ticket.ai_handled = False
    ticket.status = SupportTicketStatus.IN_PROGRESS
    ticket.save(update_fields=["ai_handled", "status"])
    return ticket


def respond_as_human_agent(*, ticket, agent, text: str):
    from .models import SupportMessage
    return SupportMessage.objects.create(ticket=ticket, sender_type=SupportMessage.SenderType.HUMAN_AGENT, sender_user=agent, text=text)


def resolve_ticket(ticket):
    from django.utils import timezone
    from .models import SupportTicketStatus
    ticket.status = SupportTicketStatus.RESOLVED
    ticket.resolved_at = timezone.now()
    ticket.save(update_fields=["status", "resolved_at"])
    return ticket


# ---------------------------------------------------------------------------
# Gamified badges — explainable rules, no hidden scoring.
# ---------------------------------------------------------------------------
TOP_REVIEWER_MIN_REVIEWS = 10
FIVE_SUCCESSFUL_DEALS_THRESHOLD = 5


def evaluate_badges_for_user(user):
    """Checks every badge rule for a user and awards any newly-earned
    ones. Idempotent — running this repeatedly never re-awards a badge
    already held (the model's unique_together also backstops this)."""
    from django.db.models import Count
    from .models import UserBadge, BadgeCode
    from social.models import Review
    from transactions.models import Booking, BookingStatus
    from identity.models import KYCProfile, VerificationStatus

    newly_awarded = []

    review_count = Review.objects.filter(author=user).count()
    if review_count >= TOP_REVIEWER_MIN_REVIEWS:
        _, created = UserBadge.objects.get_or_create(user=user, badge_code=BadgeCode.TOP_REVIEWER)
        if created:
            newly_awarded.append(BadgeCode.TOP_REVIEWER)

    try:
        if user.kyc_profile.kyc_status == VerificationStatus.VERIFIED:
            _, created = UserBadge.objects.get_or_create(user=user, badge_code=BadgeCode.VERIFIED_RENTER)
            if created:
                newly_awarded.append(BadgeCode.VERIFIED_RENTER)
    except KYCProfile.DoesNotExist:
        pass

    completed_deals = Booking.objects.filter(requester=user, status=BookingStatus.COMPLETED).count()
    if completed_deals >= FIVE_SUCCESSFUL_DEALS_THRESHOLD:
        _, created = UserBadge.objects.get_or_create(user=user, badge_code=BadgeCode.FIVE_SUCCESSFUL_DEALS)
        if created:
            newly_awarded.append(BadgeCode.FIVE_SUCCESSFUL_DEALS)

    return newly_awarded
