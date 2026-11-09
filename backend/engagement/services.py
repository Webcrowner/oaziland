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


def is_blocked_either_way(user_a, user_b) -> bool:
    from django.db.models import Q
    from .models import BlockRelationship
    return BlockRelationship.objects.filter(
        Q(blocker=user_a, blocked=user_b) | Q(blocker=user_b, blocked=user_a)
    ).exists()


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


class VerificationSubmissionError(Exception):
    pass


# Request types about the requester's own professional standing: the subject is the requester's account,
# and they must actually hold the role.
ROLE_REQUEST_PROFILES = {
    "AGENT_VERIFICATION": ("agent_profile", "agent"),
    "AGENCY_VERIFICATION": ("agency_profile", "agency"),
    "LANDLORD_VERIFICATION": ("landlord_profile", "landlord"),
}
MAX_DOCUMENT_URL_LENGTH = 200  # VerificationRequest.supporting_document_url is a URLField with the default limit
ROLE_MISSING_MESSAGES = {
    "AGENT_VERIFICATION": "You do not have an agent account to verify.",
    "AGENCY_VERIFICATION": "You do not have an agency account to verify.",
    "LANDLORD_VERIFICATION": "You do not have a landlord account to verify.",
}


def _resolve_submission_subject(requester, request_type: str, subject_id):
    """The thing a user is asking to have verified, which they must own."""
    from .models import VerificationRequestType as Kind

    if request_type in ROLE_REQUEST_PROFILES:
        profile, role = ROLE_REQUEST_PROFILES[request_type]
        if not hasattr(requester, profile):
            raise VerificationSubmissionError(ROLE_MISSING_MESSAGES[request_type])
        if subject_id and str(subject_id) != str(requester.pk):
            raise VerificationSubmissionError("You can only request verification for your own account.")
        return requester

    if not subject_id:
        raise VerificationSubmissionError("Choose what you want verified.")

    if request_type == Kind.HOSTEL_VERIFICATION:
        from student_hostels.models import StudentHostel
        subject = StudentHostel.objects.filter(pk=subject_id, owner=requester).first()
        missing = "You can only request verification for your own student hostel."
    elif request_type == Kind.GUEST_HOUSE_VERIFICATION:
        from property.models import GuestHouseLodge
        subject = GuestHouseLodge.objects.filter(pk=subject_id, owner=requester).first()
        missing = "You can only request verification for your own guest house."
    elif request_type == Kind.BUSINESS_VERIFICATION:
        from marketplace.models import BusinessListing
        subject = BusinessListing.objects.filter(pk=subject_id, lister_user=requester).first()
        missing = "You can only request verification for your own business listing."
    elif request_type == Kind.VEHICLE_OWNERSHIP:
        from marketplace.models import CarListing
        subject = CarListing.objects.filter(pk=subject_id, lister_user=requester).first()
        missing = "You can only request verification for your own car listing."
    else:
        raise VerificationSubmissionError("Identity is verified through the ID check, not through this form.")
    if subject is None:
        raise VerificationSubmissionError(missing)
    return subject


def eligible_verification_subjects(user) -> list[dict]:
    """What this user could ask to have verified right now: {request_type, subject_id, title, status} where status
    is the latest request's status for it (or "" if never asked)."""
    from .models import VerificationRequest
    from marketplace.models import BusinessListing, CarListing
    from property.models import GuestHouseLodge
    from student_hostels.models import StudentHostel

    options = []
    for request_type, (profile, role) in ROLE_REQUEST_PROFILES.items():
        if hasattr(user, profile):
            options.append((request_type, user.pk, role))
    for hostel in StudentHostel.objects.filter(owner=user).select_related("quarter"):
        options.append(("HOSTEL_VERIFICATION", hostel.pk, hostel.quarter.name))
    for house in GuestHouseLodge.objects.filter(owner=user).select_related("quarter"):
        options.append(("GUEST_HOUSE_VERIFICATION", house.pk, house.quarter.name))
    for listing in BusinessListing.objects.filter(lister_user=user, removed_by_moderation=False):
        options.append(("BUSINESS_VERIFICATION", listing.pk, listing.title))
    for listing in CarListing.objects.filter(lister_user=user, removed_by_moderation=False):
        options.append(("VEHICLE_OWNERSHIP", listing.pk, listing.title))

    latest = {}
    for row in VerificationRequest.objects.filter(requester=user).order_by("submitted_at").values("request_type", "subject_id", "status"):
        latest[(row["request_type"], row["subject_id"])] = row["status"]
    return [
        {"request_type": kind, "subject_id": str(pk), "title": title, "status": latest.get((kind, pk), "")}
        for kind, pk, title in options
    ]


