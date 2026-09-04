"""
guest_houses — the operational layer on top of the EXISTING property.
GuestHouseLodge property type (built in an earlier prompt): channel
manager/OTA sync, biometric guest verification, multi-payee escrow
splits, smart housekeeping, and a host ERP dashboard.

Built from a SUMMARY of GRE-TECH-SPEC-001's Guest House module (five
named features), not the full detailed spec document — that document
was never uploaded to this project, unlike the Event Centers/Hotels/
Student Hostels spec. Flagged honestly; refine once the full document
is available, the same as any other spec gap in this codebase.
"""
import uuid
from decimal import Decimal
from django.conf import settings
from django.db import models


class OTAChannel(models.TextChoices):
    DIRECT = "DIRECT", "Direct (Oaziland)"
    BOOKING_COM = "BOOKING_COM", "Booking.com"
    AIRBNB = "AIRBNB", "Airbnb"
    EXPEDIA = "EXPEDIA", "Expedia"


class ChannelListing(models.Model):
    """Links a GuestHouseLodge to its listing on an external OTA. WHY
    this matters beyond bookkeeping: it's what lets sync_availability_
    to_channels() and receive_external_booking() know EVERY place this
    property is listed, so a booking on one channel can correctly block
    all the others — the actual problem a channel manager exists to solve."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    guest_house = models.ForeignKey("property.GuestHouseLodge", on_delete=models.CASCADE, related_name="channel_listings")
    channel = models.CharField(max_length=15, choices=OTAChannel.choices)
    external_listing_id = models.CharField(max_length=255, blank=True)  # blank for DIRECT
    is_active = models.BooleanField(default=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "guest_house_channel_listings"
        unique_together = [("guest_house", "channel")]


class ChannelBlockedDate(models.Model):
    """A single blocked night, synced across every active channel for
    a guest house — the real mechanism preventing a double-booking
    across Airbnb and Booking.com for the same physical property."""
    guest_house = models.ForeignKey("property.GuestHouseLodge", on_delete=models.CASCADE, related_name="blocked_dates")
    date = models.DateField()
    source_channel = models.CharField(max_length=15, choices=OTAChannel.choices)  # which channel the booking that caused this block came from
    booking = models.ForeignKey("transactions.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="guest_house_blocked_dates")

    class Meta:
        db_table = "guest_house_blocked_dates"
        unique_together = [("guest_house", "date")]  # one authoritative block per night, regardless of source


class VerificationMethod(models.TextChoices):
    ID_PHOTO_MATCH = "ID_PHOTO_MATCH", "ID Photo Match"
    FACIAL_RECOGNITION = "FACIAL_RECOGNITION", "Facial Recognition"
    MANUAL = "MANUAL", "Manual (Host-Verified)"


class GuestVerification(models.Model):
    """Biometric/identity check-in verification for a specific
    booking — distinct from KYCProfile (a one-time, platform-wide
    identity check): this confirms THIS specific arriving person
    matches who actually booked, at THIS specific check-in."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.OneToOneField("transactions.Booking", on_delete=models.CASCADE, related_name="guest_verification")
    method = models.CharField(max_length=20, choices=VerificationMethod.choices)
    verified_at = models.DateTimeField(null=True, blank=True)
    provider_reference = models.CharField(max_length=255, blank=True)
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)  # set for MANUAL verification

    class Meta:
        db_table = "guest_house_guest_verifications"

    @property
    def is_verified(self) -> bool:
        return self.verified_at is not None


class EscrowSplitRole(models.TextChoices):
    OWNER = "OWNER", "Property Owner"
    PROPERTY_MANAGER = "PROPERTY_MANAGER", "Property Manager"


class EscrowSplit(models.Model):
    """A guest house's payee_amount can be split across MULTIPLE
    people — an owner AND a separately-paid property manager — unlike
    the single-payee assumption everywhere else PaymentEscrow is used.
    WHY this is a separate table rather than changing PaymentEscrow
    itself: every other booking type (a house rental, a hotel stay) has
    exactly one payee, and PaymentEscrow.payee_amount_xaf already
    correctly represents that. This ADDS multi-payee support only where
    it's actually needed, without touching the well-tested single-payee
    path everything else relies on."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    escrow = models.ForeignKey("transactions.PaymentEscrow", on_delete=models.CASCADE, related_name="splits")
    payee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="guest_house_escrow_splits")
    role = models.CharField(max_length=20, choices=EscrowSplitRole.choices)
    amount_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    paid_out_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "guest_house_escrow_splits"


class HousekeepingTaskStatus(models.TextChoices):
    SCHEDULED = "SCHEDULED", "Scheduled"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    COMPLETED = "COMPLETED", "Completed"
    VERIFIED = "VERIFIED", "Verified"


class HousekeepingTask(models.Model):
    """A lean task-tracking system — the DATA MODEL half of 'smart
    housekeeping.' Real-time WebSocket push (per the spec's own note
    comparing this to the Hotels module's expanded version) isn't
    built here — no frontend exists yet to push to — but the state
    machine and photo-verification field are real and ready to wire up
    once one does, the same 'data model ready, live push not yet
    built' pattern used for LiveSession/TechnicianLocationPing elsewhere."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    guest_house = models.ForeignKey("property.GuestHouseLodge", on_delete=models.CASCADE, related_name="housekeeping_tasks")
    task_type = models.CharField(max_length=100)  # e.g. "Turnover Cleaning", "Linen Change", "Deep Clean"
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    scheduled_for = models.DateTimeField()
    status = models.CharField(max_length=15, choices=HousekeepingTaskStatus.choices, default=HousekeepingTaskStatus.SCHEDULED)
    completed_at = models.DateTimeField(null=True, blank=True)
    completion_photo_url = models.URLField(blank=True)

    class Meta:
        db_table = "guest_house_housekeeping_tasks"
