from rest_framework import serializers
from property.models import PropertyAssetPhoto
from .models import Hotel, RoomType, Reservation


class RoomTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomType
        fields = ["id", "category", "capacity", "base_rate_xaf", "amenities"]


class PropertyAssetPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssetPhoto
        fields = ["id", "url", "media_type", "is_primary", "uploaded_at"]


class HotelSerializer(serializers.ModelSerializer):
    room_types = RoomTypeSerializer(many=True, read_only=True)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    total_rooms = serializers.IntegerField(read_only=True)
    photos = serializers.SerializerMethodField()

    def get_photos(self, hotel) -> list[dict]:
        return PropertyAssetPhotoSerializer(hotel.asset_photos.all(), many=True).data

    class Meta:
        model = Hotel
        fields = ["id", "star_rating", "amenities", "verified", "quarter", "quarter_name", "total_rooms", "room_types", "photos"]
        read_only_fields = ["verified"]


class HotelCreateSerializer(serializers.Serializer):
    """Write-only input for real hotel creation — the actual gap
    this closes: HotelViewSet was ReadOnlyModelViewSet, meaning no
    real hotel owner could ever list their own property. Requires at
    least one real room type; a hotel with zero room types isn't
    actually bookable, so isn't a useful thing to create."""
    quarter = serializers.UUIDField()
    star_rating = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=5)
    room_types = serializers.ListField(child=serializers.DictField(), min_length=1)


class ReservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reservation
        fields = ["id", "hotel", "room_type", "check_in", "check_out", "adults", "children", "rate_xaf", "status", "special_requests", "created_at"]
        read_only_fields = ["rate_xaf", "status", "created_at"]
