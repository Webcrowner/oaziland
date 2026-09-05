"""property.serializers — read-heavy serializers for search/browse,
matching the acceptance criteria's explicit 'test the property search
endpoint and confirm real results' requirement."""
from rest_framework import serializers
from .models import PropertyAsset, Listing


class PropertyAssetSummarySerializer(serializers.ModelSerializer):
    """A lean summary for search RESULTS — full detail serializers per
    subtype (House, Land, Shop...) are a natural next extension of this
    same pattern, not built here to keep this pass focused on what the
    acceptance criteria actually asks for."""
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)

    class Meta:
        model = PropertyAsset
        fields = ["id", "type", "size_sqm", "finish_level", "quarter", "quarter_name", "latitude", "longitude", "description"]


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

    class Meta:
        model = Listing
        fields = [
            "id", "property_asset", "property_asset_id", "listing_type", "status", "price_xaf",
            "published_at", "expires_at", "created_at",
            "lister_role", "lister_display_name", "lister_agency_name", "lister_id",
        ]
        read_only_fields = ["status", "published_at", "expires_at"]
