"""
marketplace — expanded listings beyond real estate: warehouses, stores,
businesses, and cars (for sale or rent), plus ride bookings. A separate
hierarchy from property.PropertyAsset (a car or a business-for-sale
isn't real estate), but reusing the SAME design patterns already
established: polymorphic ownership (student_hostels.OwnerProfile,
reused rather than duplicated), a generic composed condition object
(mirroring property.VerificationBadge's genericity), and transactions
settling through the existing Booking/PaymentEscrow rather than a
parallel payment system.
"""
import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone


class ListerRole(models.TextChoices):
    """WHO actually posted the listing — distinct from WHO OWNS it
    (OwnerProfile). A tenant with sublet rights can list a property they
    don't own; an agency can list on behalf of an owner they represent."""
    OWNER = "OWNER", "Owner"
    TENANT_SUBLET = "TENANT_SUBLET", "Tenant (Sublet Rights)"
    AGENT = "AGENT", "Agent"
    AGENCY = "AGENCY", "Agency"


class PriceBasis(models.TextChoices):
    SALE = "SALE", "Sale"
    RENT_NIGHTLY = "RENT_NIGHTLY", "Rent — Nightly"
    RENT_WEEKLY = "RENT_WEEKLY", "Rent — Weekly"
    RENT_MONTHLY = "RENT_MONTHLY", "Rent — Monthly"
    RENT_ANNUAL = "RENT_ANNUAL", "Rent — Annual"
    PER_TRIP = "PER_TRIP", "Per Trip"


class AvailabilityStatus(models.TextChoices):
    AVAILABLE = "AVAILABLE", "Available"
    UNDER_OFFER = "UNDER_OFFER", "Under Offer"
    UNAVAILABLE = "UNAVAILABLE", "Unavailable"


class MarketplaceListingBase(models.Model):
    """The shared concrete base every category extends via multi-table
    inheritance — the SAME pattern property.PropertyAsset already uses
    for House/Land/Shop/etc. Every category shares owner, lister, price,
    location, and availability; each subclass adds only what's genuinely
    category-specific."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey("student_hostels.OwnerProfile", on_delete=models.PROTECT, related_name="marketplace_listings")
    lister_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="marketplace_listings_posted")
    lister_role = models.CharField(max_length=20, choices=ListerRole.choices)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    price_basis = models.CharField(max_length=15, choices=PriceBasis.choices)
    price_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    # Refundable security deposit for rentals, held separately from the rent and returned when the rental ends.
    security_deposit_xaf = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    quarter = models.ForeignKey("geo.Quarter", on_delete=models.SET_NULL, null=True, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    availability_status = models.CharField(max_length=15, choices=AvailabilityStatus.choices, default=AvailabilityStatus.AVAILABLE)
    # Set when an admin confirms a report; the lister cannot make the listing available again.
    removed_by_moderation = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    # Listings drop off the marketplace LISTING_LIFETIME_DAYS after their last renewal, like Jiji or Leboncoin ads,
    # so buyers don't keep finding things that were sold long ago. The lister renews with one tap.
    renewed_at = models.DateTimeField(default=timezone.now)
    expiry_reminded_at = models.DateTimeField(null=True, blank=True)
    # Detail-page views by people other than the lister (at most one per viewer per day).
    view_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "marketplace_listings"
        indexes = [models.Index(fields=["availability_status", "quarter"])]


class WarehouseListing(MarketplaceListingBase):
    size_sqm = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        db_table = "warehouse_listings"


class StoreListing(MarketplaceListingBase):
    size_sqm = models.DecimalField(max_digits=10, decimal_places=2)
    frontage_meters = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "store_listings"


class BusinessListing(MarketplaceListingBase):
    """A going concern — includes_goodwill/includes_inventory as
    explicit flags per the spec, since whether these are part of the
    sale materially changes what's actually being sold."""
    size_sqm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    seating_capacity = models.PositiveIntegerField(null=True, blank=True)
    includes_goodwill = models.BooleanField(default=False)
    includes_inventory = models.BooleanField(default=False)
    annual_revenue_xaf = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "business_listings"


class CarBodyType(models.TextChoices):
    SEDAN = "SEDAN", "Sedan"
    HATCHBACK = "HATCHBACK", "Hatchback"
    SUV = "SUV", "SUV / 4x4"
    PICKUP = "PICKUP", "Pick-up"
    WAGON = "WAGON", "Station wagon"
    COUPE = "COUPE", "Coupe"
    CONVERTIBLE = "CONVERTIBLE", "Convertible"
    VAN = "VAN", "Van"
    MINIBUS = "MINIBUS", "Minibus"
    BUS = "BUS", "Bus"
    TRUCK = "TRUCK", "Truck"
    OTHER = "OTHER", "Other"


