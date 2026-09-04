from rest_framework import serializers
from .models import Booking


class BookingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = ["id", "booking_type", "target_content_type", "target_id", "requester", "status", "amount_xaf", "hold_expires_at", "created_at"]
        read_only_fields = ["status", "hold_expires_at", "created_at", "requester"]
