from rest_framework import serializers
from property.models import PropertyAssetPhoto
from property.serializers import OwnerRoleSerializerMixin
from .models import Hotel, RoomType, Reservation


class RoomTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomType
        fields = ["id", "category", "capacity", "base_rate_xaf", "amenities"]


class PropertyAssetPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssetPhoto
        fields = ["id", "url", "media_type", "is_primary", "uploaded_at"]


class HotelSerializer(OwnerRoleSerializerMixin, serializers.ModelSerializer):
    room_types = RoomTypeSerializer(many=True, read_only=True)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    total_rooms = serializers.IntegerField(read_only=True)
    photos = serializers.SerializerMethodField()
    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)

    def get_photos(self, hotel) -> list[dict]:
        return PropertyAssetPhotoSerializer(hotel.asset_photos.all(), many=True).data

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not data.get("name"):
            desc = (instance.description or "").strip()
            if "—" in desc:
                data["name"] = desc.split("—", 1)[0].strip()
        return data

    class Meta:
        model = Hotel
        fields = [
            "id", "owner", "owner_name", "lister_role", "lister_average_rating", "lister_rating_count", "name", "star_rating", "amenities", "verified", "quarter", "quarter_name",
            "latitude", "longitude", "description", "total_rooms", "room_types", "photos",
        ]
        read_only_fields = ["verified", "description"]


class HotelCreateSerializer(serializers.Serializer):
    """Write-only input for real hotel creation — the actual gap
    this closes: HotelViewSet was ReadOnlyModelViewSet, meaning no
    real hotel owner could ever list their own property. Requires at
    least one real room type; a hotel with zero room types isn't
    actually bookable, so isn't a useful thing to create."""
    quarter = serializers.UUIDField()
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    star_rating = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=5)
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-180, max_value=180)
    room_types = serializers.ListField(child=serializers.DictField(), min_length=1)


class ReservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reservation
        fields = ["id", "hotel", "room_type", "check_in", "check_out", "adults", "children", "rate_xaf", "status", "special_requests", "created_at"]
        read_only_fields = ["rate_xaf", "status", "created_at"]
