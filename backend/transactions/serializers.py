from rest_framework import serializers
from .models import Booking


class BookingSerializer(serializers.ModelSerializer):
    """WHY has_escrow is added: OpenDisputeView already correctly
    rejects a dispute on a booking with no payment escrow yet — this
    lets a real client know NOT to show the option at all rather than
    offering a button that would just 400.

    WHY escrow_status/dispute_status/dispute_resolution_notes exist:
    the real gap this closes — a user who opened a dispute previously
    had no way to ever find out what happened to it. The frontend's
    own "submitted" flag was local-only React state, never reflecting
    whether an admin had responded or resolved it. These fields expose
    the actual, persisted state instead."""
    has_escrow = serializers.SerializerMethodField()
    escrow_status = serializers.SerializerMethodField()
    dispute_status = serializers.SerializerMethodField()
    dispute_resolution_notes = serializers.SerializerMethodField()
    dispute_id = serializers.SerializerMethodField()
    target_owner = serializers.SerializerMethodField()
    target_owner_name = serializers.SerializerMethodField()

    def get_has_escrow(self, booking) -> bool:
        return hasattr(booking, "escrow")

    def get_escrow_status(self, booking) -> str | None:
        return booking.escrow.status if hasattr(booking, "escrow") else None

    def get_dispute_status(self, booking) -> str | None:
        if not hasattr(booking, "escrow") or not hasattr(booking.escrow, "dispute_case"):
            return None
        return booking.escrow.dispute_case.status

    def get_dispute_resolution_notes(self, booking) -> str:
        if not hasattr(booking, "escrow") or not hasattr(booking.escrow, "dispute_case"):
            return ""
        return booking.escrow.dispute_case.resolution_notes

    def get_dispute_id(self, booking) -> str | None:
        if not hasattr(booking, "escrow") or not hasattr(booking.escrow, "dispute_case"):
            return None
        return str(booking.escrow.dispute_case.id)

    def get_target_owner(self, booking) -> str | None:
        from .services import resolve_target_owner
        owner = resolve_target_owner(booking)
        return str(owner.id) if owner else None

    def get_target_owner_name(self, booking) -> str | None:
        from .services import resolve_target_owner
        owner = resolve_target_owner(booking)
        return (owner.full_name or owner.username) if owner else None

    class Meta:
        model = Booking
        fields = [
            "id", "booking_type", "target_content_type", "target_id", "requester", "status", "amount_xaf",
            "has_escrow", "escrow_status", "dispute_status", "dispute_resolution_notes", "dispute_id", "hold_expires_at", "created_at",
            "target_owner", "target_owner_name",
        ]
        read_only_fields = ["status", "hold_expires_at", "created_at", "requester"]
