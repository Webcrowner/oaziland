from rest_framework import serializers
from property.models import PropertyAssetPhoto
from property.serializers import OwnerRoleSerializerMixin
from .models import Venue, VenueSpace, EventBooking


class VenueSpaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = VenueSpace
        fields = ["id", "space_name", "capacity_theatre", "capacity_banquet", "capacity_cocktail", "capacity_classroom", "base_price_per_hour_xaf", "catering_policy"]


class PropertyAssetPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssetPhoto
        fields = ["id", "url", "media_type", "is_primary", "uploaded_at"]


class VenueSerializer(OwnerRoleSerializerMixin, serializers.ModelSerializer):
    spaces = VenueSpaceSerializer(many=True, read_only=True)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    photos = serializers.SerializerMethodField()
    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)

    def get_photos(self, venue) -> list[dict]:
        return PropertyAssetPhotoSerializer(venue.asset_photos.all(), many=True).data

    class Meta:
        model = Venue
        fields = ["id", "owner", "owner_name", "lister_role", "lister_average_rating", "lister_rating_count", "verified", "quarter", "quarter_name", "latitude", "longitude", "description", "amenities", "spaces", "photos"]
        read_only_fields = ["verified", "description", "amenities"]


class VenueCreateSerializer(serializers.Serializer):
    """Write-only input for real venue creation — the actual gap this
    closes: VenueViewSet was ReadOnlyModelViewSet, meaning no real
    venue owner could ever list their own property. Requires at least
    one real bookable space."""
    quarter = serializers.UUIDField()
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-180, max_value=180)
    spaces = serializers.ListField(child=serializers.DictField(), min_length=1)


class EventBookingSerializer(serializers.ModelSerializer):
    package_tier = serializers.CharField(read_only=True)
    deposit_amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    balance_amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = EventBooking
        fields = [
            "id", "venue_space", "event_type", "event_date", "start_time", "end_time", "guest_count",
            "layout_preference", "catering_required", "av_needs", "special_requests", "status",
            "total_cost_xaf", "package_tier", "deposit_amount_xaf", "balance_amount_xaf", "created_at",
        ]
        read_only_fields = ["status", "total_cost_xaf", "created_at"]
