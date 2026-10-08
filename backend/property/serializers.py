"""property.serializers — read-heavy serializers for search/browse,
matching the acceptance criteria's explicit 'test the property search
endpoint and confirm real results' requirement."""
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import serializers
from .models import PropertyAsset, Listing, House, Shop, FinishLevel, HouseStyle, ListingType


class ListingEditSerializer(serializers.Serializer):
    """Fields a lister may change after publishing; every field is optional (PATCH semantics)."""
    price_xaf = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=1)
    listing_type = serializers.ChoiceField(choices=ListingType.choices)
    description = serializers.CharField(allow_blank=True, max_length=5000)
    size_sqm = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, allow_null=True)
    finish_level = serializers.ChoiceField(choices=FinishLevel.choices)
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, min_value=-90, max_value=90, allow_null=True)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, min_value=-180, max_value=180, allow_null=True)
    amenities = serializers.ListField(child=serializers.CharField(), max_length=30)
    bedrooms = serializers.IntegerField(min_value=0, max_value=100)
    bathrooms = serializers.IntegerField(min_value=0, max_value=100)
    living_rooms = serializers.IntegerField(min_value=0, max_value=100)
    house_style = serializers.ChoiceField(choices=HouseStyle.choices)
    has_garage = serializers.BooleanField()
    pets_allowed = serializers.BooleanField()
    frontage_meters = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=0, allow_null=True)

    def validate(self, attrs):
        if ("latitude" in attrs) != ("longitude" in attrs) or (attrs.get("latitude") is None) != (attrs.get("longitude") is None):
            raise serializers.ValidationError("Latitude and longitude must be set or cleared together.")
        return attrs


class ListerRatingSerializerMixin(serializers.Serializer):
    """Average rating the lister (the asset's owner by default) has received, shown on every browse card."""
    lister_average_rating = serializers.SerializerMethodField()
    lister_rating_count = serializers.SerializerMethodField()

    def _lister_user_id(self, obj):
        return obj.owner_id

    def _lister_rating(self, obj) -> dict:
        # Cached per serializer run so a page of cards by one lister costs a single query.
        user_id = self._lister_user_id(obj)
        cache = self.context.setdefault("_lister_rating_cache", {})
        if user_id not in cache:
            from django.db.models import Avg, Count
            from social.models import Rating
            cache[user_id] = Rating.objects.filter(subject_user_id=user_id).aggregate(avg=Avg("score"), count=Count("id"))
        return cache[user_id]

    def get_lister_average_rating(self, obj) -> float | None:
        avg = self._lister_rating(obj)["avg"]
        return round(float(avg), 1) if avg is not None else None

    def get_lister_rating_count(self, obj) -> int:
        return self._lister_rating(obj)["count"]


class OwnerRoleSerializerMixin(ListerRatingSerializerMixin):
    """Exposes whether the asset's owner is a landlord, an agent or an agency member, same rule as Listing.lister_role."""
    lister_role = serializers.SerializerMethodField()

    def get_lister_role(self, obj) -> str:
        agent_profile = getattr(obj.owner, "agent_profile", None)
        if agent_profile is None:
            return "OWNER"
        return "AGENCY" if agent_profile.agency_id else "AGENT"


