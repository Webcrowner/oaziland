from rest_framework import serializers
from .models import SocialAccountLink


class SocialAccountLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = SocialAccountLink
        fields = ["id", "platform", "handle_or_url", "added_at"]
        read_only_fields = ["added_at"]
