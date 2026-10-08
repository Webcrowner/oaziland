from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from property.models import PropertyAssetPhoto
from property.serializers import OwnerRoleSerializerMixin
from .models import StudentHostel, HostelUnit, RoomAllocation, WelfareAlert, HostelUnitType, Waitlist, ParentGuardianAccess, Semester


class SemesterSerializer(serializers.ModelSerializer):
    institution_name = serializers.CharField(source="institution.name", read_only=True)

    class Meta:
        model = Semester
        fields = ["id", "institution", "institution_name", "name", "start_date", "end_date", "billing_due_date"]


class GrantParentAccessSerializer(serializers.Serializer):
    parent_user_id = serializers.UUIDField()
    also_notify_institution = serializers.BooleanField(required=False, default=False)


class ParentGuardianAccessSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    parent_name = serializers.CharField(source="parent_user.full_name", read_only=True)

    class Meta:
        model = ParentGuardianAccess
        fields = ["id", "parent_user", "parent_name", "student", "student_name", "also_notify_institution", "consented_at", "revoked_at"]


class HostelWaitlistJoinSerializer(serializers.Serializer):
    hostel = serializers.UUIDField()
    desired_unit_type = serializers.ChoiceField(choices=HostelUnitType.choices)
    semester = serializers.IntegerField()


class WaitlistSerializer(serializers.ModelSerializer):
    class Meta:
        model = Waitlist
        fields = ["id", "hostel", "desired_unit_type", "semester", "joined_at", "fulfilled_at"]


class HostelUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = HostelUnit
        fields = ["id", "room_code", "unit_type", "occupancy_model", "amenity_tier", "bed_capacity"]


class PropertyAssetPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssetPhoto
        fields = ["id", "url", "media_type", "is_primary", "uploaded_at"]


class StudentHostelSerializer(OwnerRoleSerializerMixin, serializers.ModelSerializer):
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
    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)
    units = serializers.SerializerMethodField()
    photos = serializers.SerializerMethodField()

    class Meta:
        model = StudentHostel
        fields = ["id", "owner", "owner_name", "lister_role", "lister_average_rating", "lister_rating_count", "property_type", "quarter", "quarter_name", "latitude", "longitude", "description", "amenities", "units", "photos"]
        read_only_fields = ["description", "amenities"]

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
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-180, max_value=180)


class RoomAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomAllocation
        fields = ["id", "unit", "bed_slot", "semester", "status", "allocated_at"]
        read_only_fields = ["status", "allocated_at"]


class WelfareAlertSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.get_full_name", read_only=True)
    student_username = serializers.CharField(source="student.username", read_only=True)
    student_phone = serializers.CharField(source="student.phone", read_only=True)
    raised_by_name = serializers.CharField(source="raised_by.username", read_only=True, default=None)

    class Meta:
        model = WelfareAlert
        fields = [
            "id", "student", "student_name", "student_username", "student_phone",
            "reason", "details", "raised_by", "raised_by_name", "created_at", "resolved_at",
        ]
        read_only_fields = ["created_at"]
