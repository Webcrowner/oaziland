from rest_framework import serializers
from .models import ServiceRequest, ServiceRequestPhoto


class ServiceRequestPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceRequestPhoto
        fields = ["id", "photo_type", "file_url", "uploaded_at"]


class ServiceRequestSerializer(serializers.ModelSerializer):
    requester_name = serializers.CharField(source="requester.full_name", read_only=True)
    technician_name = serializers.CharField(source="technician.full_name", read_only=True, default=None)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True, default=None)
    photos = ServiceRequestPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = ServiceRequest
        fields = [
            "id", "requester", "requester_name", "technician", "technician_name", "category", "priority",
            "status", "description", "quarter", "quarter_name", "latitude", "longitude",
            "requested_at", "accepted_at", "started_at", "completed_at", "photos",
        ]
        read_only_fields = [
            "requester", "technician", "status", "requested_at", "accepted_at", "started_at", "completed_at",
        ]


class CompleteServiceRequestSerializer(serializers.Serializer):
    amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    phone_number = serializers.CharField()


class FindTechniciansSerializer(serializers.Serializer):
    category = serializers.CharField()
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    radius_km = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=10)