def _is_own_upload(url: str) -> bool:
    """A file from the platform's own upload pipeline (served over plain http in local development)."""
    from django.conf import settings

    base = getattr(settings, "BACKEND_BASE_URL", "").rstrip("/")
    media = "/" + settings.MEDIA_URL.strip("/") + "/"
    return bool(base) and url.startswith(base + media) and ".." not in url


def submit_verification(*, requester, request_type: str, subject_id=None, supporting_document_url: str = ""):
    """A user asks for something of theirs to be verified. The subject must be theirs, a document is required,
    and there can be only one open request per subject and type (a rejected one can be resubmitted)."""
    from django.core.exceptions import ValidationError
    from django.core.validators import URLValidator
    from .models import VerificationRequest, VerificationRequestStatus, VerificationRequestType

    if request_type not in VerificationRequestType.values:
        raise VerificationSubmissionError("Unknown verification type.")
    subject = _resolve_submission_subject(requester, request_type, subject_id)

    url = (supporting_document_url or "").strip()
    if not url:
        raise VerificationSubmissionError("Attach a document so the team can check your request.")
    if len(url) > MAX_DOCUMENT_URL_LENGTH:
        raise VerificationSubmissionError("The document link is too long.")
    if not _is_own_upload(url):
        try:
            URLValidator(schemes=["https"])(url)
        except ValidationError:
            raise VerificationSubmissionError("The document link must be a secure (https) web address.") from None

    content_type = f"{subject._meta.app_label}.{subject.__class__.__name__}"
    same = VerificationRequest.objects.filter(
        requester=requester, request_type=request_type, subject_content_type=content_type, subject_id=subject.pk,
    )
    if same.filter(status=VerificationRequestStatus.PENDING).exists():
        raise VerificationSubmissionError("You already have a request waiting for review for this.")
    if same.filter(status=VerificationRequestStatus.APPROVED).exists():
        raise VerificationSubmissionError("This is already verified.")

    verification_request = submit_verification_request(
        requester=requester, request_type=request_type, subject=subject, supporting_document_url=url,
    )
    notify_admins_of_verification_request(verification_request)
    return verification_request


def notify_admins_of_verification_request(verification_request) -> None:
    """Tells every admin a verification request is waiting. A failed alert never loses the request."""
    import logging
    from identity.models import AdminProfile
    from notifications.services import notify

    who = verification_request.requester.full_name or verification_request.requester.username
    try:
        for admin_profile in AdminProfile.objects.select_related("user"):
            notify(
                recipient=admin_profile.user, notification_type="VERIFICATION_REQUESTED", channel="IN_APP",
                title="New verification request",
                message=f"{who} asked for {verification_request.get_request_type_display().lower()}.",
                related_reference=str(verification_request.id),
            )
    except Exception:
        logging.getLogger(__name__).exception("Could not alert admins about verification request %s", verification_request.pk)


def verified_roles(user) -> list[str]:
    """The professional roles an admin has verified for this account: any of agent, agency, landlord."""
    from .models import VerificationRequest, VerificationRequestStatus

    approved = set(VerificationRequest.objects.filter(
        subject_content_type="identity.User", subject_id=user.pk, status=VerificationRequestStatus.APPROVED,
        request_type__in=list(ROLE_REQUEST_PROFILES),
    ).values_list("request_type", flat=True))
    return [role for request_type, (_, role) in ROLE_REQUEST_PROFILES.items() if request_type in approved]


