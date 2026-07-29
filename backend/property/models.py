"""
property — the polymorphic PropertyAsset hierarchy and the Listing that
advertises it. A Listing is deliberately a separate object from the
PropertyAsset it describes (Architecture doc §2.2): the asset is a
permanent record; the Listing is the current advertisement referencing it.

Uses Django's multi-table inheritance so PropertyAsset stays queryable as
a single set (e.g. "all assets in this quarter") while each subtype
(Land, House, Hotel, ...) carries its own specific fields.
"""
import uuid
from django.conf import settings
from django.db import models


class PropertyType(models.TextChoices):
    LAND = "LAND", "Land"
    HOUSE = "HOUSE", "House"
    HOTEL = "HOTEL", "Hotel"
    COMMERCIAL_SPACE = "COMMERCIAL_SPACE", "Commercial Space"
    SHOP = "SHOP", "Shop"
    EVENT_CENTER = "EVENT_CENTER", "Event Center"
    BUILDING = "BUILDING", "Building (multi-unit)"


class PropertyAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="owned_properties",
    )
    quarter = models.ForeignKey("geo.Quarter", on_delete=models.PROTECT, related_name="properties")
    type = models.CharField(max_length=30, choices=PropertyType.choices)
    size_sqm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    description = models.TextField(blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    distance_to_tarmac_km = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "property_assets"
        indexes = [
            models.Index(fields=["quarter", "type"]),
            models.Index(fields=["owner"]),
        ]

    def __str__(self):
        return f"{self.get_type_display()} in {self.quarter}"


class MediaAsset(models.Model):
    class MediaType(models.TextChoices):
        PHOTO = "PHOTO", "Photo"
        VIDEO = "VIDEO", "Video"
        DRONE_VIDEO = "DRONE_VIDEO", "Drone Video"
        VIRTUAL_TOUR = "VIRTUAL_TOUR", "3D/AR Virtual Tour"

    property_asset = models.ForeignKey(
        PropertyAsset, on_delete=models.CASCADE, related_name="media",
    )
    media_type = models.CharField(max_length=20, choices=MediaType.choices)
    file_url = models.URLField()
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "media_assets"
        ordering = ["order"]


class Building(PropertyAsset):
    """A multi-unit property. Rooms/studios/apartments/shops/offices within
    it are separate Unit records with their own Listings — so some units
    can be for rent while others are for sale, simultaneously."""

    class Meta:
        db_table = "buildings"


class Unit(models.Model):
    class UnitType(models.TextChoices):
        ROOM = "ROOM", "Room"
        STUDIO = "STUDIO", "Studio"
        APARTMENT = "APARTMENT", "Apartment"
        OFFICE = "OFFICE", "Office"
        SHOP = "SHOP", "Shop"
        EVENT_SPACE = "EVENT_SPACE", "Event Space"
        AGRICULTURAL_PLOT = "AGRICULTURAL_PLOT", "Agricultural Plot"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    building = models.ForeignKey(Building, on_delete=models.CASCADE, related_name="units")
    unit_type = models.CharField(max_length=20, choices=UnitType.choices)
    size_sqm = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    bedrooms = models.PositiveSmallIntegerField(default=0)
    bathrooms = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "units"


class House(PropertyAsset):
    bedrooms = models.PositiveSmallIntegerField(default=0)
    bathrooms = models.PositiveSmallIntegerField(default=0)
    pets_allowed = models.BooleanField(default=False)
    has_garage = models.BooleanField(default=False)

    class Meta:
        db_table = "houses"


class CommercialSpace(PropertyAsset):
    zoning = models.CharField(max_length=100, blank=True)

    class Meta:
        db_table = "commercial_spaces"


class Shop(PropertyAsset):
    frontage_meters = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "shops"


class ListingType(models.TextChoices):
    RENT = "RENT", "Rent"
    SALE = "SALE", "Sale"


class ListingStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    PENDING_REVIEW = "PENDING_REVIEW", "Pending Review"
    PUBLISHED = "PUBLISHED", "Published"
    UNDER_OFFER = "UNDER_OFFER", "Under Offer"
    CLOSED = "CLOSED", "Closed"
    REJECTED = "REJECTED", "Rejected"


class Listing(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property_asset = models.ForeignKey(
        PropertyAsset, on_delete=models.CASCADE, related_name="listings",
    )
    unit = models.ForeignKey(
        Unit, on_delete=models.CASCADE, related_name="listings", null=True, blank=True,
    )
    listed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="listings",
    )
    listing_type = models.CharField(max_length=10, choices=ListingType.choices)
    status = models.CharField(max_length=20, choices=ListingStatus.choices, default=ListingStatus.DRAFT)
    price_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "listings"
        indexes = [
            models.Index(fields=["status", "listing_type"]),
            models.Index(fields=["property_asset"]),
        ]

    def publish(self):
        self.status = ListingStatus.PUBLISHED
        from django.utils import timezone
        self.published_at = timezone.now()
        self.save(update_fields=["status", "published_at"])

    def close(self):
        self.status = ListingStatus.CLOSED
        self.save(update_fields=["status"])
