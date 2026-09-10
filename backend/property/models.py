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


class FinishLevel(models.TextChoices):
    """WHY this lives on the base PropertyAsset, not a Cameroon-specific
    model or field: 'modern vs. not modern' is a universal distinction
    a renter/buyer cares about in any country this platform operates
    in — it just happens to be an especially decisive factor in the
    Cameroonian market, per the founder's explicit note. Blank/optional
    since it's meaningless for Land (see PropertyAsset.finish_level's
    blank=True below)."""
    MODERN = "MODERN", "Modern"
    STANDARD = "STANDARD", "Standard (Not Modern)"


class PropertyAmenity(models.TextChoices):
    """A FIXED list, matching the same validated-choice pattern already
    used for ServiceCategory (services app) — a real value listers pick
    from, not free text that would fragment into a dozen near-duplicate
    spellings of 'parking' across different listings."""
    PARKING = "PARKING", "Parking"
    BACKUP_GENERATOR = "BACKUP_GENERATOR", "Backup Generator"
    BOREHOLE_WATER_TANK = "BOREHOLE_WATER_TANK", "Borehole / Water Tank"
    SECURITY_24_7 = "SECURITY_24_7", "24/7 Security"
    FENCED_COMPOUND = "FENCED_COMPOUND", "Fenced Compound"
    SWIMMING_POOL = "SWIMMING_POOL", "Swimming Pool"
    AIR_CONDITIONING = "AIR_CONDITIONING", "Air Conditioning"
    FURNISHED = "FURNISHED", "Furnished"
    SOLAR_POWER = "SOLAR_POWER", "Solar Power"
    CCTV = "CCTV", "CCTV"
    BALCONY_TERRACE = "BALCONY_TERRACE", "Balcony / Terrace"
    WIFI_READY = "WIFI_READY", "WiFi Ready"


class HouseRule(models.TextChoices):
    """Also a FIXED list — the same real reasoning as PropertyAmenity:
    a consistent, filterable set of real rules rather than each lister
    phrasing 'no pets' a different way."""
    NO_PETS = "NO_PETS", "No Pets"
    NO_SMOKING_INDOORS = "NO_SMOKING_INDOORS", "No Smoking Indoors"
    NO_SUBLETTING = "NO_SUBLETTING", "No Subletting"
    NO_PARTIES = "NO_PARTIES", "No Parties / Loud Events"
    QUIET_HOURS_AFTER_10PM = "QUIET_HOURS_AFTER_10PM", "Quiet Hours After 10PM"
    ADVANCE_NOTICE_FOR_VISITS = "ADVANCE_NOTICE_FOR_VISITS", "Advance Notice Required for Visits"


class PropertyAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="owned_properties",
    )
    quarter = models.ForeignKey("geo.Quarter", on_delete=models.PROTECT, related_name="properties")
    type = models.CharField(max_length=30, choices=PropertyType.choices)
    size_sqm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    description = models.TextField(blank=True)
    finish_level = models.CharField(max_length=10, choices=FinishLevel.choices, blank=True)  # blank = not applicable (e.g. Land) or not yet specified
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    distance_to_tarmac_km = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    # WHY a plain JSONField, validated at the SERVICE layer rather than
    # a real ManyToManyField to a choices table: matches the exact
    # pattern already established for TechnicianProfile.specialties
    # (identity app) — a real fixed list, enforced by a service
    # function (set_property_amenities), not by the database schema
    # itself, keeping this consistent with how the rest of this
    # codebase already handles "a list of values from a fixed set."
    amenities = models.JSONField(default=list, blank=True)  # PropertyAmenity values
    house_rules = models.JSONField(default=list, blank=True)  # HouseRule values
    # A REAL relation to REAL geo data — reuses geo.PointOfInterest
    # (already populated with real universities, hospitals, markets,
    # etc.) rather than a second, freeform "nearby facilities" text
    # field that would just duplicate data that already exists.
    nearby_facilities = models.ManyToManyField("geo.PointOfInterest", blank=True, related_name="nearby_properties")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "property_assets"
        indexes = [
            models.Index(fields=["quarter", "type"]),
            models.Index(fields=["owner"]),
            models.Index(fields=["finish_level"]),
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
    """A multi-unit property. Rooms/studios/apartments within it are
    separate Unit records with their own Listings — so some units can be
    for rent while others are for sale, simultaneously."""

    class Meta:
        db_table = "buildings"

    def bulk_create_units(self, unit_class, count: int, room_code_prefix: str, **shared_fields):
        """Creates `count` units of the same type in one action — e.g. a
        landlord onboarding 40 identical studio apartments in one
        compound, per Prompt 4's acceptance criteria.

        WHY this lives on Building rather than being "create 40 units,
        one API call each": that would let two of them accidentally get
        the same room_code if two requests overlapped. Generating all
        the codes together, in one place, guarantees uniqueness.

        `unit_class` is one of RoomUnit, StudioUnit, or ApartmentUnit.
        `room_code_prefix` becomes e.g. "A-101", "A-102", ... "A-140".
        `shared_fields` are any fields every created unit should share
        (e.g. size_sqm=18 for 40 identical studios).
        """
        existing_count = self.units.count()
        created = []
        for i in range(count):
            room_number = existing_count + i + 1
            unit = unit_class.objects.create(
                building=self,
                room_code=f"{room_code_prefix}-{room_number}",
                **shared_fields,
            )
            created.append(unit)
        return created


class KitchenAccess(models.TextChoices):
    VERANDA = "VERANDA", "Veranda"
    SHARED_CORRIDOR = "SHARED_CORRIDOR", "Shared Corridor"
    NONE = "NONE", "None"


class KitchenType(models.TextChoices):
    OPEN_AMERICAN_STYLE = "OPEN_AMERICAN_STYLE", "Open (American Style)"
    PARTITIONED = "PARTITIONED", "Partitioned"


class Unit(models.Model):
    """The shared base for every kind of room inside a Building. Deliberately
    NOT one flat model with a 'unit_type' flag — Room, Studio, and
    Apartment genuinely differ in which fields make sense (a Room has no
    kitchen of its own; an Apartment has a separate salon and multiple
    bedrooms) — using real subtypes means you can't accidentally set
    'separate_salon' on a Room, because a Room doesn't have that field
    at all.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    building = models.ForeignKey(Building, on_delete=models.CASCADE, related_name="units")
    room_code = models.CharField(max_length=50)  # e.g. "A-101" — unique per building
    size_sqm = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "units"
        unique_together = [("building", "room_code")]  # unique PER BUILDING, not globally

    def __str__(self):
        return f"{self.room_code} ({self.__class__.__name__})"


class RoomUnit(Unit):
    """Chambre Moderne: a single private room. Internal bathroom, but no
    kitchen of its own — tenants typically cook on a veranda or in a
    shared outdoor corridor, hence kitchen_access instead of a kitchen."""
    internal_bathroom = models.BooleanField(default=True)
    kitchen_access = models.CharField(max_length=20, choices=KitchenAccess.choices, default=KitchenAccess.NONE)

    class Meta:
        db_table = "room_units"


class StudioUnit(Unit):
    """Studio Américain: one main living/sleeping area with its own
    bathroom AND kitchen — kitchen_type is what most distinguishes it
    from both a Room (no kitchen) and an Apartment (separate kitchen
    room, not open-plan)."""
    kitchen_type = models.CharField(max_length=25, choices=KitchenType.choices, default=KitchenType.PARTITIONED)

    class Meta:
        db_table = "studio_units"


class ApartmentUnit(Unit):
    """Appartement Standard: the only residential unit type with a fully
    separate living room (salon) and multiple bedrooms/bathrooms as
    first-class fields — targets families and long-term tenants."""
    bedrooms = models.PositiveSmallIntegerField(default=1)
    bathrooms = models.PositiveSmallIntegerField(default=1)
    separate_salon = models.BooleanField(default=True)

    class Meta:
        db_table = "apartment_units"


class HouseStyle(models.TextChoices):
    """A real gap this closes: the original three options (Standard/
    Duplex/Detached Villa) didn't cover how residential units are
    actually described and searched for in Cameroon — a single room
    in a shared compound, a self-contained one-room unit with its own
    bathroom, and a multi-room apartment within a building are all
    genuinely different things a renter searches for differently, not
    variations of "a house." OTHER exists specifically so a lister is
    never blocked by an incomplete list — House.custom_house_style
    captures their own description when they pick it."""
    ROOM = "ROOM", "Room (in a shared compound)"
    STUDIO = "STUDIO", "Studio"
    SELF_CONTAIN = "SELF_CONTAIN", "Self-Contain"
    APARTMENT = "APARTMENT", "Apartment / Flat"
    STANDARD = "STANDARD", "Standalone House"
    DUPLEX = "DUPLEX", "Duplex"
    BUNGALOW = "BUNGALOW", "Bungalow"
    DETACHED_VILLA = "DETACHED_VILLA", "Detached Villa"
    CHALET = "CHALET", "Chalet"
    OTHER = "OTHER", "Other (please specify)"


class House(PropertyAsset):
    bedrooms = models.PositiveSmallIntegerField(default=0)
    bathrooms = models.PositiveSmallIntegerField(default=0)
    pets_allowed = models.BooleanField(default=False)
    has_garage = models.BooleanField(default=False)
    house_style = models.CharField(max_length=20, choices=HouseStyle.choices, default=HouseStyle.STANDARD)
    custom_house_style = models.CharField(
        max_length=100, blank=True,
        help_text="Only used when house_style is OTHER — the lister's own description of the unit type.",
    )
    is_furnished_short_let = models.BooleanField(default=False)
    short_let_daily_rate_xaf = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

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


class CorporateOffice(PropertyAsset):
    """Bureau: administrative workspace in central business districts.
    No extra fields beyond PropertyAsset yet — kept as its own class
    (not folded into CommercialSpace) because it has a genuinely
    different target audience and will likely need office-specific
    fields (floor number, meeting rooms) as the platform grows."""

    class Meta:
        db_table = "corporate_offices"


class EventCenter(PropertyAsset):
    """Salle de Fêtes: large venues booked for weddings, meetings,
    gatherings. A single Event Center property can have multiple bookable
    VenueSpace sub-areas (a main hall AND a smaller side room, for
    example) — see VenueSpace below."""

    class Meta:
        db_table = "event_centers"


class VenueSpace(models.Model):
    event_center = models.ForeignKey(EventCenter, on_delete=models.CASCADE, related_name="venue_spaces")
    name = models.CharField(max_length=200)
    capacity = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "venue_spaces"


class GuestHouseLodge(PropertyAsset):
    """Auberge: hospitality/leisure property, popular in coastal tourist
    towns like Kribi and Limbe."""
    is_coastal_leisure = models.BooleanField(default=False)

    class Meta:
        db_table = "guest_house_lodges"


class MixedUseBuilding(PropertyAsset):
    """Immeuble de Rapport: retail on the ground floor, residential
    rentals above — one PropertyAsset record with a shared address."""
    ground_floor_shops = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "mixed_use_buildings"


class Warehouse(PropertyAsset):
    """Entrepôt: industrial storage used by import-export operators and
    wholesale merchants."""
    storage_capacity_sqm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "warehouses"


class BadgeType(models.TextChoices):
    VERIFIED_DOCUMENT = "VERIFIED_DOCUMENT", "Verified Document"
    SITE_VISIT_VERIFIED = "SITE_VISIT_VERIFIED", "Site Visit Verified"
    BORNES_VISIBLES = "BORNES_VISIBLES", "Bornes Visibles (Corners Marked)"
    TITLE_TYPE = "TITLE_TYPE", "Title Type Confirmed"
    IDENTITY_KYC = "IDENTITY_KYC", "Identity KYC"


class BadgeStatus(models.TextChoices):
    NOT_SUBMITTED = "NOT_SUBMITTED", "Not Submitted"
    PENDING = "PENDING", "Pending Review"
    VERIFIED = "VERIFIED", "Verified"
    REJECTED = "REJECTED", "Rejected"


class VerificationBadge(models.Model):
    """ONE generic, reusable badge model attached to any PropertyAsset —
    a Land parcel might carry a BORNES_VISIBLES badge, a Guest House
    might carry a SITE_VISIT_VERIFIED badge, any property might carry a
    VERIFIED_DOCUMENT badge. WHY generic instead of a boolean field per
    badge type on each subtype: a new badge type (say, "flood risk
    assessed" later) becomes one new BadgeType choice, not a database
    migration adding a column to six different tables."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property_asset = models.ForeignKey(PropertyAsset, on_delete=models.CASCADE, related_name="verification_badges")
    badge_type = models.CharField(max_length=30, choices=BadgeType.choices)
    status = models.CharField(max_length=20, choices=BadgeStatus.choices, default=BadgeStatus.NOT_SUBMITTED)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="badges_verified",
    )
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "verification_badges"
        unique_together = [("property_asset", "badge_type")]  # one badge of each type per property

    def approve(self, admin_user):
        """Marks this badge verified. Kept as a method (not a bare status
        assignment scattered wherever an admin approves something) so
        verified_by and verified_at are always set together, correctly,
        every time."""
        from django.utils import timezone
        self.status = BadgeStatus.VERIFIED
        self.verified_by = admin_user
        self.verified_at = timezone.now()
        self.save(update_fields=["status", "verified_by", "verified_at"])


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
    EXPIRED = "EXPIRED", "Expired"


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
    # WHY this exists: a listing left up indefinitely with no
    # expectation of renewal accumulates stale/dead ads nobody's
    # actually managing — a real problem for search quality and for
    # the person searching. Set automatically on publish(); a landlord/
    # agent gets reminded before it lapses and can renew in one call.
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "listings"
        indexes = [
            models.Index(fields=["status", "listing_type"]),
            models.Index(fields=["property_asset"]),
        ]

    LISTING_DURATION_DAYS = 90  # a sensible, configurable default lifespan for an active listing

    @property
    def lister_role(self) -> str:
        """WHY this is computed, not a stored field: the underlying
        facts (who owns the property, whether the lister has an
        AgentProfile, whether that agent belongs to an agency) can all
        change independently — a stored role would drift out of sync
        the moment any of them did. Per the founder's explicit
        requirement: some people specifically want to deal directly
        with an owner, others prefer an agent or agency — this is what
        makes that distinction real and visible, not guessed."""
        if hasattr(self.listed_by, "agent_profile"):
            return "AGENCY" if self.listed_by.agent_profile.agency else "AGENT"
        return "OWNER"

    @property
    def lister_display_name(self) -> str:
        return self.listed_by.full_name or self.listed_by.username

    @property
    def lister_agency_name(self):
        if hasattr(self.listed_by, "agent_profile") and self.listed_by.agent_profile.agency:
            return self.listed_by.agent_profile.agency.user.full_name or self.listed_by.agent_profile.agency.user.username
        return None

    def publish(self):
        self.status = ListingStatus.PUBLISHED
        from django.utils import timezone
        from datetime import timedelta
        now = timezone.now()
        self.published_at = now
        self.expires_at = now + timedelta(days=self.LISTING_DURATION_DAYS)
        self.save(update_fields=["status", "published_at", "expires_at"])

    def renew(self, extra_days: int = None):
        """Self-service renewal — extends expires_at from NOW, not from
        the old expiry date, so renewing a listing that's already
        expired gives a full fresh period rather than compounding from
        a stale date in the past."""
        from django.utils import timezone
        from datetime import timedelta
        now = timezone.now()
        self.expires_at = now + timedelta(days=extra_days or self.LISTING_DURATION_DAYS)
        if self.status == ListingStatus.EXPIRED:
            self.status = ListingStatus.PUBLISHED
        self.save(update_fields=["expires_at", "status"])

    def close(self):
        self.status = ListingStatus.CLOSED
        self.save(update_fields=["status"])


class LegalStatus(models.TextChoices):
    TITRE_FONCIER = "TITRE_FONCIER", "Titre Foncier"
    AVENANT = "AVENANT", "Avenant"
    DROIT_FONCIER_COUTUMIER = "DROIT_FONCIER_COUTUMIER", "Droit Foncier Coutumier"
    TERRAIN_NON_TITRE = "TERRAIN_NON_TITRE", "Terrain Non Titré"


class WaterSource(models.TextChoices):
    CAMWATER_CDE = "CAMWATER_CDE", "Camwater (CDE)"
    FORAGE_BOREHOLE = "FORAGE_BOREHOLE", "Forage (Borehole)"
    PUITS_WELL = "PUITS_WELL", "Puits (Well)"


class ElectricityMeterType(models.TextChoices):
    ENEO_PREPAID = "ENEO_PREPAID", "Eneo Prepaid"
    ENEO_POSTPAID = "ENEO_POSTPAID", "Eneo Postpaid"


class RoadAccessibility(models.TextChoices):
    TARRED = "TARRED", "Au bord du goudron (Tarred)"
    CAR_ACCESSIBLE = "CAR_ACCESSIBLE", "Accessible by Car"
    MOTO_ONLY = "MOTO_ONLY", "Accessible by Moto Only"


class CameroonMarketDetails(models.Model):
    """Fields a Cameroonian renter/buyer needs to see that a generic
    real-estate schema simply wouldn't have — legal land status, rent
    paid months in advance (a strong local norm, not an edge case),
    and which utilities are actually available. One-to-one with Listing
    rather than fields directly on Listing, so Listing itself stays
    focused on price/status/type and doesn't grow unboundedly as more
    market-specific detail gets added over time."""
    listing = models.OneToOneField(Listing, on_delete=models.CASCADE, related_name="market_details")
    legal_status = models.CharField(max_length=30, choices=LegalStatus.choices, null=True, blank=True)
    rent_advance_months = models.PositiveSmallIntegerField(null=True, blank=True)
    caution_deposit_xaf = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    agency_visit_fee_xaf = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    agency_commission_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    water_source = models.CharField(max_length=20, choices=WaterSource.choices, null=True, blank=True)
    electricity_meter_type = models.CharField(max_length=20, choices=ElectricityMeterType.choices, null=True, blank=True)
    road_accessibility = models.CharField(max_length=20, choices=RoadAccessibility.choices, null=True, blank=True)

    class Meta:
        db_table = "cameroon_market_details"


class GuardStatus(models.TextChoices):
    NONE = "NONE", "No Guard"
    NIGHT_WATCHMAN = "NIGHT_WATCHMAN", "Night Watchman Only"
    SECURITY_24_7 = "SECURITY_24_7", "24/7 Security Guard"


class SecurityFeatures(models.Model):
    """Physical security is a primary search filter in major Cameroonian
    cities, not an optional amenity — kept as its own table (like
    CameroonMarketDetails) rather than more fields bolted onto Listing."""
    listing = models.OneToOneField(Listing, on_delete=models.CASCADE, related_name="security_features")
    fenced_gate = models.BooleanField(default=False)
    secured_openings_antivols = models.BooleanField(default=False)
    guard_status = models.CharField(max_length=20, choices=GuardStatus.choices, default=GuardStatus.NONE)
    parking_spaces = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "security_features"


class ListingPhoto(models.Model):
    """A real gap this closes: Listing had NO photo field at all —
    every listing card and detail page's 'No photo yet' placeholder
    across the whole platform was masking the fact that a lister
    could never actually attach a photo in the first place, not just
    that no test data happened to include one.

    WHY media_type exists despite the model's name: a real video
    walkthrough of a property is a genuinely common, valuable thing a
    lister would want to attach — kept as ListingPhoto rather than
    renaming/splitting into a second model, since every existing
    reference to listing.photos would otherwise need updating for a
    distinction that changes nothing about how these rows are
    queried, ordered, or displayed."""
    class MediaType(models.TextChoices):
        PHOTO = "PHOTO", "Photo"
        VIDEO = "VIDEO", "Video"

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="photos")
    url = models.URLField()
    media_type = models.CharField(max_length=10, choices=MediaType.choices, default=MediaType.PHOTO)
    is_primary = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "listing_photos"
        ordering = ["-is_primary", "uploaded_at"]


class PropertyAssetPhoto(models.Model):
    """The real gap this closes: Hotel, Venue, GuestHouseLodge, and
    StudentHostel are all PropertyAsset subclasses (multi-table
    inheritance, same pattern as House/Land/Shop) but never had a real
    creation path at all — HotelViewSet/VenueViewSet/GuestHouseLodge
    ViewSet/StudentHostelViewSet were all ReadOnlyModelViewSet. Even
    once real creation exists, none of these four go through Listing
    the way House/Land/Shop do (a hotel is booked by room-night, not
    listed for rent/sale), so ListingPhoto (FK to Listing) genuinely
    doesn't apply here — this is a parallel, PropertyAsset-level photo
    model instead, reusable across all four in one place rather than
    four separate near-identical models."""
    class MediaType(models.TextChoices):
        PHOTO = "PHOTO", "Photo"
        VIDEO = "VIDEO", "Video"

    property_asset = models.ForeignKey(PropertyAsset, on_delete=models.CASCADE, related_name="asset_photos")
    url = models.URLField()
    media_type = models.CharField(max_length=10, choices=MediaType.choices, default=MediaType.PHOTO)
    is_primary = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "property_asset_photos"
        ordering = ["-is_primary", "uploaded_at"]