def _apply_approval_effect(verification_request, admin) -> None:
    """What approval does beyond recording it: a hostel or guest house gets a verified-document badge, the same
    one land due diligence and agency listings already read."""
    from .models import VerificationRequestType as Kind

    if verification_request.request_type not in (Kind.HOSTEL_VERIFICATION, Kind.GUEST_HOUSE_VERIFICATION):
        return
    from property.models import BadgeType, PropertyAsset, VerificationBadge
    if not PropertyAsset.objects.filter(pk=verification_request.subject_id).exists():
        raise VerificationReviewError("The item being verified no longer exists.")
    badge, _ = VerificationBadge.objects.get_or_create(
        property_asset_id=verification_request.subject_id, badge_type=BadgeType.VERIFIED_DOCUMENT,
    )
    badge.approve(admin)


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
MAX_DELETION_REASON = 500
MAX_CANCELLATION_REASON = 300


class AccountDeletionError(Exception):
    pass


def account_deletion_blockers(user) -> list[str]:
    """What still ties this account to money or an open deal; the deletion waits until these are settled.
    Codes: wallet_balance, pending_withdrawal, held_payment, open_dispute, open_sale."""
    from decimal import Decimal
    from django.db.models import Q
    from monetization.models import Wallet, WithdrawalRequest, WithdrawalStatus
    from transactions.models import EscrowStatus, PaymentEscrow
    from property_management.models import DisputeCase, DisputeStatus
    from marketplace.models import MarketplaceOrder, MarketplaceOrderStatus

    blockers = []
    wallet = Wallet.objects.filter(owner=user).first()
    if wallet and wallet.balance_xaf > Decimal("0"):
        blockers.append("wallet_balance")
    if WithdrawalRequest.objects.filter(wallet__owner=user, status__in=[WithdrawalStatus.PENDING, WithdrawalStatus.APPROVED]).exists():
        blockers.append("pending_withdrawal")
    if PaymentEscrow.objects.filter(booking__requester=user, status__in=[EscrowStatus.HELD, EscrowStatus.DISPUTED]).exists():
        blockers.append("held_payment")
    if DisputeCase.objects.filter(raised_by=user, status__in=[DisputeStatus.OPEN, DisputeStatus.ADMIN_RESPONDED, DisputeStatus.ESCALATED]).exists():
        blockers.append("open_dispute")
    live_orders = [MarketplaceOrderStatus.PAYMENT_PENDING, MarketplaceOrderStatus.PAID, MarketplaceOrderStatus.HANDED_OVER, MarketplaceOrderStatus.DISPUTED]
    if MarketplaceOrder.objects.filter(Q(listing__lister_user=user) | Q(buyer=user), status__in=live_orders).exists():
        blockers.append("open_sale")
    return blockers


def _notify_deletion(user, title: str, message: str, request) -> None:
    from notifications.services import notify
    notify(recipient=user, notification_type="ACCOUNT_DELETION", channel="IN_APP", title=title, message=message, related_reference=str(request.id))


def request_account_deletion(user, reason: str = ""):
    """Starts the retention window. A cancelled request can be restarted; an open one cannot be duplicated."""
    from django.utils import timezone
    from datetime import timedelta
    from .models import AccountDeletionRequest, AccountDeletionStatus

    reason = (reason or "").strip()
    if len(reason) > MAX_DELETION_REASON:
        raise AccountDeletionError("Please keep the reason under 500 characters.")
    existing = AccountDeletionRequest.objects.filter(user=user).first()
    if existing and existing.status == AccountDeletionStatus.REQUESTED:
        raise AccountDeletionError("Your account is already scheduled for deletion.")
    if existing and existing.status == AccountDeletionStatus.COMPLETED:
        raise AccountDeletionError("This account has already been deleted.")

    due = timezone.now() + timedelta(days=ACCOUNT_DELETION_RETENTION_DAYS)
    if existing:
        existing.status = AccountDeletionStatus.REQUESTED
        existing.requested_at = timezone.now()
        existing.retention_expires_at = due
        existing.reason = reason
        existing.cancelled_at = None
        existing.cancelled_by = None
        existing.cancellation_reason = ""
        existing.save()
        request = existing
    else:
        request = AccountDeletionRequest.objects.create(user=user, retention_expires_at=due, reason=reason)
    try:
        _notify_deletion(
            user, "Account deletion scheduled",
            f"Your account will be deleted on {due:%d %b %Y}. You can cancel any time before then from your privacy settings.",
            request,
        )
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Could not send the deletion notice for %s", request.pk)
    return request


