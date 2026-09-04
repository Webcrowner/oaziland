"""
transactions — the generalized Booking + PaymentEscrow + Commission model
shared across every module (Land reservations, Hotel bookings, Event
bookings, Hostel semester allocations, Guest House stays). See the
Pre-Development Design Package §5 for the physical schema this mirrors,
and §4 for the state machine this implements.
"""
import uuid
from django.conf import settings
from django.db import models


class BookingType(models.TextChoices):
    LAND_RESERVATION = "LAND_RESERVATION", "Land Reservation"
    HOTEL = "HOTEL", "Hotel"
    EVENT = "EVENT", "Event"
    HOSTEL_SEMESTER = "HOSTEL_SEMESTER", "Hostel Semester"
    GUEST_HOUSE = "GUEST_HOUSE", "Guest House"
    GENERAL_RENTAL = "GENERAL_RENTAL", "General Rental (House/Shop/Commercial)"
    SERVICE_REQUEST = "SERVICE_REQUEST", "Service Request (Technician)"
    MARKETPLACE_ITEM = "MARKETPLACE_ITEM", "Marketplace Item (Warehouse/Store/Business/Car)"
    RIDE = "RIDE", "Ride"


class BookingStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    PAYMENT_PROCESSING = "PAYMENT_PROCESSING", "Payment Processing"
    PAYMENT_FAILED = "PAYMENT_FAILED", "Payment Failed"
    CONFIRMED = "CONFIRMED", "Confirmed"
    CHECKED_IN = "CHECKED_IN", "Checked In"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"
    REFUNDING = "REFUNDING", "Refunding"
    EXPIRED = "EXPIRED", "Expired"


class Booking(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking_type = models.CharField(max_length=30, choices=BookingType.choices)
    # Polymorphic target: the Listing/Unit/VenueSpace/HostelRoom being booked.
    target_content_type = models.CharField(max_length=50)  # e.g. "property.Listing"
    target_id = models.UUIDField()
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bookings",
    )
    status = models.CharField(max_length=20, choices=BookingStatus.choices, default=BookingStatus.PENDING)
    amount_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3, default="XAF")
    idempotency_key = models.CharField(max_length=100, unique=True)
    hold_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "bookings"
        indexes = [
            models.Index(fields=["booking_type", "target_id"]),
            models.Index(fields=["requester"]),
            models.Index(
                fields=["status", "hold_expires_at"],
                name="idx_bookings_status_hold",
                condition=models.Q(status="PENDING"),
            ),
        ]

    # --- state machine transitions (Pre-Dev Design Package §4) ---
    def confirm(self):
        self.status = BookingStatus.CONFIRMED
        self.hold_expires_at = None
        self.save(update_fields=["status", "hold_expires_at"])

    def fail_payment(self):
        self.status = BookingStatus.PAYMENT_FAILED
        self.save(update_fields=["status"])

    def expire(self):
        self.status = BookingStatus.EXPIRED
        self.save(update_fields=["status"])

    def cancel(self):
        self.status = BookingStatus.CANCELLED
        self.save(update_fields=["status"])

    def complete(self):
        self.status = BookingStatus.COMPLETED
        self.save(update_fields=["status"])


class EscrowStatus(models.TextChoices):
    HELD = "HELD", "Held"
    RELEASED = "RELEASED", "Released"
    REFUNDED = "REFUNDED", "Refunded"
    DISPUTED = "DISPUTED", "Disputed"


class PaymentProvider(models.TextChoices):
    MTN_MOMO = "MTN_MOMO", "MTN Mobile Money"
    ORANGE_MONEY = "ORANGE_MONEY", "Orange Money"
    CARD = "CARD", "Visa/Mastercard"


class PaymentEscrow(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.OneToOneField(Booking, on_delete=models.CASCADE, related_name="escrow")
    gross_amount_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    platform_fee_xaf = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    payee_amount_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(max_length=20, choices=EscrowStatus.choices, default=EscrowStatus.HELD)
    provider = models.CharField(max_length=20, choices=PaymentProvider.choices)
    provider_reference = models.CharField(max_length=100, null=True, blank=True)
    held_at = models.DateTimeField(auto_now_add=True)
    released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "payment_escrow"
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "provider_reference"],
                name="uq_escrow_provider_ref",
                condition=models.Q(provider_reference__isnull=False),
            )
        ]
        indexes = [
            models.Index(fields=["status"], name="idx_escrow_status_lookup"),
        ]

    def release(self):
        from django.utils import timezone
        self.status = EscrowStatus.RELEASED
        self.released_at = timezone.now()
        self.save(update_fields=["status", "released_at"])

    def refund(self):
        self.status = EscrowStatus.REFUNDED
        self.save(update_fields=["status"])


class Commission(models.Model):
    """Only generated when an Agent or Agency is involved — a direct
    landlord deal produces no Commission row unless separately arranged."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.OneToOneField(Booking, on_delete=models.CASCADE, related_name="commission")
    total_amount_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    agency_share_xaf = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    agent_share_xaf = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    paid_to_landlord = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "commissions"


class ContractType(models.TextChoices):
    LEASE = "LEASE", "Lease"
    SALE = "SALE", "Sale"
    SERVICE_AGREEMENT = "SERVICE_AGREEMENT", "Service Agreement"


class Contract(models.Model):
    """Attaches to a Booking once terms are agreed — a lease, a sale
    agreement, or a service agreement, each carrying a digital signature
    hash and its supporting files (the signed PDF, ID copies).

    WHY one-to-one with Booking rather than a field ON Booking: not every
    Booking needs a Contract (a short hotel stay usually doesn't; a land
    sale always does) — keeping it a separate, optional table means
    Booking doesn't carry contract fields that are usually empty."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.OneToOneField(Booking, on_delete=models.CASCADE, related_name="contract")
    contract_type = models.CharField(max_length=20, choices=ContractType.choices)
    digital_signature_hash = models.CharField(max_length=128, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "contracts"

    def sign(self, signature_hash: str):
        """Marks the contract signed. Kept as a method (not a bare field
        assignment wherever signing happens) so signed_at and the
        signature hash are always set together, and a contract can't
        end up with one set but not the other."""
        from django.utils import timezone
        self.digital_signature_hash = signature_hash
        self.signed_at = timezone.now()
        self.save(update_fields=["digital_signature_hash", "signed_at"])

    @property
    def is_signed(self):
        return self.signed_at is not None


class ContractFile(models.Model):
    class FileType(models.TextChoices):
        LEASE_PDF = "LEASE_PDF", "Lease PDF"
        SALE_AGREEMENT_PDF = "SALE_AGREEMENT_PDF", "Sale Agreement PDF"
        ID_COPY = "ID_COPY", "ID Copy"
        OTHER = "OTHER", "Other"

    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name="attached_files")
    file_type = models.CharField(max_length=25, choices=FileType.choices)
    file_url = models.URLField()

    class Meta:
        db_table = "contract_files"
