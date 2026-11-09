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


MARKETPLACE_SEARCH_CATEGORIES = ("warehouses", "stores", "businesses", "cars", "goods")


class SavedSearchSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedSearch
        fields = ["id", "name", "filters", "scope", "last_notified_at"]
        read_only_fields = ["last_notified_at"]

    def validate(self, attrs):
        scope = attrs.get("scope", getattr(self.instance, "scope", "PROPERTY"))
        filters = attrs.get("filters", getattr(self.instance, "filters", {}))
        if scope != "MARKETPLACE":
            return attrs
        # A marketplace search is the browse page's own query string, checked the same way the browse page checks it.
        if not isinstance(filters, dict) or any(not isinstance(v, str) for v in filters.values()):
            raise serializers.ValidationError({"filters": "Filters must be a flat object of text values."})
        category = filters.get("category")
        if category and category not in MARKETPLACE_SEARCH_CATEGORIES:
            raise serializers.ValidationError({"filters": "Choose a valid marketplace category."})
        from marketplace.views import parse_listing_filters
        from rest_framework.exceptions import ValidationError as DRFValidationError
        try:
            parse_listing_filters({k: v for k, v in filters.items() if k != "category"})
        except DRFValidationError as e:
            raise serializers.ValidationError({"filters": e.detail})
        attrs["filters"] = {k: v for k, v in filters.items() if v != "" and k not in ("ordering", "page")}
        return attrs


class PropertyComparisonSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyComparison
        fields = ["id", "listing_ids", "created_at"]
        read_only_fields = ["created_at"]
