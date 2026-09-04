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
        fields = ["id", "type", "size_sqm", "finish_level", "quarter", "quarter_name", "latitude", "longitude"]


class ListingSerializer(serializers.ModelSerializer):
    property_asset = PropertyAssetSummarySerializer(read_only=True)

    class Meta:
        model = Listing
        fields = ["id", "property_asset", "listing_type", "status", "price_xaf", "published_at", "expires_at", "created_at"]
        read_only_fields = ["status", "published_at", "expires_at"]
