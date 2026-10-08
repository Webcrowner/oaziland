"""
events — Module A: Event Centers and Venue Management, per Glorentech's
spec. Vendor categories that already exist as catalogue.
PartnerServiceOffering (photography, drone video, etc. — seeded in
Prompt 12's catalogue work) are deliberately NOT duplicated here; this
app adds EventVendorBooking to link that existing catalogue to a
specific event, plus everything genuinely new: venues, the booking/
pricing engine, availability conflict checking, guest lists, and
catering (which needs its own menu/dietary fields the generic
catalogue doesn't have).
"""
import uuid
from decimal import Decimal
from django.conf import settings
from django.db import models
from property.models import PropertyAsset


class Venue(PropertyAsset):
    verified = models.BooleanField(default=False)

    class Meta:
        db_table = "event_venues"


class VenueAmenity(models.Model):
    """A checklist item with its OWN verified status — per the spec's
    explicit 'full amenities checklist with verified status per item,'
    not a single venue-level verified flag covering everything."""
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="venue_amenities")
    amenity_name = models.CharField(max_length=100)  # e.g. "Air Conditioning", "Generator Backup", "Stage"
    verified = models.BooleanField(default=False)
    notes = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "event_venue_amenities"


class VenueSpace(models.Model):
    """An individual bookable space WITHIN a venue — 'Main Hall,
    Boardroom A, Garden' per the spec. Capacity is tracked per LAYOUT
    (theatre/banquet/cocktail/classroom), since the same room holds
    different numbers of people depending on how it's arranged."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="spaces")
    space_name = models.CharField(max_length=200)
    capacity_theatre = models.PositiveIntegerField(null=True, blank=True)
    capacity_banquet = models.PositiveIntegerField(null=True, blank=True)
    capacity_cocktail = models.PositiveIntegerField(null=True, blank=True)
    capacity_classroom = models.PositiveIntegerField(null=True, blank=True)
    base_price_per_hour_xaf = models.DecimalField(max_digits=10, decimal_places=2)
    catering_policy = models.CharField(max_length=20, choices=[
        ("IN_HOUSE", "In-House Only"), ("APPROVED_EXTERNAL", "Approved External Caterers"), ("BYOC", "Bring Your Own Caterer"),
    ], default="APPROVED_EXTERNAL")
    setup_buffer_hours = models.PositiveSmallIntegerField(default=1)  # blocked before AND after every booking

    class Meta:
        db_table = "event_venue_spaces"


class EventType(models.TextChoices):
    CORPORATE_MEETING = "CORPORATE_MEETING", "Corporate Meeting"
    CONFERENCE = "CONFERENCE", "Conference/Seminar"
    WEDDING = "WEDDING", "Wedding/Marriage Ceremony"
    BIRTHDAY_PARTY = "BIRTHDAY_PARTY", "Birthday/Private Party"
    GRADUATION = "GRADUATION", "Graduation Ceremony"
    TRAINING = "TRAINING", "Training/Workshop"
    RELIGIOUS = "RELIGIOUS", "Religious Event"
    CULTURAL = "CULTURAL", "Cultural Event"
    PRESS_CONFERENCE = "PRESS_CONFERENCE", "Press Conference"


class PackageTier(models.TextChoices):
    """Purely a DISPLAY/categorization label derived from duration —
    the spec's price bands per tier are market benchmarks a venue's own
    base_price_per_hour naturally lands within, not a separate pricing
    formula layered on top of it."""
    HOURLY_MEETING = "HOURLY_MEETING", "Hourly Meeting (1-3 hrs)"
    HALF_DAY = "HALF_DAY", "Half-Day Event (4-6 hrs)"
    FULL_DAY_CONFERENCE = "FULL_DAY_CONFERENCE", "Full-Day Conference (8-12 hrs)"
    CUSTOM = "CUSTOM", "Custom Duration"


class EventBookingStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    CONFIRMED = "CONFIRMED", "Confirmed"
    CANCELLED = "CANCELLED", "Cancelled"
    COMPLETED = "COMPLETED", "Completed"


class EventBooking(models.Model):
    """The core booking record. deposit_percent defaults to 30% per the
    spec's explicit default; booking links to the EXISTING transactions.
    Booking/PaymentEscrow for the deposit payment — not a parallel
    payment system."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organiser = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="event_bookings")
    venue_space = models.ForeignKey(VenueSpace, on_delete=models.PROTECT, related_name="bookings")
    event_type = models.CharField(max_length=20, choices=EventType.choices)
    event_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    guest_count = models.PositiveIntegerField()
    layout_preference = models.CharField(max_length=50, blank=True)
    catering_required = models.BooleanField(default=False)
    av_needs = models.TextField(blank=True)
    special_requests = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=EventBookingStatus.choices, default=EventBookingStatus.PENDING)
    total_cost_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    deposit_percent = models.DecimalField(max_digits=4, decimal_places=2, default=Decimal("30.00"))
    booking = models.OneToOneField("transactions.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="event_booking")
    balance_booking = models.OneToOneField("transactions.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="event_booking_balance")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "event_bookings"

    @property
    def package_tier(self) -> str:
        from datetime import datetime
        hours = (datetime.combine(self.event_date, self.end_time) - datetime.combine(self.event_date, self.start_time)).total_seconds() / 3600
        if 1 <= hours <= 3:
            return PackageTier.HOURLY_MEETING
        if 4 <= hours <= 6:
            return PackageTier.HALF_DAY
        if 8 <= hours <= 12:
            return PackageTier.FULL_DAY_CONFERENCE
        return PackageTier.CUSTOM

    @property
    def deposit_amount_xaf(self):
        return (self.total_cost_xaf * self.deposit_percent / Decimal("100")).quantize(Decimal("1"))

    @property
    def balance_amount_xaf(self):
        return self.total_cost_xaf - self.deposit_amount_xaf


class RecurringBlock(models.Model):
    """'Recurring block for regular events (e.g. weekly church service,
    monthly corporate standing booking)' — a standing reservation that
    availability-checking must respect just like a one-off booking."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue_space = models.ForeignKey(VenueSpace, on_delete=models.CASCADE, related_name="recurring_blocks")
    label = models.CharField(max_length=200)
    day_of_week = models.PositiveSmallIntegerField()  # 0=Monday ... 6=Sunday, matching Python's date.weekday()
    start_time = models.TimeField()
    end_time = models.TimeField()

    class Meta:
        db_table = "event_recurring_blocks"


class ManualUnavailability(models.Model):
    """'Mark specific dates or time blocks as unavailable without
    explanation required' — a venue manager's own override, separate
    from bookings and recurring blocks."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue_space = models.ForeignKey(VenueSpace, on_delete=models.CASCADE, related_name="manual_unavailabilities")
    date = models.DateField()
    start_time = models.TimeField(null=True, blank=True)  # null = the whole day
    end_time = models.TimeField(null=True, blank=True)

    class Meta:
        db_table = "event_manual_unavailabilities"


class RsvpStatus(models.TextChoices):
    CONFIRMED = "CONFIRMED", "Confirmed"
    DECLINED = "DECLINED", "Declined"
    NO_RESPONSE = "NO_RESPONSE", "No Response"


class GuestListEntry(models.Model):
    """One invited guest. qr_token is generated once, at invitation
    time, and is what the day-of check-in scan actually validates
    against — a real, checkable credential, not just a name on a list."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_booking = models.ForeignKey(EventBooking, on_delete=models.CASCADE, related_name="guest_list")
    guest_name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    table_number = models.CharField(max_length=20, blank=True)
    rsvp_status = models.CharField(max_length=15, choices=RsvpStatus.choices, default=RsvpStatus.NO_RESPONSE)
    qr_token = models.CharField(max_length=64, unique=True)
    checked_in_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "event_guest_list_entries"


class Caterer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    cuisine_type = models.CharField(max_length=100, blank=True)
    price_per_head_min_xaf = models.DecimalField(max_digits=10, decimal_places=2)
    price_per_head_max_xaf = models.DecimalField(max_digits=10, decimal_places=2)
    verified = models.BooleanField(default=False)

    class Meta:
        db_table = "event_caterers"

    @property
    def rating(self):
        """Computed from real CatererReview records — never a stored,
        driftable number, per this codebase's established principle."""
        from django.db.models import Avg
        return self.reviews.aggregate(avg=Avg("score"))["avg"]


class CatererReview(models.Model):
    caterer = models.ForeignKey(Caterer, on_delete=models.CASCADE, related_name="reviews")
    organiser = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    score = models.PositiveSmallIntegerField()
    review_text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "event_caterer_reviews"


class CateringBookingStatus(models.TextChoices):
    REQUESTED = "REQUESTED", "Requested"
    CONFIRMED = "CONFIRMED", "Confirmed"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class CateringBooking(models.Model):
    """menu_selections is a JSONField (starter/main/dessert/drinks
    package choices) — the exact shape varies per caterer's menu, so a
    flexible structure avoids a rigid schema per possible menu item."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_booking = models.ForeignKey(EventBooking, on_delete=models.CASCADE, related_name="catering_bookings")
    caterer = models.ForeignKey(Caterer, on_delete=models.PROTECT, related_name="bookings")
    menu_selections = models.JSONField(default=dict)
    guest_count = models.PositiveIntegerField()
    total_cost_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=10, choices=CateringBookingStatus.choices, default=CateringBookingStatus.REQUESTED)

    class Meta:
        db_table = "event_catering_bookings"


class EventVendorBooking(models.Model):
    """Links an EXISTING catalogue.PartnerServiceOffering (photography,
    MC, décor, AV, transport, security, printing — all already seeded
    in the catalogue, Prompt 12's work) to a SPECIFIC event, with the
    price actually agreed for this booking. WHY this doesn't duplicate
    the vendor directory: the catalogue already answers 'what vendor
    services exist and who provides them' — this only answers 'which
    one did THIS event book, and for how much.'"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_booking = models.ForeignKey(EventBooking, on_delete=models.CASCADE, related_name="vendor_bookings")
    offering = models.ForeignKey("catalogue.PartnerServiceOffering", on_delete=models.PROTECT, related_name="event_vendor_bookings")
    agreed_price_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=15, choices=CateringBookingStatus.choices, default=CateringBookingStatus.REQUESTED)

    class Meta:
        db_table = "event_vendor_bookings"


class VenueReview(models.Model):
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="reviews")
    organiser = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    rating = models.PositiveSmallIntegerField()
    review_text = models.TextField(blank=True)
    event_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "event_venue_reviews"
