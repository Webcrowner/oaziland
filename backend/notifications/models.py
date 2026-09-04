"""
notifications — the shared notification system used across every module
(saved-search alerts, booking confirmations, welfare escalations, etc.)
so no feature builds its own separate messaging pathway.
"""
import uuid
from django.conf import settings
from django.db import models


class NotificationChannel(models.TextChoices):
    IN_APP = "IN_APP", "In-App"
    WHATSAPP = "WHATSAPP", "WhatsApp"
    SMS = "SMS", "SMS"
    PUSH = "PUSH", "Push Notification"
    EMAIL = "EMAIL", "Email"


class Notification(models.Model):
    """One notification, one delivery attempt record. WHY 'delivered' is
    tracked here rather than assumed: a WhatsApp/SMS/push send can fail
    even after this record is created — keeping delivered as an explicit
    field (set by the dispatcher, not by creation) means a failed send is
    visible and auditable, not silently indistinguishable from a
    successful one."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications",
        null=True, blank=True,
    )
    # WHY nullable + this field: not every notification target is a
    # registered platform user — an agent's safety-check-in emergency
    # contact (Prompt 14) may be a family member with no Oaziland
    # account at all. When recipient is None, external_phone_number
    # must be set instead.
    external_phone_number = models.CharField(max_length=20, blank=True)
    notification_type = models.CharField(max_length=50)  # e.g. "SAVED_SEARCH_MATCH", "BOOKING_CONFIRMED"
    title = models.CharField(max_length=200)
    message = models.TextField()
    channel = models.CharField(max_length=10, choices=NotificationChannel.choices, default=NotificationChannel.IN_APP)
    related_reference = models.CharField(max_length=255, blank=True)  # e.g. a Listing id
    delivered = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications"
        indexes = [models.Index(fields=["recipient", "-created_at"])]

    def mark_read(self):
        from django.utils import timezone
        self.read_at = timezone.now()
        self.save(update_fields=["read_at"])