class FuelType(models.TextChoices):
    PETROL = "PETROL", "Petrol"
    DIESEL = "DIESEL", "Diesel"
    HYBRID = "HYBRID", "Hybrid"
    ELECTRIC = "ELECTRIC", "Electric"
    GAS = "GAS", "Gas (LPG)"


class Transmission(models.TextChoices):
    MANUAL = "MANUAL", "Manual"
    AUTOMATIC = "AUTOMATIC", "Automatic"


class Drivetrain(models.TextChoices):
    FWD = "FWD", "Front-wheel drive"
    RWD = "RWD", "Rear-wheel drive"
    AWD = "AWD", "All-wheel drive"
    FOUR_WD = "4WD", "4x4"


class VehicleCondition(models.TextChoices):
    """How the car reached the seller — in Cameroon a car 'venant' (just imported, foreign used) sells very
    differently from one already driven locally."""
    NEW = "NEW", "New"
    FOREIGN_USED = "FOREIGN_USED", "Foreign used"
    LOCALLY_USED = "LOCALLY_USED", "Locally used"


class DriverOption(models.TextChoices):
    SELF_DRIVE = "SELF_DRIVE", "Self-drive only"
    WITH_DRIVER = "WITH_DRIVER", "With driver only"
    EITHER = "EITHER", "Self-drive or with driver"


class FuelPolicy(models.TextChoices):
    SAME_LEVEL = "SAME_LEVEL", "Return with the same fuel level"
    FULL_TO_FULL = "FULL_TO_FULL", "Full to full"
    INCLUDED = "INCLUDED", "Fuel included"


CAR_FEATURES = (
    "AIR_CONDITIONING", "BLUETOOTH", "REVERSE_CAMERA", "PARKING_SENSORS", "NAVIGATION", "LEATHER_SEATS",
    "SUNROOF", "CRUISE_CONTROL", "KEYLESS_ENTRY", "ALLOY_WHEELS", "POWER_WINDOWS", "THIRD_ROW_SEATS",
    "TOW_HITCH", "ROOF_RACK", "CHILD_SEAT", "USB_CHARGER",
)


class CarListing(MarketplaceListingBase):
    """For sale OR for rent — price_basis (inherited) distinguishes these; the car's own specs live in the
    composed VehicleSpec below. A rental car is priced per day (price_basis RENT_NIGHTLY) and booked for chosen
    dates, so the rental terms below only apply when it is for rent."""
    price_negotiable = models.BooleanField(default=False)
    driver_option = models.CharField(max_length=12, choices=DriverOption.choices, default=DriverOption.SELF_DRIVE)
    driver_fee_per_day_xaf = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    weekly_discount_pct = models.PositiveSmallIntegerField(default=0)
    monthly_discount_pct = models.PositiveSmallIntegerField(default=0)
    min_rental_days = models.PositiveSmallIntegerField(default=1)
    max_rental_days = models.PositiveSmallIntegerField(null=True, blank=True)
    # Blank means unlimited kilometres.
    daily_km_limit = models.PositiveIntegerField(null=True, blank=True)
    extra_km_fee_xaf = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    fuel_policy = models.CharField(max_length=15, choices=FuelPolicy.choices, blank=True)
    min_driver_age = models.PositiveSmallIntegerField(null=True, blank=True)
    min_licence_years = models.PositiveSmallIntegerField(null=True, blank=True)
    insurance_included = models.BooleanField(default=False)
    delivery_available = models.BooleanField(default=False)
    delivery_fee_xaf = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    out_of_town_allowed = models.BooleanField(default=True)
    # Off: each booking is a request the owner accepts or declines (the payment waits in escrow meanwhile).
    instant_book = models.BooleanField(default=True)

    class Meta:
        db_table = "car_listings"


