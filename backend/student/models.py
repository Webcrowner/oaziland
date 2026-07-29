"""
student — the marketplace half of the Student module (the hostel half
lives in hospitality/student_hostels once built). StudentProfile itself
is in `identity` since it's a Role attachment to User.
"""
import uuid
from django.conf import settings
from django.db import models


class ItemCondition(models.TextChoices):
    NEW = "NEW", "New"
    LIKE_NEW = "LIKE_NEW", "Like New"
    USED = "USED", "Used"
    FOR_PARTS = "FOR_PARTS", "For Parts"


class ItemStatus(models.TextChoices):
    AVAILABLE = "AVAILABLE", "Available"
    RESERVED = "RESERVED", "Reserved"
    SOLD = "SOLD", "Sold"


class MarketplaceItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    seller = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="marketplace_items")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    condition = models.CharField(max_length=20, choices=ItemCondition.choices)
    price_xaf = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=20, choices=ItemStatus.choices, default=ItemStatus.AVAILABLE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "marketplace_items"
        indexes = [models.Index(fields=["status"])]
