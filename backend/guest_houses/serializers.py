from rest_framework import serializers
from property.models import GuestHouseLodge, PropertyAssetPhoto, FinishLevel
from property.serializers import OwnerRoleSerializerMixin


class PropertyAssetPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssetPhoto
        fields = ["id", "url", "media_type", "is_primary", "uploaded_at"]


class GuestHouseLodgeSerializer(OwnerRoleSerializerMixin, serializers.ModelSerializer):
    """WHY amenities is added here even though nothing else on this
    serializer changed: GuestHouseLodge already inherits a real
    amenities field from PropertyAsset (the same one property
    listings show) — it was simply never included in this serializer's
    field list, so a guest house's real amenities existed in the
    database but could never reach a client."""
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)
    photos = serializers.SerializerMethodField()
    room_types = serializers.SerializerMethodField()
    from_price_xaf = serializers.SerializerMethodField()
    total_rooms = serializers.SerializerMethodField()

    def get_photos(self, guest_house) -> list[dict]:
        return PropertyAssetPhotoSerializer(guest_house.asset_photos.all(), many=True).data

    def get_room_types(self, guest_house) -> list[dict]:
        """Guests see the room types on offer; the owner (or an admin) also sees hidden ones, to manage them."""
        from hotels.room_types import room_types_data
        user = getattr(self.context.get("request"), "user", None)
        for_owner = self.context.get("for_owner") or bool(
            user and user.is_authenticated and (guest_house.owner_id == user.id or hasattr(user, "admin_profile"))
        )
        return room_types_data(guest_house, for_owner=for_owner)

    def get_from_price_xaf(self, guest_house) -> str | None:
        from hotels.room_types import from_price
        return from_price(guest_house)

    def get_total_rooms(self, guest_house) -> int:
        return guest_house.rooms.count()

    class Meta:
        model = GuestHouseLodge
        fields = [
            "id", "owner", "owner_name", "lister_role", "lister_average_rating", "lister_rating_count", "name", "is_coastal_leisure",
            "quarter", "quarter_name", "finish_level", "latitude", "longitude", "description", "amenities", "photos",
            "total_rooms", "room_types", "from_price_xaf",
        ]
        read_only_fields = ["description"]


class GuestHouseLodgeCreateSerializer(serializers.Serializer):
    """Write-only input for real guest house creation — the actual
    gap this closes: GuestHouseLodgeViewSet was ReadOnlyModelViewSet,
    meaning no real owner could ever list their own property. No
    verification gate here (unlike Hotel/Venue) — matches the model's
    own real fields, which never had a verified flag at all."""
    quarter = serializers.UUIDField()
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    # Optional first room types, same shape as POST /api/guest-houses/<id>/room-types/.
    room_types = serializers.ListField(child=serializers.DictField(), required=False, default=list, max_length=20)
    is_coastal_leisure = serializers.BooleanField(required=False, default=False)
    finish_level = serializers.ChoiceField(choices=FinishLevel.choices, required=False, default=FinishLevel.STANDARD)
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-180, max_value=180)