class CarBlockedPeriod(models.Model):
    """Days the owner keeps a rental car off the calendar (servicing, personal use). Like a booking, the period
    runs from starts_on up to but not including ends_on."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    car = models.ForeignKey(CarListing, on_delete=models.CASCADE, related_name="blocked_periods")
    starts_on = models.DateField()
    ends_on = models.DateField()
    note = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "car_blocked_periods"
        ordering = ["starts_on"]


class GoodsCategory(models.TextChoices):
    ELECTRONICS = "ELECTRONICS", "Electronics"
    PHONES = "PHONES", "Phones & Tablets"
    FASHION = "FASHION", "Fashion & Beauty"
    HOME = "HOME", "Home & Furniture"
    APPLIANCES = "APPLIANCES", "Appliances"
    FOOD = "FOOD", "Food & Farm Produce"
    BUILDING = "BUILDING", "Building Materials"
    TOOLS = "TOOLS", "Tools & Machinery"
    VEHICLE_PARTS = "VEHICLE_PARTS", "Vehicle Parts"
    BABY = "BABY", "Baby & Kids"
    SPORTS = "SPORTS", "Sports & Leisure"
    OTHER = "OTHER", "Other"


class GoodsCondition(models.TextChoices):
    NEW = "NEW", "New"
    LIKE_NEW = "LIKE_NEW", "Like new"
    USED = "USED", "Used"


class GoodsListing(MarketplaceListingBase):
    """An everyday item for sale — a phone, a sofa, a sack of rice. Always a sale (never a rental), so the
    price basis is fixed by the serializer; the item's own details are the category, condition and quantity."""
    item_category = models.CharField(max_length=20, choices=GoodsCategory.choices, default=GoodsCategory.OTHER)
    condition = models.CharField(max_length=10, choices=GoodsCondition.choices, default=GoodsCondition.USED)
    quantity = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "goods_listings"


class VehicleSpec(models.Model):
    """A composed value object, not inherited — per the spec's explicit
    instruction. Kept as its own table (not flat fields on CarListing)
    so the same VehicleSpec shape could later be reused elsewhere (e.g.
    a RideBooking's vehicle) without duplicating the field list."""
    car_listing = models.OneToOneField(CarListing, on_delete=models.CASCADE, related_name="vehicle_spec")
    make = models.CharField(max_length=100)
    model = models.CharField(max_length=100)
    year = models.PositiveSmallIntegerField()
    mileage_km = models.PositiveIntegerField(null=True, blank=True)
    engine_size_cc = models.PositiveIntegerField(null=True, blank=True)
    trim = models.CharField(max_length=60, blank=True)
    body_type = models.CharField(max_length=12, choices=CarBodyType.choices, blank=True)
    fuel_type = models.CharField(max_length=10, choices=FuelType.choices, blank=True)
    transmission = models.CharField(max_length=10, choices=Transmission.choices, blank=True)
    drivetrain = models.CharField(max_length=5, choices=Drivetrain.choices, blank=True)
    exterior_color = models.CharField(max_length=30, blank=True)
    interior_color = models.CharField(max_length=30, blank=True)
    doors = models.PositiveSmallIntegerField(null=True, blank=True)
    seats = models.PositiveSmallIntegerField(null=True, blank=True)
    vehicle_condition = models.CharField(max_length=15, choices=VehicleCondition.choices, blank=True)
    # Paperwork buyers in Cameroon ask about first: customs cleared (dédouané) and the carte grise in the seller's name.
    customs_cleared = models.BooleanField(null=True, blank=True)
    registration_in_seller_name = models.BooleanField(null=True, blank=True)
    previous_owners = models.PositiveSmallIntegerField(null=True, blank=True)
    accident_free = models.BooleanField(null=True, blank=True)
    service_history = models.BooleanField(null=True, blank=True)
    features = models.JSONField(default=list, blank=True)
    # Chassis number (VIN). Only its last 6 characters are ever shown to anyone but the lister.
    vin = models.CharField(max_length=17, blank=True)

    class Meta:
        db_table = "vehicle_specs"


class MarketplaceMedia(models.Model):
    class MediaType(models.TextChoices):
        PHOTO = "PHOTO", "Photo"
        VIDEO = "VIDEO", "Video"

    listing = models.ForeignKey(MarketplaceListingBase, on_delete=models.CASCADE, related_name="media")
    media_type = models.CharField(max_length=10, choices=MediaType.choices)
    file_url = models.URLField()
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "marketplace_media"
        ordering = ["order"]


