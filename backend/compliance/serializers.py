from rest_framework import serializers
from .models import ConsentRecord, DataExportRequest, PolicyDocument


class ConsentRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsentRecord
        fields = ["id", "consent_type", "version", "granted_at", "revoked_at"]
        read_only_fields = ["granted_at", "revoked_at"]


class DataExportRequestSerializer(serializers.ModelSerializer):
    """The file itself is never exposed by URL: it is fetched from the owner-only download action."""
    downloadable = serializers.SerializerMethodField()

    class Meta:
        model = DataExportRequest
        fields = ["id", "status", "requested_at", "completed_at", "expires_at", "downloaded_at", "downloadable"]
        read_only_fields = fields

    def get_downloadable(self, obj) -> bool:
        return obj.status == "READY" and bool(obj.export_file)


class PolicyDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PolicyDocument
        fields = ["id", "document_type", "version", "body_text", "published_at"]
