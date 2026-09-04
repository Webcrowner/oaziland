from rest_framework import serializers
from property.models import GuestHouseLodge


class GuestHouseLodgeSerializer(serializers.ModelSerializer):
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)

    class Meta:
        model = GuestHouseLodge
        fields = ["id", "is_coastal_leisure", "quarter", "quarter_name", "finish_level"]
