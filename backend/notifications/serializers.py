from rest_framework import serializers
from .models import Notification, GreetingSettings


class NotificationSerializer(serializers.ModelSerializer):
    target = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ["id", "notification_type", "title", "message", "channel", "delivered", "read_at", "created_at", "target"]
        read_only_fields = fields

    def get_target(self, obj):
        # The inbox view resolves a whole page at once; a single notification (mark_read) resolves itself.
        targets = self.context.get("targets")
        if targets is None:
            from .links import resolve_targets
            request = self.context.get("request")
            targets = resolve_targets([obj], request.user) if request is not None else {}
        return targets.get(obj.pk)


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


class PushDeviceSerializer(serializers.Serializer):
    platform = serializers.ChoiceField(choices=["WEB", "EXPO"])
    token = serializers.CharField(max_length=1000)
    web_p256dh = serializers.CharField(max_length=200, required=False, allow_blank=True)
    web_auth = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate(self, data):
        if data["platform"] == "WEB":
            if not data["token"].startswith("https://"):
                raise serializers.ValidationError({"token": "A Web Push subscription endpoint must be an https:// URL."})
            if not data.get("web_p256dh") or not data.get("web_auth"):
                raise serializers.ValidationError("A Web Push subscription needs its p256dh and auth keys.")
        elif not data["token"].startswith(("ExponentPushToken[", "ExpoPushToken[")):
            raise serializers.ValidationError({"token": "That isn't an Expo push token."})
        return data
