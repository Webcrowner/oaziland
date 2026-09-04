from rest_framework import serializers
from .models import Hotel, RoomType, Reservation


class RoomTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomType
        fields = ["id", "category", "capacity", "base_rate_xaf", "amenities"]


class HotelSerializer(serializers.ModelSerializer):
    room_types = RoomTypeSerializer(many=True, read_only=True)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    total_rooms = serializers.IntegerField(read_only=True)

    class Meta:
        model = Hotel
        fields = ["id", "star_rating", "amenities", "verified", "quarter", "quarter_name", "total_rooms", "room_types"]


class ReservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reservation
        fields = ["id", "hotel", "room_type", "check_in", "check_out", "adults", "children", "rate_xaf", "status", "special_requests", "created_at"]
        read_only_fields = ["rate_xaf", "status", "created_at"]