def cancel_account_deletion(request, by=None, reason: str = ""):
    """Stops a scheduled deletion. `by` is the admin who stopped it (with a reason the user sees), or None when
    the user changed their mind."""
    from django.utils import timezone
    from .models import AccountDeletionStatus

    if request.status != AccountDeletionStatus.REQUESTED:
        raise AccountDeletionError("Only a scheduled deletion can be cancelled.")
    reason = (reason or "").strip()
    if by is not None:
        if not reason:
            raise AccountDeletionError("A reason is required to stop a user's deletion.")
        if len(reason) > MAX_CANCELLATION_REASON:
            raise AccountDeletionError("The reason must be 300 characters or fewer.")
    request.status = AccountDeletionStatus.CANCELLED
    request.cancelled_at = timezone.now()
    request.cancelled_by = by
    request.cancellation_reason = reason
    request.save(update_fields=["status", "cancelled_at", "cancelled_by", "cancellation_reason"])
    if by is not None:
        _notify_deletion(request.user, "Your account deletion was stopped", f"Our team stopped the deletion of your account. Reason: {reason}", request)
    return request


def complete_deletion_request(request, now=None):
    """Deletes the account behind a scheduled request now. Refuses while money or a deal is still open."""
    from django.db import transaction
    from django.utils import timezone
    from .models import AccountDeletionRequest, AccountDeletionStatus
    from compliance.services import complete_account_deletion

    with transaction.atomic():
        locked = AccountDeletionRequest.objects.select_for_update().select_related("user").get(pk=request.pk)
        if locked.status != AccountDeletionStatus.REQUESTED:
            raise AccountDeletionError("Only a scheduled deletion can be completed.")
        if account_deletion_blockers(locked.user):
            raise AccountDeletionError("This account still has money or an open deal on the platform. Settle it first.")
        complete_account_deletion(locked.user)
        locked.status = AccountDeletionStatus.COMPLETED
        locked.completed_at = now or timezone.now()
        locked.save(update_fields=["status", "completed_at"])
    return locked


def process_due_account_deletions(now=None):
    """After the retention window passes, actually completes the
    deletion via compliance.services.complete_account_deletion() — this
    is what makes the RETENTION DISTINCTION real: financial/legal
    records stay untouched, personal identifying data (KYC, contact
    info) genuinely gets scrubbed, not just a bare deleted_at flag with
    no policy behind it. Accounts that still hold money or an open deal
    are left scheduled (admins see them as blocked) and retried next run."""
    from django.utils import timezone
    from .models import AccountDeletionRequest, AccountDeletionStatus

    now = now or timezone.now()
    due = AccountDeletionRequest.objects.filter(
        status=AccountDeletionStatus.REQUESTED, retention_expires_at__lte=now,
    ).select_related("user")
    completed = []
    for request in due:
        try:
            completed.append(complete_deletion_request(request, now=now))
        except AccountDeletionError:
            continue
    return completed


