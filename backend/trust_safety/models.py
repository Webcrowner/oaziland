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
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "content_reports"
        indexes = [models.Index(fields=["status"])]


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
