from rest_framework import serializers
from property.models import PropertyAssetPhoto
from property.serializers import OwnerRoleSerializerMixin
from .models import Venue, VenueSpace, EventBooking


class VenueSpaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = VenueSpace
        fields = ["id", "space_name", "capacity_theatre", "capacity_banquet", "capacity_cocktail", "capacity_classroom", "base_price_per_hour_xaf", "catering_policy"]


class PropertyAssetPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssetPhoto
        fields = ["id", "url", "media_type", "is_primary", "uploaded_at"]


class VenueSerializer(OwnerRoleSerializerMixin, serializers.ModelSerializer):
    spaces = VenueSpaceSerializer(many=True, read_only=True)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    photos = serializers.SerializerMethodField()
    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)

    def get_photos(self, venue) -> list[dict]:
        return PropertyAssetPhotoSerializer(venue.asset_photos.all(), many=True).data

    class Meta:
        model = Venue
        fields = ["id", "owner", "owner_name", "lister_role", "lister_average_rating", "lister_rating_count", "verified", "quarter", "quarter_name", "latitude", "longitude", "description", "amenities", "spaces", "photos"]
        read_only_fields = ["verified", "description", "amenities"]


class VenueCreateSerializer(serializers.Serializer):
    """Write-only input for real venue creation — the actual gap this
    closes: VenueViewSet was ReadOnlyModelViewSet, meaning no real
    venue owner could ever list their own property. Requires at least
    one real bookable space."""
    quarter = serializers.UUIDField()
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-180, max_value=180)
    spaces = serializers.ListField(child=serializers.DictField(), min_length=1)


class EventBookingSerializer(serializers.ModelSerializer):
    package_tier = serializers.CharField(read_only=True)
    deposit_amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    balance_amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    venue_id = serializers.UUIDField(source="venue_space.venue_id", read_only=True)
    space_name = serializers.CharField(source="venue_space.space_name", read_only=True)
    deposit_paid = serializers.SerializerMethodField()
    balance_paid = serializers.SerializerMethodField()
    is_organiser = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    organiser_name = serializers.SerializerMethodField()
    owner_payout_xaf = serializers.SerializerMethodField()

    def get_is_owner(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and request.user.is_authenticated and obj.venue_space.venue.owner_id == request.user.id)

    def get_organiser_name(self, obj) -> str:
        # Only the venue's owner sees who booked; the organiser already knows.
        return (obj.organiser.full_name or obj.organiser.username) if self.get_is_owner(obj) else ""

    def get_owner_payout_xaf(self, obj):
        """What the venue receives for a held booking after the platform fee, shown to the venue's owner."""
        from .lifecycle import held_escrows
        if not self.get_is_owner(obj):
            return None
        escrows = held_escrows(obj)
        return str(sum((e.gross_amount_xaf - e.platform_fee_xaf for e in escrows), 0)) if escrows else None
    payment_held = serializers.SerializerMethodField()
    payout_due_at = serializers.SerializerMethodField()
    balance_due_at = serializers.SerializerMethodField()
    cancellation = serializers.SerializerMethodField()

    def get_payment_held(self, obj) -> bool:
        from .lifecycle import held_escrows
        return bool(held_escrows(obj))

    def get_payout_due_at(self, obj):
        from .lifecycle import payout_due_at
        return payout_due_at(obj) if obj.status == "CONFIRMED" else None

    def get_balance_due_at(self, obj):
        from .lifecycle import balance_due_at
        if obj.status != "CONFIRMED" or self.get_balance_paid(obj):
            return None
        return balance_due_at(obj)

    def get_cancellation(self, obj):
        """What cancelling now would cost and refund while a cancellation is still possible: the organiser's own
        terms, or for the venue's owner a full refund to the organiser."""
        from decimal import Decimal
        from django.utils import timezone
        from .lifecycle import cancellation_quote, held_escrows, starts_at
        request = self.context.get("request")
        escrows = held_escrows(obj)
        if obj.status != "CONFIRMED" or not escrows or timezone.now() >= starts_at(obj):
            return None
        if self.get_is_owner(obj) and not self.get_is_organiser(obj):
            refund = sum((e.gross_amount_xaf for e in escrows), Decimal("0"))
            return {"free": True, "free_until": None, "fee_xaf": "0", "refund_xaf": str(refund)}
        if not (request and request.user.is_authenticated and obj.organiser_id == request.user.id):
            return None
        quote = cancellation_quote(obj)
        return {key: (str(value) if key.endswith("_xaf") else value) for key, value in quote.items()}

    def get_deposit_paid(self, obj) -> bool:
        return obj.booking is not None and hasattr(obj.booking, "escrow")

    def get_balance_paid(self, obj) -> bool:
        return obj.balance_booking is not None and hasattr(obj.balance_booking, "escrow")

    def get_is_organiser(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and request.user.is_authenticated and obj.organiser_id == request.user.id)

    class Meta:
        model = EventBooking
        fields = [
            "id", "venue_space", "venue_id", "space_name", "event_type", "event_date", "start_time", "end_time", "guest_count",
            "layout_preference", "catering_required", "av_needs", "special_requests", "status",
            "total_cost_xaf", "package_tier", "deposit_amount_xaf", "balance_amount_xaf", "created_at",
            "deposit_paid", "balance_paid", "is_organiser", "is_owner", "organiser_name", "owner_payout_xaf",
            "payment_held", "payout_due_at", "balance_due_at", "cancellation",
        ]
        read_only_fields = ["status", "total_cost_xaf", "created_at"]