# ---------------------------------------------------------------------------
# Support — the AI agent first, real human escalation when needed.
# ---------------------------------------------------------------------------
def build_platform_context(*, user, message: str, history: list | None = None) -> str:
    """Lightweight, keyword-triggered retrieval over real platform data,
    so the AI support agent can recommend/quote REAL listings, hotels,
    hostels, and technicians instead of ever inventing them — and can
    answer account-specific questions (wallet balance, recent bookings).
    Deliberately NOT a vector-search/embeddings pipeline — no such
    infrastructure exists yet, and a handful of keyword-triggered
    queries is the right amount of engineering for a first real version
    of this, matching how every other "provider" in this codebase starts
    with a working, honestly-scoped implementation."""
    lowered = message.lower()
    sections = []

    if user is not None and getattr(user, "is_authenticated", False):
        from monetization.models import Wallet
        wallet = Wallet.objects.filter(owner=user).first()
        if wallet:
            sections.append(f"This user's wallet balance: {wallet.balance_xaf} XAF.")

        from transactions.models import Booking
        recent = list(Booking.objects.filter(requester=user).order_by("-created_at")[:3])
        if recent:
            lines = [f"- {b.target_content_type} booking, status={b.status}, made {b.created_at:%Y-%m-%d}" for b in recent]
            sections.append("This user's recent bookings:\n" + "\n".join(lines))

    # Property / hotel / hostel / guest house / venue questions: area- and budget-aware results that
    # always carry a site link (see chat_retrieval.py), so the user can open what the bot found.
    from .chat_retrieval import build_discovery_sections
    sections.extend(build_discovery_sections(message=message, history=history))

    if any(w in lowered for w in ("technician", "plumber", "electrician", "artisan", "repair", "service")):
        from identity.models import TechnicianProfile
        techs = list(TechnicianProfile.objects.select_related("user")[:5])
        lines = [
            f"- {t.user.get_full_name() or t.user.username}, specialties: {', '.join(t.specialties) or 'unspecified'}"
            for t in techs
        ]
        if lines:
            sections.append("Available service technicians:\n" + "\n".join(lines))

    return "\n\n".join(sections)


def answer_anonymous_chat_message(*, message: str, conversation_history: list):
    """The stateless counterpart to create_support_ticket()/
    continue_support_ticket() for a visitor who isn't signed in yet —
    SupportTicket.submitted_by is a required FK (a ticket is always
    someone's OWN durable record), so an anonymous chat deliberately
    never creates one: nothing is persisted server-side, and the caller
    (the chat widget) is responsible for holding its own conversation_
    history and re-sending it each turn, same as any stateless chat
    API. WHY this still gets real platform-grounding: a prospective
    user comparing options BEFORE ever registering is exactly the
    'help customers check the best option' case, not a lesser one."""
    from .support_agent import get_active_support_agent_provider

    platform_context = build_platform_context(user=None, message=message, history=conversation_history)
    provider = get_active_support_agent_provider()
    return provider.generate_response(
        ticket_subject="Anonymous chat", conversation_history=conversation_history,
        latest_message=message, platform_context=platform_context,
    )


def create_support_ticket(*, user, subject: str, first_message: str):
    """Creates a ticket, logs the user's first message, and immediately
    gets an AI response — escalating to a human automatically if the AI
    can't help or the user asks for one."""
    from .models import SupportTicket, SupportMessage, SupportTicketStatus
    from .support_agent import get_active_support_agent_provider

    ticket = SupportTicket.objects.create(submitted_by=user, subject=subject)
    SupportMessage.objects.create(ticket=ticket, sender_type=SupportMessage.SenderType.USER, sender_user=user, text=first_message)

    platform_context = build_platform_context(user=user, message=first_message)
    provider = get_active_support_agent_provider()
    reply = provider.generate_response(
        ticket_subject=subject, conversation_history=[], latest_message=first_message, platform_context=platform_context,
    )
    SupportMessage.objects.create(ticket=ticket, sender_type=SupportMessage.SenderType.AI_AGENT, text=reply.response_text)

    if reply.should_escalate_to_human:
        escalate_ticket_to_human(ticket)

    return ticket


