from rest_framework import serializers
from .models import ConsentRecord, DataExportRequest, PolicyDocument


class ConsentRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsentRecord
        fields = ["id", "consent_type", "version", "granted_at", "revoked_at"]
        read_only_fields = ["granted_at", "revoked_at"]


class DataExportRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = DataExportRequest
        fields = ["id", "status", "export_file", "requested_at", "completed_at"]
        read_only_fields = ["status", "export_file", "requested_at", "completed_at"]


class PolicyDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PolicyDocument
        fields = ["id", "document_type", "version", "body_text", "published_at"]
