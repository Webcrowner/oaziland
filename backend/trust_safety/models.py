"""
trust_safety — user-filed reports, AI content moderation results, and the
warning/strike system that ties them together. Built per Prompt 9 /
UML Section 9.

Design note: ContentReport (a HUMAN flagging something) and
AIModerationResult (a MACHINE scoring something) are deliberately separate
classes even though they lead to similar outcomes — a human report always
needs a reason in someone's own words; an AI result always needs a
confidence score and a model version for auditing. Merging them would lose
information one of the two genuinely needs.
"""
import uuid
from django.conf import settings
from django.db import models


class ReportReason(models.TextChoices):
    SCAM_SUSPECTED = "SCAM_SUSPECTED", "Scam Suspected"
    INAPPROPRIATE_CONTENT = "INAPPROPRIATE_CONTENT", "Inappropriate Content"
    HARASSMENT = "HARASSMENT", "Harassment"
    MISLEADING_LISTING = "MISLEADING_LISTING", "Misleading Listing"
    USER_BEHAVIOR = "USER_BEHAVIOR", "Reporting a Person's Behavior"
    OTHER = "OTHER", "Other"


class ReportStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    REVIEWED = "REVIEWED", "Reviewed"
    DISMISSED = "DISMISSED", "Dismissed"


class ContentReport(models.Model):
    """A human-filed report against a post, listing, comment, OR a
    person directly (target_user — an agent, agency, landlord, or
    owner). WHY target_user was added here rather than as a separate
    model: it's the same real workflow (a reason, notes, an admin
    resolution) already built for content — a person report doesn't
    need a different shape, just one more possible target. Exactly
    one of post/listing_id/comment/target_user should be set —
    enforced in application code, same as the other three."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_filed")
    reason = models.CharField(max_length=30, choices=ReportReason.choices)
    status = models.CharField(max_length=20, choices=ReportStatus.choices, default=ReportStatus.OPEN)
    target_post = models.ForeignKey("social.Post", on_delete=models.CASCADE, null=True, blank=True)
    target_listing_id = models.UUIDField(null=True, blank=True)
    target_comment = models.ForeignKey("social.Comment", on_delete=models.CASCADE, null=True, blank=True)
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name="reports_received",
    )
    # Everything else that can be reported (places, comments, reviews, job postings) is named by kind + id —
    # see trust_safety/report_targets.py. Not a foreign key, so removing the item never deletes the report.
    target_kind = models.CharField(max_length=30, blank=True)
    target_object_id = models.CharField(max_length=64, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "content_reports"
        indexes = [models.Index(fields=["status"]), models.Index(fields=["target_kind", "target_object_id"])]


class ModerationCategory(models.TextChoices):
    TEXT_PROFANITY = "TEXT_PROFANITY", "Text Profanity"
    IMAGE_NUDITY = "IMAGE_NUDITY", "Image Nudity"
    SEXUAL_CONTENT = "SEXUAL_CONTENT", "Sexual Content"
    HATE_SPEECH = "HATE_SPEECH", "Hate Speech"
    SPAM = "SPAM", "Spam"


class ModerationAction(models.TextChoices):
    ALLOW = "ALLOW", "Allow"
    FLAG_FOR_REVIEW = "FLAG_FOR_REVIEW", "Flag for Review"
    AUTO_REMOVE = "AUTO_REMOVE", "Auto-Remove"
    ESCALATE_ADMIN = "ESCALATE_ADMIN", "Escalate to Admin"


class AIModerationResult(models.Model):
    """A machine-generated score for a single piece of content. model_
    version is recorded so that if the moderation model is upgraded later,
    old decisions can still be understood in the context of the model that
    made them — important for any future dispute over a removed post."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.CharField(max_length=30, choices=ModerationCategory.choices)
    confidence_score = models.DecimalField(max_digits=4, decimal_places=3)  # 0.000-1.000
    action = models.CharField(max_length=20, choices=ModerationAction.choices)
    model_version = models.CharField(max_length=50)
    target_post = models.ForeignKey("social.Post", on_delete=models.CASCADE, null=True, blank=True)
    target_listing_id = models.UUIDField(null=True, blank=True)
    target_comment = models.ForeignKey("social.Comment", on_delete=models.CASCADE, null=True, blank=True)
    scored_at = models.DateTimeField(auto_now_add=True)
    # Set when an admin looked at a flagged result and decided what to do about it.
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_flags_reviewed",
    )
    review_outcome = models.CharField(max_length=10, blank=True)  # KEPT or REMOVED

    class Meta:
        db_table = "ai_moderation_results"


class WarningReason(models.TextChoices):
    AI_FLAGGED_CONTENT = "AI_FLAGGED_CONTENT", "AI-Flagged Content"
    ADMIN_REVIEWED_REPORT = "ADMIN_REVIEWED_REPORT", "Admin-Reviewed Report"
    REPEATED_VIOLATION = "REPEATED_VIOLATION", "Repeated Violation"


class UserWarning(models.Model):
    """A strike against a user's account. strike_number is stored (not just
    computed by counting rows) so that a strike count can't silently shift
    if old warnings are ever archived or deleted."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="warnings")
    reason = models.CharField(max_length=30, choices=WarningReason.choices)
    strike_number = models.PositiveSmallIntegerField()
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="warnings_issued",
    )
    acknowledged = models.BooleanField(default=False)
    issued_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "user_warnings"

    @classmethod
    def issue_next_strike(cls, subject, reason, issued_by=None):
        """Figures out the next strike number for this user automatically,
        so calling code never has to compute it (and never risks getting
        it wrong)."""
        last_strike = cls.objects.filter(subject=subject).count()
        return cls.objects.create(
            subject=subject, reason=reason, issued_by=issued_by,
            strike_number=last_strike + 1,
        )


class ContentTakedown(models.Model):
    """An admin pulling a published item (property listing, marketplace listing or post) off the platform,
    with the reason given to its owner. restored_at stays empty while the takedown is in force."""
    class ContentType(models.TextChoices):
        PROPERTY = "property", "Property listing"
        MARKETPLACE = "marketplace", "Marketplace listing"
        POST = "post", "Post"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    content_type = models.CharField(max_length=20, choices=ContentType.choices)
    content_id = models.UUIDField()
    title = models.CharField(max_length=200, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="content_takedowns",
    )
    reason = models.CharField(max_length=500)
    previous_status = models.CharField(max_length=30, blank=True)
    removed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="content_takedowns_made",
    )
    removed_at = models.DateTimeField(auto_now_add=True)
    restored_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="content_restores_made",
    )
    restored_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "content_takedowns"
        ordering = ["-removed_at"]
        indexes = [models.Index(fields=["content_type", "content_id", "restored_at"])]


class AuditLog(models.Model):
    """An append-only record of something an admin did (or tried to do) in
    the admin console. Rows are written by trust_safety.audit and are never
    edited: the actor's username is copied in so the entry still reads
    correctly if the account is later renamed or deleted."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_entries",
    )
    actor_username = models.CharField(max_length=150)
    action = models.CharField(max_length=120)
    target_type = models.CharField(max_length=60, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    target_label = models.CharField(max_length=200, blank=True)
    details = models.JSONField(default=dict, blank=True)
    status_code = models.PositiveSmallIntegerField()
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "admin_audit_log"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["action", "-created_at"]),
            models.Index(fields=["actor", "-created_at"]),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PermissionError("Audit log entries cannot be edited.")
        super().save(*args, **kwargs)

    @property
    def succeeded(self) -> bool:
        return self.status_code < 400
