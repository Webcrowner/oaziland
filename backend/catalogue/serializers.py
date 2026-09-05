from rest_framework import serializers
from .models import PartnerServiceCategory, PartnerServiceOffering


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
