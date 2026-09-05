from rest_framework import serializers
from .models import Land


class LandCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Land
        fields = [
            "id", "quarter", "size_sqm", "description", "latitude", "longitude", "distance_to_tarmac_km",
            "land_use_type", "title_deed_number", "title_type", "bornes_visibles",
        ]
        read_only_fields = ["id"]
