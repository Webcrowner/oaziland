from rest_framework import serializers
from .models import WantedListing, WantedListingResponse, SavedSearch, PropertyComparison


class WantedListingResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = WantedListingResponse
        fields = ["id", "responder", "message", "created_at"]
        read_only_fields = ["responder", "created_at"]


class WantedListingSerializer(serializers.ModelSerializer):
    quarter_name = serializers.CharField(source="quarter.name", read_only=True, default=None)
    responses = WantedListingResponseSerializer(many=True, read_only=True)

    class Meta:
        model = WantedListing
        fields = ["id", "category", "quarter", "quarter_name", "min_size_sqm", "max_budget_xaf", "notes", "status", "created_at", "responses"]
        read_only_fields = ["status", "created_at"]


class SavedSearchSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedSearch
        fields = ["id", "name", "filters", "last_notified_at"]
        read_only_fields = ["last_notified_at"]


class PropertyComparisonSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyComparison
        fields = ["id", "listing_ids", "created_at"]
        read_only_fields = ["created_at"]
