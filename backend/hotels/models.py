"""
hotels — Module B: Hotel Management System, per Glorentech's Event
Centers/Hotels/Student Hostels Spec. Built following the exact same
patterns already established for student_hostels: multi-table
inheritance from PropertyAsset, real enforced state machines (not
just status fields nobody checks), and settlement through the
existing Booking/PaymentEscrow machinery rather than a parallel one.
"""
import uuid
from decimal import Decimal
from django.conf import settings
from django.db import models
from property.models import PropertyAsset


class RoomCategory(models.TextChoices):
    STANDARD = "STANDARD", "Standard Room"
    DELUXE = "DELUXE", "Deluxe Room"
    SUITE = "SUITE", "Suite"
    EXECUTIVE = "EXECUTIVE", "Executive Room"
    FAMILY = "FAMILY", "Family Room"
    ACCESSIBLE = "ACCESSIBLE", "Accessible Room"


class Hotel(PropertyAsset):
    """WHY this extends PropertyAsset via multi-table inheritance, the
    same pattern as House/Land/Shop and StudentHostel: a hotel IS a
    property with a location, owner, and everything PropertyAsset
    already provides — no reason to duplicate those fields. WHY there's
    no separate amenities field here: PropertyAsset itself gained a
    real, validated amenities field (set_property_amenities()) — this
    used to duplicate that with its own unvalidated JSONField before
    the parent had one at all; removed to use the inherited field
    instead of shadowing it with a second, less-validated copy."""
    name = models.CharField(max_length=200, blank=True, default="")
    star_rating = models.PositiveSmallIntegerField(null=True, blank=True)  # 1-5, null = unrated
    verified = models.BooleanField(default=False)

    # Dynamic pricing configuration — per-hotel, since the spec makes
    # these "configurable per hotel," not platform-wide constants.
    # WHY Decimal(...) explicitly, not a bare float default: a plain
    # float default on a DecimalField stays a float in memory until the
    # object round-trips through the database — multiplying it against
    # a real Decimal elsewhere then raises a TypeError. Found by the
    # test suite immediately, fixed here rather than papered over.
    event_premium_multiplier = models.DecimalField(max_digits=4, decimal_places=2, default=Decimal("1.5"))
    last_minute_multiplier = models.DecimalField(max_digits=4, decimal_places=2, default=Decimal("0.9"))  # <1.0 = discount, >1.0 = premium; hotel's choice

    class Meta:
        db_table = "hotels"

    @property
    def total_rooms(self):
        return self.rooms.count()


class RoomType(models.Model):
    """Room category configuration — one hotel can offer several room
    types, each with its own base rate and capacity."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="room_types")
    category = models.CharField(max_length=15, choices=RoomCategory.choices)
    capacity = models.PositiveSmallIntegerField()
    base_rate_xaf = models.DecimalField(max_digits=10, decimal_places=2)
    amenities = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "hotel_room_types"


class RoomStatus(models.TextChoices):
    """The 7 states from the spec's B.4 table — a real state machine,
    not a loose free-text field. WHY these transitions matter: a room
    can only ever be ASSIGNED to a new guest from INSPECTED, never
    directly from DIRTY or CLEAN — see services.py's assign_room()."""
    OCCUPIED = "OCCUPIED", "Occupied"
    DIRTY = "DIRTY", "Dirty"
    CLEAN = "CLEAN", "Clean"
    INSPECTED = "INSPECTED", "Inspected"
    OUT_OF_ORDER = "OUT_OF_ORDER", "Out of Order"
    OUT_OF_SERVICE = "OUT_OF_SERVICE", "Out of Service"
    DO_NOT_DISTURB = "DO_NOT_DISTURB", "Do Not Disturb"


class Room(models.Model):
    """An individual physical room — distinct from RoomType (the
    category/rate configuration)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="rooms")
    room_type = models.ForeignKey(RoomType, on_delete=models.PROTECT, related_name="rooms")
    room_number = models.CharField(max_length=20)
    floor = models.PositiveSmallIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=RoomStatus.choices, default=RoomStatus.INSPECTED)
    last_cleaned_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "hotel_rooms"
        unique_together = [("hotel", "room_number")]


class SeasonalRate(models.Model):
    """Dry season vs. rainy season demand patterns, per the spec's
    explicit Yaoundé-specific note — modeled by month/day (recurs every
    year) rather than a fixed date range, since seasons repeat annually."""
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="seasonal_rates")
    season_name = models.CharField(max_length=100)
    start_month = models.PositiveSmallIntegerField()
    start_day = models.PositiveSmallIntegerField()
    end_month = models.PositiveSmallIntegerField()
    end_day = models.PositiveSmallIntegerField()
    multiplier = models.DecimalField(max_digits=4, decimal_places=2)

    class Meta:
        db_table = "hotel_seasonal_rates"


class EventPremiumPeriod(models.Model):
    """A specific date range with a local event driving demand — 'when
    a major conference, graduation ceremony, or national holiday falls
    within 7 days, the system applies an event premium multiplier.'"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="event_premium_periods")
    event_name = models.CharField(max_length=200)
    event_date = models.DateField()

    class Meta:
        db_table = "hotel_event_premium_periods"


