"""
catalogue — the generic, admin-editable services catalogue (from the
Complementary Services Catalogue document, §5's own recommendation).
Two kinds of entries: Amenity (recurring/subscribable — Wi-Fi, laundry,
gas delivery) and PartnerServiceOffering (one-off engagements —
financing, notary, moving, photography), each tagged with WHERE it's
sourced from (Oaziland directly, Taskln, or an external vendor).

WHY generic instead of a model per service: ~150 distinct services from
the document would mean ~150 tables and constant migrations for new
ones. This lets an admin add "cooking gas refill" as a database row,
not a code change — exactly what the document's own Section 5 asks for.

Nothing about the EXISTING student_hostels.AmenitySubscription/
AmenityType system (built in Prompt 11) is touched — this is additive,
sitting alongside it.
"""
import uuid
from django.conf import settings
from django.db import models


class SourcedVia(models.TextChoices):
    """WHERE a service actually comes from — 'some of these will be
    gotten through Taskln', per the founder's explicit instruction,
    encoded directly into the data rather than left as a design note."""
    OAZILAND_DIRECT = "OAZILAND_DIRECT", "Oaziland Direct"
    TASKLN = "TASKLN", "Taskln"
    VENDOR_PARTNER = "VENDOR_PARTNER", "Vendor Partner"


class BillingType(models.TextChoices):
    ONE_TIME = "ONE_TIME", "One-Time"
    RECURRING = "RECURRING", "Recurring"
    ON_DEMAND = "ON_DEMAND", "On-Demand"


class AmenityCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)

    class Meta:
        db_table = "amenity_categories"

    def __str__(self):
        return self.name


class Amenity(models.Model):
    name = models.CharField(max_length=200)
    category = models.ForeignKey(AmenityCategory, on_delete=models.PROTECT, related_name="amenities")
    price_xaf = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # null = price varies/quoted
    billing_type = models.CharField(max_length=15, choices=BillingType.choices)
    requires_scheduling = models.BooleanField(default=False)  # e.g. gas delivery, dustbin pickup, cleaning visits
    sourced_via = models.CharField(max_length=20, choices=SourcedVia.choices, default=SourcedVia.OAZILAND_DIRECT)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "amenities"

    def __str__(self):
        return self.name


class ServiceSubscriptionStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    PAUSED = "PAUSED", "Paused"
    CANCELLED = "CANCELLED", "Cancelled"


class ServiceSubscription(models.Model):
    """A tenant OR a hostel unit subscribing to an Amenity — the generic
    replacement pattern the document's §5 describes, usable platform-
    wide (not hostel-only, unlike the existing AmenitySubscription)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subscriber = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name="service_subscriptions")
    hostel_unit = models.ForeignKey("student_hostels.HostelUnit", on_delete=models.CASCADE, null=True, blank=True, related_name="catalogue_subscriptions")
    amenity = models.ForeignKey(Amenity, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=10, choices=ServiceSubscriptionStatus.choices, default=ServiceSubscriptionStatus.ACTIVE)
    next_scheduled_at = models.DateTimeField(null=True, blank=True)  # set only when amenity.requires_scheduling
    started_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "catalogue_service_subscriptions"

    def cancel(self):
        from django.utils import timezone
        self.status = ServiceSubscriptionStatus.CANCELLED
        self.cancelled_at = timezone.now()
        self.save(update_fields=["status", "cancelled_at"])


class PartnerServiceCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)

    class Meta:
        db_table = "partner_service_categories"

    def __str__(self):
        return self.name


class PartnerServiceOffering(models.Model):
    """A one-off professional/logistics engagement — financing, notary,
    moving, photography, insurance — as opposed to Amenity's recurring
    subscriptions."""
    name = models.CharField(max_length=200)
    category = models.ForeignKey(PartnerServiceCategory, on_delete=models.PROTECT, related_name="offerings")
    description = models.TextField(blank=True)
    sourced_via = models.CharField(max_length=20, choices=SourcedVia.choices, default=SourcedVia.VENDOR_PARTNER)
    price_hint_xaf = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "partner_service_offerings"

    def __str__(self):
        return self.name


class PartnerServiceRequestStatus(models.TextChoices):
    REQUESTED = "REQUESTED", "Requested"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class PartnerServiceRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="partner_service_requests")
    offering = models.ForeignKey(PartnerServiceOffering, on_delete=models.PROTECT, related_name="requests")
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=15, choices=PartnerServiceRequestStatus.choices, default=PartnerServiceRequestStatus.REQUESTED)
    requested_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "partner_service_requests"
