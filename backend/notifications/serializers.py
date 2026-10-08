from rest_framework import serializers
from .models import Notification, GreetingSettings


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "notification_type", "title", "message", "channel", "delivered", "read_at", "created_at"]
        read_only_fields = fields


class ListingShareMessageSerializer(serializers.Serializer):
    listing_share_message = serializers.CharField()


class GreetingSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = GreetingSettings
        fields = [
            "birthday_enabled",
            "birthday_title",
            "birthday_message",
            "new_month_enabled",
            "new_month_title",
            "new_month_message",
            "listing_share_message",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]
