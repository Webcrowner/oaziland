from rest_framework import serializers
from .models import Flyer


class FlyerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Flyer
        fields = ["id", "category", "finish_level", "headline_details", "company_name", "qr_target_type", "qr_target_url", "generated_image", "created_at"]
        read_only_fields = fields


class FlyerCreateSerializer(serializers.Serializer):
    category = serializers.CharField()
    finish_level = serializers.CharField(required=False, allow_blank=True, default="")
    headline_details = serializers.CharField(required=False, allow_blank=True, default="")
    company_name = serializers.CharField(required=False, default="Oaziland")
    logo_url = serializers.URLField(required=False, allow_blank=True, default="")
    qr_target_type = serializers.CharField()
    qr_target_id = serializers.UUIDField(required=False, allow_null=True)
    quarter_id = serializers.UUIDField(required=False, allow_null=True)