class HouseCreateSerializer(serializers.ModelSerializer):
    """WHY owner is never a client-supplied field: same reasoning as
    Listing.listed_by — it must always be the actual authenticated
    requester, set in perform_create(), never trusted from the request body."""
    class Meta:
        model = House
        fields = [
            "id", "quarter", "size_sqm", "description", "finish_level", "latitude", "longitude",
            "distance_to_tarmac_km", "bedrooms", "bathrooms", "living_rooms", "pets_allowed", "has_garage", "house_style", "custom_house_style",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {"latitude": {"min_value": -90, "max_value": 90}, "longitude": {"min_value": -180, "max_value": 180}}


class ShopCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Shop
        fields = [
            "id", "quarter", "size_sqm", "description", "finish_level", "latitude", "longitude",
            "distance_to_tarmac_km", "frontage_meters",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {"latitude": {"min_value": -90, "max_value": 90}, "longitude": {"min_value": -180, "max_value": 180}}


class PropertyAssetSummarySerializer(serializers.ModelSerializer):
    """A lean summary for search RESULTS — full detail serializers per
    subtype (House, Land, Shop...) are a natural next extension of this
    same pattern, not built here to keep this pass focused on what the
    acceptance criteria actually asks for."""
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    nearby_facility_names = serializers.SerializerMethodField()
    bedrooms = serializers.SerializerMethodField()
    bathrooms = serializers.SerializerMethodField()
    living_rooms = serializers.SerializerMethodField()
    house_style = serializers.SerializerMethodField()
    has_garage = serializers.SerializerMethodField()
    pets_allowed = serializers.SerializerMethodField()

    def get_nearby_facility_names(self, property_asset) -> list[str]:
        return [f"{poi.name} ({poi.get_poi_type_display()})" for poi in property_asset.nearby_facilities.all()]

    @staticmethod
    def _house_field(property_asset, name):
        # Bedrooms etc. only exist on House, not Land or Shop. A Listing's
        # property_asset is the multi-table-inheritance base row, so the
        # House child must be reached through the reverse `house` link.
        if hasattr(property_asset, name):
            return getattr(property_asset, name)
        try:
            return getattr(property_asset.house, name)
        except ObjectDoesNotExist:
            return None

    def get_bedrooms(self, property_asset) -> int | None:
        return self._house_field(property_asset, "bedrooms")

    def get_bathrooms(self, property_asset) -> int | None:
        return self._house_field(property_asset, "bathrooms")

    def get_living_rooms(self, property_asset) -> int | None:
        return self._house_field(property_asset, "living_rooms")

    def get_house_style(self, property_asset) -> str | None:
        return self._house_field(property_asset, "house_style")

    def get_has_garage(self, property_asset) -> bool | None:
        return self._house_field(property_asset, "has_garage")

    def get_pets_allowed(self, property_asset) -> bool | None:
        return self._house_field(property_asset, "pets_allowed")

    class Meta:
        model = PropertyAsset
        fields = [
            "id", "type", "size_sqm", "finish_level", "quarter", "quarter_name", "latitude", "longitude", "description",
            "amenities", "house_rules", "nearby_facilities", "nearby_facility_names", "bedrooms", "bathrooms",
            "living_rooms", "house_style", "has_garage", "pets_allowed",
        ]
        # WHY these three are read-only here: writes go through
        # dedicated actions (set-amenities/set-house-rules/set-nearby-
        # facilities) that call the real validated service functions
        # instead — a raw M2M/JSONField write through this serializer
        # would bypass set_property_amenities()'s real validation
        # against the fixed PropertyAmenity list entirely.
        read_only_fields = ["amenities", "house_rules", "nearby_facilities"]


class ListingSerializer(ListerRatingSerializerMixin, serializers.ModelSerializer):
    """WHY property_asset_id exists as a SEPARATE write-only field
    rather than making property_asset itself writable: every existing
    page (PropertyCard, search, listing detail, hotels...) already
    reads listing.property_asset as the full nested object — changing
    that shape would break every page that already depends on it.
    property_asset_id is what a CREATE request actually supplies (just
    the ID of an already-created property), while every READ still
    returns the full nested detail under property_asset, unchanged.

    lister_role/lister_display_name/lister_agency_name/lister_id: per
    the founder's explicit requirement, a viewer needs to SEE —
    visually, at a glance — whether a listing came from the property
    owner directly, an agent, or an agency, since real people have a
    genuine preference either way."""
    property_asset = PropertyAssetSummarySerializer(read_only=True)
    property_asset_id = serializers.PrimaryKeyRelatedField(
        source="property_asset", queryset=PropertyAsset.objects.all(), write_only=True,
    )
    lister_role = serializers.CharField(read_only=True)
    lister_display_name = serializers.CharField(read_only=True)
    lister_agency_name = serializers.CharField(read_only=True)
    lister_id = serializers.CharField(source="listed_by.id", read_only=True)
    photos = serializers.SerializerMethodField()

    def _lister_user_id(self, listing):
        return listing.listed_by_id

    def get_photos(self, listing) -> list[dict]:
        return [{"id": p.id, "url": p.url, "media_type": p.media_type, "is_primary": p.is_primary} for p in listing.photos.all()]

    class Meta:
        model = Listing
        fields = [
            "id", "property_asset", "property_asset_id", "listing_type", "status", "price_xaf",
            "published_at", "expires_at", "created_at",
            "lister_role", "lister_display_name", "lister_agency_name", "lister_id",
            "lister_average_rating", "lister_rating_count", "photos",
        ]
        read_only_fields = ["status", "published_at", "expires_at"]
