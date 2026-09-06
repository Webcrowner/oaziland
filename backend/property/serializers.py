"""property.serializers — read-heavy serializers for search/browse,
matching the acceptance criteria's explicit 'test the property search
endpoint and confirm real results' requirement."""
from rest_framework import serializers
from .models import PropertyAsset, Listing, House, Shop


class HouseCreateSerializer(serializers.ModelSerializer):
    """WHY owner is never a client-supplied field: same reasoning as
    Listing.listed_by — it must always be the actual authenticated
    requester, set in perform_create(), never trusted from the request body."""
    class Meta:
        model = House
        fields = [
            "id", "quarter", "size_sqm", "description", "finish_level", "latitude", "longitude",
            "distance_to_tarmac_km", "bedrooms", "bathrooms", "pets_allowed", "has_garage", "house_style",
        ]
        read_only_fields = ["id"]


class ShopCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Shop
        fields = [
            "id", "quarter", "size_sqm", "description", "finish_level", "latitude", "longitude",
            "distance_to_tarmac_km", "frontage_meters",
        ]
        read_only_fields = ["id"]


class PropertyAssetSummarySerializer(serializers.ModelSerializer):
    """A lean summary for search RESULTS — full detail serializers per
    subtype (House, Land, Shop...) are a natural next extension of this
    same pattern, not built here to keep this pass focused on what the
    acceptance criteria actually asks for."""
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    nearby_facility_names = serializers.SerializerMethodField()

    def get_nearby_facility_names(self, property_asset) -> list[str]:
        return [f"{poi.name} ({poi.get_poi_type_display()})" for poi in property_asset.nearby_facilities.all()]

    class Meta:
        model = PropertyAsset
        fields = [
            "id", "type", "size_sqm", "finish_level", "quarter", "quarter_name", "latitude", "longitude", "description",
            "amenities", "house_rules", "nearby_facilities", "nearby_facility_names",
        ]
        # WHY these three are read-only here: writes go through
        # dedicated actions (set-amenities/set-house-rules/set-nearby-
        # facilities) that call the real validated service functions
        # instead — a raw M2M/JSONField write through this serializer
        # would bypass set_property_amenities()'s real validation
        # against the fixed PropertyAmenity list entirely.
        read_only_fields = ["amenities", "house_rules", "nearby_facilities"]


class ListingSerializer(serializers.ModelSerializer):
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

    def get_photos(self, listing) -> list[dict]:
        return [{"id": p.id, "url": p.url, "media_type": p.media_type, "is_primary": p.is_primary} for p in listing.photos.all()]

    class Meta:
        model = Listing
        fields = [
            "id", "property_asset", "property_asset_id", "listing_type", "status", "price_xaf",
            "published_at", "expires_at", "created_at",
            "lister_role", "lister_display_name", "lister_agency_name", "lister_id", "photos",
        ]
        read_only_fields = ["status", "published_at", "expires_at"]
