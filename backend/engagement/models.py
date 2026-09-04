"""
engagement — Part B (WhatsApp action buttons) and Part C (core app
utilities: messaging states, block/unblock, bookmarks extension,
verification requests, events, account deletion, support) of the
additional module.
"""
import uuid
from django.conf import settings
from django.db import models


# ---------------------------------------------------------------------------
# Part B — WhatsApp action buttons.
# ---------------------------------------------------------------------------
class WhatsAppContext(models.TextChoices):
    """Every place a WhatsApp button can appear — one enum value per
    CONTEXT, not per button instance, since the wording (via
    WhatsAppMessageTemplate) is what varies, not the underlying
    mechanism."""
    CONTACT_LANDLORD = "CONTACT_LANDLORD", "Contact Landlord"
    CONTACT_AGENT = "CONTACT_AGENT", "Contact Agent"
    INQUIRE_LISTING = "INQUIRE_LISTING", "Inquire About Listing"
    CONFIRM_BOOKING = "CONFIRM_BOOKING", "Confirm Booking"
    FOLLOW_UP_MAINTENANCE = "FOLLOW_UP_MAINTENANCE", "Follow Up on Maintenance"
    SHARE_JOB_POSTING = "SHARE_JOB_POSTING", "Share Job Posting"
    CONTACT_MARKETPLACE_SELLER = "CONTACT_MARKETPLACE_SELLER", "Contact Marketplace Seller"


class WhatsAppMessageTemplate(models.Model):
    """Admin/manager-configurable wording per context — WHY only the
    REASON portion is stored here, not the full message: the source
    ('via Oaziland') and the link are always appended by
    build_whatsapp_action() in services.py, structurally, regardless of
    what an admin edits here. This guarantees every WhatsApp message
    always names its source and includes the link, per the spec's
    explicit requirement, without relying on whoever edits a template
    to remember to include them."""
    context = models.CharField(max_length=30, choices=WhatsAppContext.choices, unique=True)
    reason_template = models.TextField()  # e.g. "Hi, I'm reaching out about {listing_name}"
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "whatsapp_message_templates"


class ActionLog(models.Model):
    """A record inside the app that an outbound WhatsApp action
    happened, even though the actual conversation continues on
    WhatsApp itself — so both parties (and Admin, for disputes) have a
    durable record of when contact was initiated and why."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    context = models.CharField(max_length=30, choices=WhatsAppContext.choices)
    triggered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="whatsapp_actions_triggered")
    target_content_type = models.CharField(max_length=50)  # e.g. "property.Listing"
    target_id = models.UUIDField()
    recipient_phone = models.CharField(max_length=20)
    generated_message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "whatsapp_action_logs"
        indexes = [models.Index(fields=["target_content_type", "target_id"])]


# ---------------------------------------------------------------------------
# Part C — Core app utilities.
# ---------------------------------------------------------------------------
class BlockRelationship(models.Model):
    """A one-directional block. WHY one-directional: the blocker wants
    the blocked user gone from THEIR view — the blocked user isn't
    necessarily aware they're blocked, and shouldn't need to be for the
    block to work correctly."""
    blocker = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="blocks_initiated")
    blocked = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="blocked_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "block_relationships"
        unique_together = [("blocker", "blocked")]


class VerificationRequestType(models.TextChoices):
    BUSINESS_VERIFICATION = "BUSINESS_VERIFICATION", "Business Verification"
    IDENTITY_VERIFICATION = "IDENTITY_VERIFICATION", "Identity Verification"
    VEHICLE_OWNERSHIP = "VEHICLE_OWNERSHIP", "Vehicle Ownership"


class VerificationRequestStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"


class VerificationRequest(models.Model):
    """A TRULY generic verification workflow — unlike property.
    VerificationBadge (which FKs directly to PropertyAsset), this uses
    the same (content_type, id) polymorphic pattern as ListingCondition,
    so it can verify a BusinessListing, a CarListing's ownership, or any
    future subject type without a schema change."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="verification_requests_made")
    request_type = models.CharField(max_length=30, choices=VerificationRequestType.choices)
    subject_content_type = models.CharField(max_length=50)
    subject_id = models.UUIDField()
    status = models.CharField(max_length=10, choices=VerificationRequestStatus.choices, default=VerificationRequestStatus.PENDING)
    supporting_document_url = models.URLField(blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="verification_requests_reviewed")
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "verification_requests"


class BookmarkType(models.TextChoices):
    """WHY this extends, rather than replaces, social.Favorite: Favorite
    already exists for Listings and Posts. This generalizes the SAME
    'save for later' concept to jobs, trainings, and marketplace items
    via the polymorphic pattern, rather than either duplicating Favorite
    or trying to retrofit Favorite's fixed listing_id/post FK shape."""
    JOB_POSTING = "JOB_POSTING", "Job Posting"
    TRAINING_PROGRAM = "TRAINING_PROGRAM", "Training Program"
    MARKETPLACE_LISTING = "MARKETPLACE_LISTING", "Marketplace Listing"


class Bookmark(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookmarks")
    bookmark_type = models.CharField(max_length=25, choices=BookmarkType.choices)
    target_content_type = models.CharField(max_length=50)
    target_id = models.UUIDField()
    saved_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "bookmarks"
        unique_together = [("user", "target_content_type", "target_id")]


class Event(models.Model):
    """Postable/attendable events tied to real estate — open houses,
    webinars, training sessions (composed with TrainingProgram in
    Part D, not duplicated)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organizer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="events_organized")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    location_description = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "events"


class EventAttendance(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="attendances")
    attendee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="event_attendances")
    registered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "event_attendances"
        unique_together = [("event", "attendee")]


class AccountDeletionStatus(models.TextChoices):
    REQUESTED = "REQUESTED", "Requested"
    RETENTION_PERIOD = "RETENTION_PERIOD", "In Retention Period"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class AccountDeletionRequest(models.Model):
    """A formal deletion workflow ON TOP OF the existing User.deleted_at
    soft-delete field — WHY a separate request/retention model: 'delete
    my account' can't be instant given financial records (Commission,
    PaymentEscrow) that may need retaining for compliance. This tracks
    the request and a retention window BEFORE the underlying soft-delete
    actually happens."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="deletion_request")
    status = models.CharField(max_length=20, choices=AccountDeletionStatus.choices, default=AccountDeletionStatus.REQUESTED)
    requested_at = models.DateTimeField(auto_now_add=True)
    retention_expires_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)


class SupportTicketStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    RESOLVED = "RESOLVED", "Resolved"
    CLOSED = "CLOSED", "Closed"


class SupportTicket(models.Model):
    """Help & Support — FAQ/ticket submission/live-chat handoff. WHY
    ai_handled starts True: every ticket first tries the AI support
    agent (engagement.support_agent, Part D's companion) before
    escalating to a human — that escalation flips this to False."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="support_tickets")
    subject = models.CharField(max_length=200)
    status = models.CharField(max_length=15, choices=SupportTicketStatus.choices, default=SupportTicketStatus.OPEN)
    ai_handled = models.BooleanField(default=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="support_tickets_assigned")
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "support_tickets"


class SupportMessage(models.Model):
    class SenderType(models.TextChoices):
        USER = "USER", "User"
        AI_AGENT = "AI_AGENT", "AI Agent"
        HUMAN_AGENT = "HUMAN_AGENT", "Human Agent"

    ticket = models.ForeignKey(SupportTicket, on_delete=models.CASCADE, related_name="messages")
    sender_type = models.CharField(max_length=15, choices=SenderType.choices)
    sender_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    text = models.TextField()
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "support_messages"
        ordering = ["sent_at"]
