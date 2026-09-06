from rest_framework import serializers
from .models import Quarter, PointOfInterest


class QuarterSerializer(serializers.ModelSerializer):
    village_name = serializers.CharField(source="village_or_district.name", read_only=True)

    class Meta:
        model = Quarter
        fields = ["id", "name", "village_name"]


class PointOfInterestSerializer(serializers.ModelSerializer):
    """A real gap this closes: real universities, hospitals, markets,
    transport hubs, and tarred-road access points already existed in
    the database (set_nearby_facilities() already attaches them to a
    property), but nothing ever let a real client browse and pick
    from them — this is that missing read-only lookup."""
    poi_type_display = serializers.CharField(source="get_poi_type_display", read_only=True)

    class Meta:
        model = PointOfInterest
        fields = ["id", "name", "poi_type", "poi_type_display", "quarter", "latitude", "longitude"]
