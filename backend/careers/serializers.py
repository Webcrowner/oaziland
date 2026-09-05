from rest_framework import serializers
from .models import TrainingProgram, TrainingEnrollment


class TrainingProgramSerializer(serializers.ModelSerializer):
    provider_name = serializers.CharField(source="provider.full_name", read_only=True)

    class Meta:
        model = TrainingProgram
        fields = ["id", "title", "description", "category", "provider_name", "price_xaf", "issues_certification"]


class TrainingEnrollmentSerializer(serializers.ModelSerializer):
    program_detail = TrainingProgramSerializer(source="program", read_only=True)

    class Meta:
        model = TrainingEnrollment
        fields = ["id", "program", "program_detail", "status", "enrolled_at", "completed_at", "certificate_issued_at"]
        read_only_fields = ["status", "enrolled_at", "completed_at", "certificate_issued_at"]
