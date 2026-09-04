from rest_framework import serializers
from .models import Quarter


class QuarterSerializer(serializers.ModelSerializer):
    village_name = serializers.CharField(source="village_or_district.name", read_only=True)

    class Meta:
        model = Quarter
        fields = ["id", "name", "village_name"]
