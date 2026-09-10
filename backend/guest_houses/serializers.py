from rest_framework import serializers
from property.models import GuestHouseLodge, PropertyAssetPhoto, FinishLevel


class PropertyAssetPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyAssetPhoto
        fields = ["id", "url", "media_type", "is_primary", "uploaded_at"]


class GuestHouseLodgeSerializer(serializers.ModelSerializer):
    """WHY amenities is added here even though nothing else on this
    serializer changed: GuestHouseLodge already inherits a real
    amenities field from PropertyAsset (the same one property
    listings show) — it was simply never included in this serializer's
    field list, so a guest house's real amenities existed in the
    database but could never reach a client."""
    quarter_name = serializers.CharField(source="quarter.name", read_only=True)
    photos = serializers.SerializerMethodField()

    def get_photos(self, guest_house) -> list[dict]:
        return PropertyAssetPhotoSerializer(guest_house.asset_photos.all(), many=True).data

    class Meta:
        model = GuestHouseLodge
        fields = ["id", "is_coastal_leisure", "quarter", "quarter_name", "finish_level", "amenities", "photos"]


class GuestHouseLodgeCreateSerializer(serializers.Serializer):
    """Write-only input for real guest house creation — the actual
    gap this closes: GuestHouseLodgeViewSet was ReadOnlyModelViewSet,
    meaning no real owner could ever list their own property. No
    verification gate here (unlike Hotel/Venue) — matches the model's
    own real fields, which never had a verified flag at all."""
    quarter = serializers.UUIDField()
    is_coastal_leisure = serializers.BooleanField(required=False, default=False)
    finish_level = serializers.ChoiceField(choices=FinishLevel.choices, required=False, default=FinishLevel.STANDARD)