class ListingCondition(models.Model):
    """A flexible, OPTIONAL condition set attachable to ANY listing
    (marketplace OR the existing property.Listing) — structured key-
    value pairs for filtering (min_lease_months, deposit_required,
    pet_policy, mileage_cap_km, driver_required, insurance_required,
    viewing_appointment_only, no_subletting) plus a free-text clause.

    WHY a generic (content_type, id) reference instead of a FK per
    listing type: this needs to attach to property.Listing AND every
    marketplace subclass alike — a separate FK field per type would mean
    a schema change every time a new listing category is added, exactly
    the problem the catalogue's generic Amenity pattern also avoids."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    target_content_type = models.CharField(max_length=50)  # e.g. "marketplace.WarehouseListing"
    target_id = models.UUIDField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    structured_conditions = models.JSONField(default=dict)
    free_text_clause = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "listing_conditions"
        indexes = [models.Index(fields=["target_content_type", "target_id"])]


class MarketplaceOrderStatus(models.TextChoices):
    PAYMENT_PENDING = "PAYMENT_PENDING", "Payment pending"
    PAID = "PAID", "Paid into escrow"
    HANDED_OVER = "HANDED_OVER", "Handed over"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"
    DISPUTED = "DISPUTED", "Disputed"


class DepositStatus(models.TextChoices):
    NONE = "NONE", "No deposit"
    HELD = "HELD", "Held"
    CLAIMED = "CLAIMED", "Claimed by the seller"
    RETURNED = "RETURNED", "Returned to the renter"
    FORFEITED = "FORFEITED", "Paid to the seller"
    SPLIT = "SPLIT", "Split between the seller and the renter"


class MarketplaceOrder(models.Model):
    """A buyer's purchase (or first rental period) of one marketplace listing. The money sits in the
    shared PaymentEscrow until the buyer confirms they got what they paid for, so neither side has to
    trust the other. Settles through the same Booking/escrow machinery as every other transaction.

    A rental with a security deposit is paid in one charge, then split on confirmation: the rent stays in
    `booking`'s escrow, and the deposit gets its own booking and escrow so it can be returned or paid to the
    seller independently of the rent."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    listing = models.ForeignKey(MarketplaceListingBase, on_delete=models.PROTECT, related_name="orders")
    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="marketplace_orders")
    booking = models.OneToOneField("transactions.Booking", on_delete=models.PROTECT, related_name="marketplace_order")
    amount_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(max_length=15, choices=MarketplaceOrderStatus.choices, default=MarketplaceOrderStatus.PAYMENT_PENDING)
    handed_over_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Rentals only: the rental runs from the handover for one period of the listing's price basis.
    rental_starts_on = models.DateField(null=True, blank=True)
    rental_ends_on = models.DateField(null=True, blank=True)
    relisted_at = models.DateTimeField(null=True, blank=True)
    deposit_xaf = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    deposit_status = models.CharField(max_length=10, choices=DepositStatus.choices, default=DepositStatus.NONE)
    deposit_booking = models.OneToOneField(
        "transactions.Booking", on_delete=models.PROTECT, null=True, blank=True, related_name="marketplace_deposit_order",
    )
    deposit_settled_at = models.DateTimeField(null=True, blank=True)
    # Car rentals booked for chosen dates: the rental dates are fixed at booking and the listing stays on the
    # market for other dates instead of going under offer.
    booked_dates = models.BooleanField(default=False)
    rental_days = models.PositiveSmallIntegerField(null=True, blank=True)
    with_driver = models.BooleanField(default=False)
    delivery_requested = models.BooleanField(default=False)
    price_breakdown = models.JSONField(default=dict, blank=True)
    # A booking request on a car without instant booking: the owner must accept it before the handover.
    needs_approval = models.BooleanField(default=False)
    owner_approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "marketplace_orders"
        ordering = ["-created_at"]


class RideStatus(models.TextChoices):
    REQUESTED = "REQUESTED", "Requested"
    ACCEPTED = "ACCEPTED", "Accepted"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class RideCategory(models.TextChoices):
    """The real gap this closes: every ride previously used one
    single fare formula regardless of vehicle — no way to choose a
    cheaper moto-taxi over a car, or a comfort tier, the way Yango
    (the real ride-hailing app Cameroonians actually use day to day)
    already lets riders choose. VAN and TRUCK exist specifically for
    CARGO rides — see TransportType below — not for passenger trips."""
    MOTO = "MOTO", "Moto (motorcycle taxi)"
    STANDARD = "STANDARD", "Standard Car"
    COMFORT = "COMFORT", "Comfort"
    VAN = "VAN", "Van"
    TRUCK = "TRUCK", "Truck"


