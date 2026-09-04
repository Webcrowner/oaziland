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
    quarter = models.ForeignKey("geo.Quarter", on_delete=models.SET_NULL, null=True, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    availability_status = models.CharField(max_length=15, choices=AvailabilityStatus.choices, default=AvailabilityStatus.AVAILABLE)
    created_at = models.DateTimeField(auto_now_add=True)

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


class CarListing(MarketplaceListingBase):
    """For sale OR for rent — price_basis (inherited) already
    distinguishes these; the car's own specs live in the composed
    VehicleSpec below, not duplicated as flat fields here."""

    class Meta:
        db_table = "car_listings"


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


class RideStatus(models.TextChoices):
    REQUESTED = "REQUESTED", "Requested"
    ACCEPTED = "ACCEPTED", "Accepted"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class RideBooking(models.Model):
    """Deliberately NOT a Listing subtype — it represents a TRANSACTION
    (like services.ServiceRequest), not a property/item for sale. Settles
    through the existing Booking/PaymentEscrow, never a separate payment
    path — see marketplace/services.py's complete_ride_with_payment()."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rider = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rides_as_rider")
    driver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="rides_as_driver")
    pickup_description = models.CharField(max_length=255)
    pickup_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    pickup_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    dropoff_description = models.CharField(max_length=255)
    dropoff_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    dropoff_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    fare_estimate_xaf = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=15, choices=RideStatus.choices, default=RideStatus.REQUESTED)
    booking = models.OneToOneField("transactions.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="ride_booking")
    requested_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ride_bookings"
