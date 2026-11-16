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
    room_types = serializers.SerializerMethodField()
    from_price_xaf = serializers.SerializerMethodField()
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    total_rooms = serializers.IntegerField(read_only=True)
    photos = serializers.SerializerMethodField()
    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)

    def _for_owner(self, hotel) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if self.context.get("for_owner"):
            return True
        return bool(user and user.is_authenticated and (hotel.owner_id == user.id or hasattr(user, "admin_profile")))

    def get_room_types(self, hotel) -> list[dict]:
        """Guests see the room types on offer; the hotel's owner also sees hidden ones, to manage them."""
        from .room_types import room_types_data
        return room_types_data(hotel, for_owner=self._for_owner(hotel))

    def get_from_price_xaf(self, hotel) -> str | None:
        from .room_types import from_price
        return from_price(hotel)

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
            "latitude", "longitude", "description", "total_rooms", "room_types", "from_price_xaf", "photos",
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
    # How the payment is going while the guest approves it on their phone: PAYMENT_PROCESSING, then CONFIRMED, or
    # PAYMENT_FAILED if it was refused. Null until a payment was started.
    payment_status = serializers.CharField(source="booking.status", read_only=True, default=None)
    guest_name = serializers.SerializerMethodField()
    place_name = serializers.SerializerMethodField()
    place_kind = serializers.SerializerMethodField()
    place_id = serializers.SerializerMethodField()
    room_type_name = serializers.CharField(source="room_type.display_name", read_only=True)
    payment_held = serializers.SerializerMethodField()
    payout_due_at = serializers.SerializerMethodField()
    cancellation = serializers.SerializerMethodField()

    def get_guest_name(self, reservation) -> str:
        return reservation.guest.full_name or reservation.guest.username

    def get_place_name(self, reservation) -> str:
        return reservation.place.name or ""

    def get_place_kind(self, reservation) -> str:
        return "hotel" if reservation.hotel_id else "guest_house"

    def get_place_id(self, reservation) -> str:
        return str(reservation.hotel_id or reservation.guest_house_id)

    def get_payment_held(self, reservation) -> bool:
        from .stays import held_escrow
        return held_escrow(reservation) is not None

    def get_payout_due_at(self, reservation):
        from .stays import payout_due_at
        return payout_due_at(reservation)

    def get_cancellation(self, reservation):
        """What cancelling would cost the guest right now (only while a confirmed stay can still be cancelled)."""
        from django.utils import timezone
        from .models import ReservationStatus
        from .stays import cancellation_quote
        if reservation.status != ReservationStatus.CONFIRMED or timezone.localdate() >= reservation.check_out:
            return None
        quote = cancellation_quote(reservation)
        return {"free": quote["free"], "free_until": quote["free_until"], "fee_xaf": str(quote["fee_xaf"]), "refund_xaf": str(quote["refund_xaf"])}

    class Meta:
        model = Reservation
        fields = [
            "id", "hotel", "guest_house", "room_type", "check_in", "check_out", "adults", "children", "rate_xaf", "status",
            "payment_status", "special_requests", "created_at", "guest_name", "place_name", "place_kind", "place_id",
            "room_type_name", "payment_held", "payout_due_at", "cancellation",
        ]
        read_only_fields = ["rate_xaf", "status", "created_at"]
