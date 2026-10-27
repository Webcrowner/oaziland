from rest_framework import serializers
from django.db.models import Count
from .models import TrainingProgram, TrainingEnrollment, JobPosting, JobApplication


class TrainingProgramSerializer(serializers.ModelSerializer):
    provider_name = serializers.CharField(source="provider.full_name", read_only=True)
    lesson_count = serializers.SerializerMethodField()
    starts_at = serializers.DateTimeField(source="event.starts_at", read_only=True, default=None)
    ends_at = serializers.DateTimeField(source="event.ends_at", read_only=True, default=None)
    location = serializers.CharField(source="event.location_description", read_only=True, default="")

    class Meta:
        model = TrainingProgram
        fields = [
            "id", "title", "description", "category", "provider_name", "price_xaf", "issues_certification",
            "starts_at", "ends_at", "location", "lesson_count",
        ]

    def get_lesson_count(self, program) -> int:
        count = getattr(program, "lesson_total", None)
        return count if count is not None else program.modules.aggregate(n=Count("lessons"))["n"]


class TrainingEnrollmentSerializer(serializers.ModelSerializer):
    program_detail = TrainingProgramSerializer(source="program", read_only=True)
    progress = serializers.SerializerMethodField()

    class Meta:
        model = TrainingEnrollment
        fields = ["id", "program", "program_detail", "status", "progress", "enrolled_at", "completed_at", "certificate_issued_at"]
        read_only_fields = ["status", "enrolled_at", "completed_at", "certificate_issued_at"]

    def get_progress(self, enrollment) -> dict:
        from .course_services import course_progress

        return course_progress(enrollment)


class JobApplicationSerializer(serializers.ModelSerializer):
    applicant_name = serializers.CharField(source="applicant.full_name", read_only=True)

    class Meta:
        model = JobApplication
        fields = ["id", "job_posting", "applicant", "applicant_name", "cover_message", "status", "applied_at"]
        read_only_fields = ["applicant", "status", "applied_at"]


class UpdateApplicationStatusSerializer(serializers.Serializer):
    application_id = serializers.UUIDField()
    new_status = serializers.ChoiceField(choices=["REVIEWED", "SHORTLISTED", "REJECTED", "HIRED"])


class ShareJobPostingSerializer(serializers.Serializer):
    recipient_phone = serializers.CharField(max_length=50)


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
