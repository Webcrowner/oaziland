from rest_framework import serializers
from .models import TrainingProgram, TrainingEnrollment, JobPosting, JobApplication


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


class JobApplicationSerializer(serializers.ModelSerializer):
    applicant_name = serializers.CharField(source="applicant.full_name", read_only=True)

    class Meta:
        model = JobApplication
        fields = ["id", "job_posting", "applicant", "applicant_name", "cover_message", "status", "applied_at"]
        read_only_fields = ["applicant", "status", "applied_at"]


class JobPostingSerializer(serializers.ModelSerializer):
    quarter_name = serializers.CharField(source="quarter.name", read_only=True, default=None)
    posted_by_name = serializers.CharField(source="posted_by.full_name", read_only=True)
    application_count = serializers.SerializerMethodField()

    def get_application_count(self, posting) -> int:
        return posting.applications.count()

    class Meta:
        model = JobPosting
        fields = [
            "id", "posted_by", "posted_by_name", "title", "role_category", "description",
            "quarter", "quarter_name", "salary_min_xaf", "salary_max_xaf", "status",
            "posted_at", "closes_at", "application_count",
        ]
        read_only_fields = ["posted_by", "status", "posted_at"]
