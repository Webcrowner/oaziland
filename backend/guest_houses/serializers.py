from rest_framework import serializers
from property.models import GuestHouseLodge


class GuestHouseLodgeSerializer(serializers.ModelSerializer):
    """WHY amenities is added here even though nothing else on this
    serializer changed: GuestHouseLodge already inherits a real
    amenities field from PropertyAsset (the same one property
    listings show) — it was simply never included in this serializer's
    field list, so a guest house's real amenities existed in the
    database but could never reach a client."""
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)

    class Meta:
        model = GuestHouseLodge
        fields = ["id", "is_coastal_leisure", "quarter", "quarter_name", "finish_level", "amenities"]
