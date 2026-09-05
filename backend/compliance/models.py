"""
compliance — consent tracking, data export, and the retention-aware
account deletion this prompt requires: financial/legal records stay,
personal identifying data actually gets scrubbed.
"""
import uuid
from django.conf import settings
from django.db import models


class ConsentType(models.TextChoices):
    TERMS_OF_SERVICE = "TERMS_OF_SERVICE", "Terms of Service"
    PRIVACY_POLICY = "PRIVACY_POLICY", "Privacy Policy"
    KYC_DATA_SHARING = "KYC_DATA_SHARING", "KYC Data Sharing"
    MARKETING_COMMUNICATIONS = "MARKETING_COMMUNICATIONS", "Marketing Communications"
    PARENT_GUARDIAN_HOSTEL_ACCESS = "PARENT_GUARDIAN_HOSTEL_ACCESS", "Parent/Guardian Hostel Access"


class ConsentRecord(models.Model):
    """Tracks exactly what a user agreed to, and to WHICH VERSION —
    WHY version matters: if the Privacy Policy changes materially,
    consent to the OLD version isn't the same thing as consent to the
    new one. A user who agreed to v1.0 hasn't necessarily agreed to
    v2.0's different terms just because they never explicitly said no."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="consent_records")
    consent_type = models.CharField(max_length=35, choices=ConsentType.choices)
    version = models.CharField(max_length=20)
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "consent_records"
        indexes = [models.Index(fields=["user", "consent_type"])]

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None


class PolicyDocumentType(models.TextChoices):
    TERMS_OF_SERVICE = "TERMS_OF_SERVICE", "Terms of Service"
    PRIVACY_POLICY = "PRIVACY_POLICY", "Privacy Policy"
    COMMUNITY_GUIDELINES = "COMMUNITY_GUIDELINES", "Community Guidelines"


class PolicyDocument(models.Model):
    """A versioned, published legal document. WHY the body text is
    explicitly marked as a draft below (see the seed data, not this
    model): this prompt builds the TECHNICAL MECHANISM for publishing
    and consenting to a policy — per the prompt's own explicit
    instruction, the actual legal wording requires the founder's
    lawyer's review before this is real, binding text, and Claude is
    not a lawyer qualified to author it."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document_type = models.CharField(max_length=20, choices=PolicyDocumentType.choices)
    version = models.CharField(max_length=20)
    body_text = models.TextField()
    is_current = models.BooleanField(default=False)
    published_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "policy_documents"
        unique_together = [("document_type", "version")]


class DataExportRequestStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    READY = "READY", "Ready"
    FAILED = "FAILED", "Failed"


class DataExportRequest(models.Model):
    """A user's 'download all my data' request — the actual right-of-
    access mechanism. export_file holds a real generated JSON file, not
    a promise of one."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="data_export_requests")
    status = models.CharField(max_length=10, choices=DataExportRequestStatus.choices, default=DataExportRequestStatus.PENDING)
    export_file = models.FileField(upload_to="data_exports/", null=True, blank=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "data_export_requests"
