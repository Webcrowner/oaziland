from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from property.models import PropertyAssetPhoto
from .models import StudentHostel, HostelUnit, RoomAllocation


class HostelUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = HostelUnit
        fields = ["id", "room_code", "unit_type", "occupancy_model", "amenity_tier", "bed_capacity"]


class PropertyAssetPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssetPhoto
        fields = ["id", "url", "media_type", "is_primary", "uploaded_at"]


class StudentHostelSerializer(serializers.ModelSerializer):
    """WHY units uses a SerializerMethodField instead of a plain nested
    serializer on a related_name: HostelUnit uses multi-table
    inheritance from the base Unit model — the inherited reverse
    relation (hostel.units.all(), from Building's own FK) returns base
    Unit rows, which don't have unit_type/occupancy_model/etc. at all.
    Querying HostelUnit directly, filtered by building, is what
    actually gets the right subclass instances — the exact same
    'query the subclass explicitly' pattern already used throughout
    student_hostels/services.py. photos doesn't have this problem —
    PropertyAssetPhoto FKs directly to the top-level PropertyAsset,
    so the inherited reverse relation (hostel.asset_photos) already
    resolves correctly through the full inheritance chain."""
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    units = serializers.SerializerMethodField()
    photos = serializers.SerializerMethodField()

    class Meta:
        model = StudentHostel
        fields = ["id", "property_type", "quarter", "quarter_name", "units", "photos"]

    @extend_schema_field(HostelUnitSerializer(many=True))
    def get_units(self, hostel):
        from .models import HostelUnit
        units = HostelUnit.objects.filter(building=hostel.building_ptr)
        return HostelUnitSerializer(units, many=True).data

    def get_photos(self, hostel) -> list[dict]:
        return PropertyAssetPhotoSerializer(hostel.asset_photos.all(), many=True).data


class StudentHostelCreateSerializer(serializers.Serializer):
    """Write-only input for real student hostel creation — the actual
    gap this closes: StudentHostelViewSet was ReadOnlyModelViewSet,
    meaning no real owner could ever list their own property. Reuses
    the existing create_student_hostel() helper, which already keeps
    PropertyAsset.owner and owner_profile.account_user in sync — not
    reimplemented here."""
    quarter = serializers.UUIDField()
    property_type = serializers.ChoiceField(choices=["BLOCK", "SELF_CONTAIN_COMPOUND", "STUDIO_COMPLEX", "APARTMENT_BUILDING", "MIXED"], required=False, default="BLOCK")


class RoomAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomAllocation
        fields = ["id", "unit", "bed_slot", "semester", "status", "allocated_at"]
        read_only_fields = ["status", "allocated_at"]
