from rest_framework import serializers
from .models import ContentReport
from engagement.models import VerificationRequest
from property_management.models import DisputeCase


class VerificationRequestSerializer(serializers.ModelSerializer):
    requester_name = serializers.CharField(source="requester.full_name", read_only=True)

    class Meta:
        model = VerificationRequest
        fields = ["id", "requester", "requester_name", "request_type", "subject_content_type", "subject_id", "status", "supporting_document_url", "submitted_at"]
        read_only_fields = ["status", "submitted_at"]


class ContentReportSerializer(serializers.ModelSerializer):
    reported_by_name = serializers.CharField(source="reported_by.full_name", read_only=True)

    class Meta:
        model = ContentReport
        fields = ["id", "reported_by", "reported_by_name", "reason", "status", "target_post", "target_listing_id", "target_comment", "notes", "created_at"]
        read_only_fields = ["status", "created_at"]


class DisputeCaseSerializer(serializers.ModelSerializer):
    raised_by_name = serializers.CharField(source="raised_by.full_name", read_only=True)

    class Meta:
        model = DisputeCase
        fields = ["id", "escrow", "raised_by", "raised_by_name", "status", "reason", "created_at", "response_due_at", "resolution_due_at"]
        read_only_fields = ["status", "created_at", "response_due_at", "resolution_due_at"]