class LuggageSize(models.TextChoices):
    SMALL = "SMALL", "Small (backpack, handbag)"
    MEDIUM = "MEDIUM", "Medium (cabin suitcase)"
    LARGE = "LARGE", "Large (big suitcase, sack)"
    BULKY = "BULKY", "Bulky (several large items)"


class TransportType(models.TextChoices):
    """Per the founder's own explicit real-estate use case: Rides
    isn't only for moving people — a landlord or agent regularly
    needs to move building materials, furniture, or documents between
    properties, sometimes with no passenger involved at all. Modeled
    as a real, distinct request type rather than overloading
    cargo_description onto a passenger trip."""
    PASSENGER = "PASSENGER", "Passenger"
    CARGO = "CARGO", "Cargo / Building Materials"


class DriverProfile(models.Model):
    """A real, admin-verified driver registration — the actual gap
    this closes: previously ANY signed-in user could accept a ride
    and become its driver, with no vetting at all. Mirrors the exact
    verified-by-default-False pattern just built for Hotel/Venue —
    only a verified driver can accept a real ride (see accept_ride())."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="driver_profile")
    license_number = models.CharField(max_length=50)
    is_verified = models.BooleanField(default=False)
    # Where the driver last reported being; online drivers only see open requests near them.
    is_online = models.BooleanField(default=False)
    last_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    last_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "driver_profiles"


class Vehicle(models.Model):
    """A real registered vehicle tied to a driver — accept_ride()
    requires the accepting driver to name one of their own registered
    vehicles, and that vehicle's category must genuinely match what
    the ride actually needs (a moto can't fulfill a cargo request that
    needs a van or truck)."""
    driver = models.ForeignKey(DriverProfile, on_delete=models.CASCADE, related_name="vehicles")
    vehicle_category = models.CharField(max_length=10, choices=RideCategory.choices)
    make = models.CharField(max_length=50)
    model = models.CharField(max_length=50)
    plate_number = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "vehicles"


class RideBooking(models.Model):
    """Deliberately NOT a Listing subtype — it represents a TRANSACTION
    (like services.ServiceRequest), not a property/item for sale. Settles
    through the existing Booking/PaymentEscrow, never a separate payment
    path — see marketplace/services.py's complete_ride_with_payment()."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rider = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rides_as_rider")
    driver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="rides_as_driver")
    vehicle = models.ForeignKey(Vehicle, on_delete=models.SET_NULL, null=True, blank=True, related_name="rides")
    pickup_description = models.CharField(max_length=255)
    pickup_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    pickup_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    dropoff_description = models.CharField(max_length=255)
    dropoff_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    dropoff_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    fare_estimate_xaf = models.DecimalField(max_digits=10, decimal_places=2)
    # Null on rides requested before the distance was stored.
    distance_km = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=15, choices=RideStatus.choices, default=RideStatus.REQUESTED)
    ride_category = models.CharField(max_length=10, choices=RideCategory.choices, default=RideCategory.STANDARD)
    transport_type = models.CharField(max_length=10, choices=TransportType.choices, default=TransportType.PASSENGER)
    has_luggage = models.BooleanField(default=False)
    # What the rider says about their luggage so the driver can judge if it fits: how many bags, how big, and up
    # to 3 photos (URLs from the shared upload pipeline).
    luggage_count = models.PositiveSmallIntegerField(null=True, blank=True)
    luggage_size = models.CharField(max_length=10, choices=LuggageSize.choices, blank=True)
    luggage_photo_urls = models.JSONField(default=list, blank=True)
    cargo_description = models.CharField(max_length=255, blank=True)
    booking = models.OneToOneField("transactions.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="ride_booking")
    requested_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # Set when the rider or the driver presses SOS during a trip; admins are alerted.
    sos_raised_at = models.DateTimeField(null=True, blank=True)
    sos_raised_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    sos_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    sos_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    sos_note = models.CharField(max_length=500, blank=True)
    # An admin marks the SOS handled; pressing SOS again reopens it.
    sos_resolved_at = models.DateTimeField(null=True, blank=True)
    sos_resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = "ride_bookings"


class RideMessage(models.Model):
    """In-trip private chat between the rider and the assigned driver."""
    ride = models.ForeignKey(RideBooking, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ride_messages")
    text = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ride_messages"
        ordering = ["created_at"]


class RideEmergencyContact(models.Model):
    """Someone a user wants told when they press SOS on a ride. One per user, chosen by the user themselves."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ride_emergency_contact")
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ride_emergency_contacts"