class ReservationSource(models.TextChoices):
    DIRECT = "DIRECT", "Direct (Website/App)"
    OTA = "OTA", "Online Travel Agency"
    PHONE = "PHONE", "Phone"
    WALK_IN = "WALK_IN", "Walk-In"


class ReservationStatus(models.TextChoices):
    PENDING_PAYMENT = "PENDING_PAYMENT", "Pending Payment"
    CONFIRMED = "CONFIRMED", "Confirmed"
    CHECKED_IN = "CHECKED_IN", "Checked In"
    CHECKED_OUT = "CHECKED_OUT", "Checked Out"
    CANCELLED = "CANCELLED", "Cancelled"
    NO_SHOW = "NO_SHOW", "No Show"


class Reservation(models.Model):
    """The core booking record. rate_xaf is the TOTAL locked in at
    booking time from compute_dynamic_rate() — a rate change after
    booking (e.g. a new event premium period added later) must never
    retroactively change what an already-confirmed guest is charged."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="reservations")
    guest = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hotel_reservations")
    room_type = models.ForeignKey(RoomType, on_delete=models.PROTECT, related_name="reservations")
    check_in = models.DateField()
    check_out = models.DateField()
    adults = models.PositiveSmallIntegerField(default=1)
    children = models.PositiveSmallIntegerField(default=0)
    rate_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    source = models.CharField(max_length=10, choices=ReservationSource.choices, default=ReservationSource.DIRECT)
    status = models.CharField(max_length=15, choices=ReservationStatus.choices, default=ReservationStatus.PENDING_PAYMENT)
    special_requests = models.TextField(blank=True)
    # A string reference since GroupBooking is defined later in this
    # file — nullable because most reservations are NOT part of a group.
    group_booking = models.ForeignKey("GroupBooking", on_delete=models.SET_NULL, null=True, blank=True, related_name="reservations")
    booking = models.OneToOneField("transactions.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="hotel_reservation")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hotel_reservations"


class RoomAssignment(models.Model):
    """Links a confirmed reservation to the SPECIFIC physical room
    given at check-in — the room isn't chosen until arrival, since
    which exact room is free depends on real-time housekeeping status."""
    reservation = models.OneToOneField(Reservation, on_delete=models.CASCADE, related_name="room_assignment")
    room = models.ForeignKey(Room, on_delete=models.PROTECT, related_name="assignments")
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hotel_room_assignments"


class FolioStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    CLOSED = "CLOSED", "Closed"


class GuestFolio(models.Model):
    """The financial account for one stay. WHY total_charges/total_
    payments/balance are properties, not stored fields: they're fully
    derivable from FolioCharge records — storing them separately risks
    the exact kind of drift bug this codebase avoids everywhere else
    (see PropertyAsset.finish_level vs. flyers.FinishLevel's earlier
    deduplication, same underlying principle)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reservation = models.OneToOneField(Reservation, on_delete=models.CASCADE, related_name="folio")
    status = models.CharField(max_length=10, choices=FolioStatus.choices, default=FolioStatus.OPEN)
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "hotel_guest_folios"

    @property
    def balance_xaf(self):
        from django.db.models import Sum
        return self.charges.aggregate(total=Sum("amount_xaf"))["total"] or Decimal("0")


class FolioChargeType(models.TextChoices):
    ROOM = "ROOM", "Room Charge"
    FNB = "FNB", "Food & Beverage"
    EXTRAS = "EXTRAS", "Extras (Laundry/Transfer/Minibar)"
    ADJUSTMENT = "ADJUSTMENT", "Adjustment"
    PAYMENT = "PAYMENT", "Payment"  # negative amount — reduces balance


class FolioCharge(models.Model):
    """One line on a guest's bill. Payments are modeled as NEGATIVE
    amounts with charge_type=PAYMENT — this is what lets balance_xaf be
    a simple sum rather than a charges-minus-payments calculation that
    could get the sign wrong in two different places."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    folio = models.ForeignKey(GuestFolio, on_delete=models.CASCADE, related_name="charges")
    charge_type = models.CharField(max_length=10, choices=FolioChargeType.choices)
    description = models.CharField(max_length=255)
    amount_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    reason_code = models.CharField(max_length=100, blank=True)  # required in practice for ADJUSTMENT, per the spec's audit-trail requirement
    posted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    posted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hotel_folio_charges"


class CorporateAccount(models.Model):
    """A company with negotiated rates — 'may be set up for 30-day
    invoice billing rather than payment at checkout,' per the spec."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="corporate_accounts")
    company_name = models.CharField(max_length=200)
    contracted_rate_xaf = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    invoice_billing_enabled = models.BooleanField(default=False)
    travel_manager_contact = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "hotel_corporate_accounts"


class GroupBooking(models.Model):
    """The master record for 10+ simultaneous room bookings (B.5) —
    individual Reservations link back here via group_booking below,
    and the master_folio holds SHARED charges (meeting rooms, group
    meals), separate from each guest's own personal folio."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="group_bookings")
    group_name = models.CharField(max_length=200)
    event_type = models.CharField(max_length=100, blank=True)
    arrival = models.DateField()
    departure = models.DateField()
    corporate_account = models.ForeignKey(CorporateAccount, on_delete=models.SET_NULL, null=True, blank=True, related_name="group_bookings")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hotel_group_bookings"

    @property
    def total_rooms(self):
        return self.reservations.count()
