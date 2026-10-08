from rest_framework import serializers
from .models import PartnerServiceCategory, PartnerServiceOffering, PartnerServiceRequest


class PartnerServiceOfferingSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = PartnerServiceOffering
        fields = ["id", "name", "category", "category_name", "description", "sourced_via", "price_hint_xaf"]


class PartnerServiceCategorySerializer(serializers.ModelSerializer):
    offerings = PartnerServiceOfferingSerializer(many=True, read_only=True)

    class Meta:
        model = PartnerServiceCategory
        fields = ["id", "name", "offerings"]


class RequestPartnerServiceSerializer(serializers.Serializer):
    offering = serializers.IntegerField()
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class PartnerServiceRequestSerializer(serializers.ModelSerializer):
    offering_name = serializers.CharField(source="offering.name", read_only=True)

    class Meta:
        model = PartnerServiceRequest
        fields = ["id", "offering", "offering_name", "notes", "status", "requested_at", "completed_at"]
        read_only_fields = ["status", "requested_at", "completed_at"]