def continue_support_ticket(*, ticket, user, message: str):
    """Appends the user's next message and, if the ticket hasn't already
    been escalated to a human, gets another real AI reply grounded in
    the same live platform data — so a multi-turn conversation stays
    consistent. Once escalated, further messages are just logged for
    the human agent; no more auto-replies."""
    from .models import SupportMessage, SupportTicketStatus

    history = [{"sender_type": m.sender_type, "text": m.text} for m in ticket.messages.order_by("sent_at")]
    SupportMessage.objects.create(ticket=ticket, sender_type=SupportMessage.SenderType.USER, sender_user=user, text=message)

    if not ticket.ai_handled:
        # A person is handling this chat: reopen it if it had been resolved, and let the admins know.
        if ticket.status in (SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED):
            reopen_ticket(ticket)
        notify_admins_of_support_ticket(ticket, escalated=False)
        return ticket

    from .support_agent import get_active_support_agent_provider
    platform_context = build_platform_context(user=user, message=message, history=history)
    provider = get_active_support_agent_provider()
    reply = provider.generate_response(
        ticket_subject=ticket.subject, conversation_history=history, latest_message=message, platform_context=platform_context,
    )
    SupportMessage.objects.create(ticket=ticket, sender_type=SupportMessage.SenderType.AI_AGENT, text=reply.response_text)

    if reply.should_escalate_to_human:
        escalate_ticket_to_human(ticket)

    return ticket


MAX_SUPPORT_REPLY_LENGTH = 4000


def escalate_ticket_to_human(ticket):
    from .models import SupportTicketStatus
    ticket.ai_handled = False
    ticket.status = SupportTicketStatus.IN_PROGRESS
    ticket.save(update_fields=["ai_handled", "status"])
    notify_admins_of_support_ticket(ticket, escalated=True)
    return ticket


def notify_admins_of_support_ticket(ticket, *, escalated: bool) -> None:
    """Tells every admin a person is waiting for a human answer."""
    from identity.models import AdminProfile
    from notifications.services import notify

    person = ticket.submitted_by.full_name or ticket.submitted_by.username
    for admin_profile in AdminProfile.objects.select_related("user"):
        notify(
            recipient=admin_profile.user, notification_type="SUPPORT_TICKET_WAITING", channel="IN_APP",
            title="Support chat needs a person" if escalated else "New message in a support chat",
            message=f"{person}: {ticket.subject}",
            related_reference=str(ticket.id),
        )


def respond_as_human_agent(*, ticket, agent, text: str):
    """An admin's reply. Also takes the conversation over from the AI (so it stops
    answering), reopens a resolved ticket, and tells the user they have a reply."""
    from .models import SupportMessage, SupportTicketStatus
    from notifications.services import notify

    message = SupportMessage.objects.create(ticket=ticket, sender_type=SupportMessage.SenderType.HUMAN_AGENT, sender_user=agent, text=text)
    ticket.ai_handled = False
    ticket.status = SupportTicketStatus.IN_PROGRESS
    ticket.resolved_at = None
    if ticket.assigned_to_id is None:
        ticket.assigned_to = agent
    ticket.save(update_fields=["ai_handled", "status", "resolved_at", "assigned_to"])

    notify(
        recipient=ticket.submitted_by, notification_type="SUPPORT_REPLY", channel="IN_APP",
        title="Oaziland support replied", message=text[:200], related_reference=str(ticket.id),
    )
    return message


def resolve_ticket(ticket):
    from django.utils import timezone
    from .models import SupportTicketStatus
    ticket.status = SupportTicketStatus.RESOLVED
    ticket.resolved_at = timezone.now()
    ticket.save(update_fields=["status", "resolved_at"])
    return ticket


def reopen_ticket(ticket):
    from .models import SupportTicketStatus
    ticket.status = SupportTicketStatus.IN_PROGRESS if not ticket.ai_handled else SupportTicketStatus.OPEN
    ticket.resolved_at = None
    ticket.save(update_fields=["status", "resolved_at"])
    return ticket


def support_ticket_queryset():
    """Tickets annotated with what an admin needs at a glance: how many messages, who wrote
    last and what they said. Used by the admin inbox and the console counters."""
    from django.db.models import Count, Max, OuterRef, Subquery
    from .models import SupportMessage, SupportTicket

    last = SupportMessage.objects.filter(ticket=OuterRef("pk")).order_by("-sent_at", "-id")
    return SupportTicket.objects.select_related("submitted_by", "assigned_to").annotate(
        message_count=Count("messages", distinct=True),
        last_message_at=Max("messages__sent_at"),
        last_sender=Subquery(last.values("sender_type")[:1]),
        last_text=Subquery(last.values("text")[:1]),
    )


