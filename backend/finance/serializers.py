from rest_framework import serializers
from .models import ValuationEstimate


class ValuationEstimateSerializer(serializers.ModelSerializer):
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)

    class Meta:
        model = ValuationEstimate
        fields = ["id", "quarter", "quarter_name", "property_type", "estimated_low_xaf", "estimated_high_xaf", "comparable_count", "created_at"]
        read_only_fields = fields


class ValuationRequestSerializer(serializers.Serializer):
    """Write-only input shape for POST /api/valuations/ — deliberately
    separate from ValuationEstimateSerializer, which is the real,
    stored, read-only result."""
    quarter = serializers.UUIDField()
    property_type = serializers.ChoiceField(choices=["HOUSE", "LAND", "SHOP"])


class AffordabilityRequestSerializer(serializers.Serializer):
    monthly_income_xaf = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)
