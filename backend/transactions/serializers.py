from rest_framework import serializers
from .models import Booking


class BookingSerializer(serializers.ModelSerializer):
    """WHY has_escrow is added: OpenDisputeView already correctly
    rejects a dispute on a booking with no payment escrow yet — this
    lets a real client know NOT to show the option at all rather than
    offering a button that would just 400."""
    has_escrow = serializers.SerializerMethodField()

    def get_has_escrow(self, booking) -> bool:
        return hasattr(booking, "escrow")

    class Meta:
        model = Booking
        fields = ["id", "booking_type", "target_content_type", "target_id", "requester", "status", "amount_xaf", "has_escrow", "hold_expires_at", "created_at"]
        read_only_fields = ["status", "hold_expires_at", "created_at", "requester"]
