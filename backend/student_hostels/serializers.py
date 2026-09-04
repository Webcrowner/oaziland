from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from .models import StudentHostel, HostelUnit, RoomAllocation


class HostelUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = HostelUnit
        fields = ["id", "room_code", "unit_type", "occupancy_model", "amenity_tier", "bed_capacity"]


class StudentHostelSerializer(serializers.ModelSerializer):
    """WHY units uses a SerializerMethodField instead of a plain nested
    serializer on a related_name: HostelUnit uses multi-table
    inheritance from the base Unit model — the inherited reverse
    relation (hostel.units.all(), from Building's own FK) returns base
    Unit rows, which don't have unit_type/occupancy_model/etc. at all.
    Querying HostelUnit directly, filtered by building, is what
    actually gets the right subclass instances — the exact same
    'query the subclass explicitly' pattern already used throughout
    student_hostels/services.py."""
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    units = serializers.SerializerMethodField()

    class Meta:
        model = StudentHostel
        fields = ["id", "property_type", "quarter", "quarter_name", "units"]

    @extend_schema_field(HostelUnitSerializer(many=True))
    def get_units(self, hostel):
        from .models import HostelUnit
        units = HostelUnit.objects.filter(building=hostel.building_ptr)
        return HostelUnitSerializer(units, many=True).data


class RoomAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomAllocation
        fields = ["id", "unit", "bed_slot", "semester", "status", "allocated_at"]
        read_only_fields = ["status", "allocated_at"]
