from rest_framework import serializers
from .models import Quarter, PointOfInterest, AreaSuggestion, Region


class AreaSuggestionSerializer(serializers.ModelSerializer):
    region_name = serializers.SlugRelatedField(
        source="region", slug_field="name", queryset=Region.objects.all(),
        error_messages={"does_not_exist": "Choose a region from the list."},
    )
    city_name = serializers.CharField(max_length=100, trim_whitespace=True)
    area_name = serializers.CharField(max_length=100, trim_whitespace=True)

    class Meta:
        model = AreaSuggestion
        fields = ["id", "region_name", "city_name", "area_name", "status", "created_at"]
        read_only_fields = ["id", "status", "created_at"]

    def validate(self, attrs):
        region, city, area = attrs["region"], attrs["city_name"], attrs["area_name"]
        if Quarter.objects.filter(
            name__iexact=area,
            village_or_district__name__iexact=city,
            village_or_district__subdivision__division__region=region,
        ).exists():
            raise serializers.ValidationError("This area already exists — pick it from the dropdown.")
        if AreaSuggestion.objects.filter(
            region=region, city_name__iexact=city, area_name__iexact=area, status="PENDING",
        ).exists():
            raise serializers.ValidationError("This area has already been requested and is awaiting review.")
        return attrs


class QuarterSerializer(serializers.ModelSerializer):
    village_name = serializers.CharField(source="village_or_district.name", read_only=True)
    region_name = serializers.CharField(source="village_or_district.subdivision.division.region.name", read_only=True)

    class Meta:
        model = Quarter
        fields = ["id", "name", "village_name", "region_name"]


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
