from rest_framework import serializers
from .models import TrainingProgram, TrainingEnrollment, JobPosting, JobApplication


def cover_image_url(program, request=None) -> str:
    if not program.cover_image:
        return ""
    url = program.cover_image.url
    return request.build_absolute_uri(url) if request is not None and url.startswith("/") else url


class TrainingProgramSerializer(serializers.ModelSerializer):
    provider_name = serializers.CharField(source="provider.full_name", read_only=True)
    provider_id = serializers.UUIDField(read_only=True)
    lesson_count = serializers.SerializerMethodField()
    cover_image_url = serializers.SerializerMethodField()
    rating_average = serializers.SerializerMethodField()
    rating_count = serializers.SerializerMethodField()
    learner_count = serializers.SerializerMethodField()
    starts_at = serializers.DateTimeField(source="event.starts_at", read_only=True, default=None)
    ends_at = serializers.DateTimeField(source="event.ends_at", read_only=True, default=None)
    location = serializers.CharField(source="event.location_description", read_only=True, default="")

    class Meta:
        model = TrainingProgram
        fields = [
            "id", "title", "description", "category", "provider_name", "provider_id", "price_xaf", "issues_certification",
            "duration_hours", "certificate_validity_months",
            "starts_at", "ends_at", "location", "lesson_count", "cover_image_url",
            "rating_average", "rating_count", "learner_count",
        ]

    def get_cover_image_url(self, program) -> str:
        return cover_image_url(program, self.context.get("request"))

    def get_lesson_count(self, program) -> int:
        count = getattr(program, "lesson_total", None)
        if count is not None:
            return count
        from .course_services import lessons_of
        return lessons_of(program).count()

    # The catalogue annotates these in one query (see TrainingProgramViewSet); elsewhere they're counted directly.
    def get_rating_average(self, program) -> float | None:
        if hasattr(program, "rating_avg"):
            return round(float(program.rating_avg), 1) if program.rating_avg is not None else None
        from .course_reviews import rating_summary
        return rating_summary(program)["average"]

    def get_rating_count(self, program) -> int:
        if hasattr(program, "rating_total"):
            return program.rating_total or 0
        return program.reviews.count()

    def get_learner_count(self, program) -> int:
        if hasattr(program, "learner_total"):
            return program.learner_total or 0
        return program.enrollments.filter(status__in=ACTIVE_LEARNER_STATUSES).count()


ACTIVE_LEARNER_STATUSES = ("ENROLLED", "IN_PROGRESS", "COMPLETED")


class TrainingProgramDetailSerializer(TrainingProgramSerializer):
    """The course page: everything on the card plus the syllabus (titles and kinds only — content stays locked)."""
    syllabus = serializers.SerializerMethodField()

    class Meta(TrainingProgramSerializer.Meta):
        fields = TrainingProgramSerializer.Meta.fields + ["syllabus"]

    def get_syllabus(self, program) -> list:
        return [
            {
                "id": str(module.id), "title": module.title,
                "lessons": [{"id": str(lesson.id), "title": lesson.title, "kind": lesson.kind} for lesson in module.lessons.all()],
            }
            for module in program.modules.prefetch_related("lessons")
        ]


class TrainingEnrollmentSerializer(serializers.ModelSerializer):
    program_detail = TrainingProgramSerializer(source="program", read_only=True)
    progress = serializers.SerializerMethodField()
    payment = serializers.SerializerMethodField()

    class Meta:
        model = TrainingEnrollment
        fields = ["id", "program", "program_detail", "status", "progress", "payment", "enrolled_at", "completed_at", "certificate_issued_at", "certificate_code"]
        read_only_fields = ["status", "enrolled_at", "completed_at", "certificate_issued_at", "certificate_code"]

    def get_progress(self, enrollment) -> dict:
        from .course_services import course_progress

        return course_progress(enrollment)

    def get_payment(self, enrollment) -> dict | None:
        """The course fee's payment, if any: its booking status (PAYMENT_PROCESSING while waiting for the learner to
        approve it, PAYMENT_FAILED/EXPIRED if it didn't go through) and where the money is (HELD in escrow, RELEASED
        to the provider)."""
        booking = enrollment.booking
        if booking is None:
            return None
        escrow = getattr(booking, "escrow", None)
        return {
            "status": booking.status, "amount_xaf": str(booking.amount_xaf),
            "escrow_status": escrow.status if escrow is not None else None,
        }


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
