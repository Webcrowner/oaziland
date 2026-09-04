from rest_framework import serializers
from .models import Venue, VenueSpace, EventBooking


class VenueSpaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = VenueSpace
        fields = ["id", "space_name", "capacity_theatre", "capacity_banquet", "capacity_cocktail", "capacity_classroom", "base_price_per_hour_xaf", "catering_policy"]


class VenueSerializer(serializers.ModelSerializer):
    spaces = VenueSpaceSerializer(many=True, read_only=True)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)

    class Meta:
        model = Venue
        fields = ["id", "verified", "quarter", "quarter_name", "spaces"]


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