def tickets_awaiting_admin(queryset=None):
    """Active tickets that have been handed to a person and whose last word is not an admin's."""
    from django.db.models import Q
    from .models import SupportMessage, SupportTicketStatus

    queryset = support_ticket_queryset() if queryset is None else queryset
    return queryset.filter(
        ai_handled=False, status__in=[SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS],
    ).filter(~Q(last_sender=SupportMessage.SenderType.HUMAN_AGENT))


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


def submit_contact_message(*, name: str, email: str, message: str):
    """Notifies every AdminProfile user via the existing notification
    system — a genuinely public message needs SOMEONE real to see it,
    not just a row silently added to a table nobody checks."""
    from .models import ContactMessage
    from identity.models import AdminProfile
    from notifications.services import notify

    contact_message = ContactMessage.objects.create(name=name, email=email, message=message)

    for admin_profile in AdminProfile.objects.select_related("user"):
        notify(
            recipient=admin_profile.user, notification_type="CONTACT_FORM_SUBMISSION", channel="IN_APP",
            title=f"New contact message from {name}",
            message=f"{name} ({email}) wrote: {message[:200]}",
            related_reference=str(contact_message.id),
        )

    return contact_message


# ---------------------------------------------------------------------------
# Verification request review — a real gap this closes: VerificationRequest
# could be CREATED, but nothing ever let an admin actually approve or
# reject one, despite APPROVED/REJECTED existing as real status values.
# ---------------------------------------------------------------------------
class VerificationReviewError(Exception):
    pass


MAX_REJECTION_REASON = 300


def approve_verification_request(*, verification_request, reviewed_by):
    from django.db import transaction
    from django.utils import timezone
    from .models import VerificationRequest, VerificationRequestStatus
    from notifications.services import notify

    with transaction.atomic():
        locked = VerificationRequest.objects.select_for_update().get(pk=verification_request.pk)
        if locked.status != VerificationRequestStatus.PENDING:
            raise VerificationReviewError("This request has already been reviewed.")
        locked.status = VerificationRequestStatus.APPROVED
        locked.reviewed_by = reviewed_by
        locked.reviewed_at = timezone.now()
        locked.save(update_fields=["status", "reviewed_by", "reviewed_at"])
        _apply_approval_effect(locked, reviewed_by)
    verification_request.refresh_from_db()

    notify(
        recipient=verification_request.requester, notification_type="VERIFICATION_APPROVED", channel="WHATSAPP",
        title="Verification Approved", message="Your verification request has been approved.",
        related_reference=str(verification_request.id),
    )
    return verification_request


def reject_verification_request(*, verification_request, reviewed_by, reason: str = ""):
    from django.db import transaction
    from django.utils import timezone
    from .models import VerificationRequest, VerificationRequestStatus
    from notifications.services import notify

    reason = (reason or "").strip()
    if not reason:
        raise VerificationReviewError("A reason is required to reject a verification request.")
    if len(reason) > MAX_REJECTION_REASON:
        raise VerificationReviewError(f"The reason must be {MAX_REJECTION_REASON} characters or fewer.")

    with transaction.atomic():
        locked = VerificationRequest.objects.select_for_update().get(pk=verification_request.pk)
        if locked.status != VerificationRequestStatus.PENDING:
            raise VerificationReviewError("This request has already been reviewed.")
        locked.status = VerificationRequestStatus.REJECTED
        locked.reviewed_by = reviewed_by
        locked.reviewed_at = timezone.now()
        locked.rejection_reason = reason
        locked.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason"])
    verification_request.refresh_from_db()

    notify(
        recipient=verification_request.requester, notification_type="VERIFICATION_REJECTED", channel="WHATSAPP",
        title="Verification Not Approved",
        message=f"Your verification request was not approved. Reason: {reason}",
        related_reference=str(verification_request.id),
    )
    return verification_request
