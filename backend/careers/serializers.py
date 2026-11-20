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
                "id": str(module.id), "title": module.title, "due_after_days": module.due_after_days,
                "lessons": [
                    {"id": str(lesson.id), "title": lesson.title, "kind": lesson.kind, "is_preview": lesson.is_preview}
                    for lesson in module.lessons.all()
                ],
            }
            for module in program.modules.prefetch_related("lessons")
        ]


class TrainingEnrollmentSerializer(serializers.ModelSerializer):
    program_detail = TrainingProgramSerializer(source="program", read_only=True)
    progress = serializers.SerializerMethodField()
    payment = serializers.SerializerMethodField()
    next_lesson = serializers.SerializerMethodField()
    last_activity_at = serializers.SerializerMethodField()

    class Meta:
        model = TrainingEnrollment
        fields = [
            "id", "program", "program_detail", "status", "progress", "payment", "enrolled_at", "completed_at",
            "certificate_issued_at", "certificate_code", "next_lesson", "last_activity_at",
        ]
        read_only_fields = ["status", "enrolled_at", "completed_at", "certificate_issued_at", "certificate_code"]

    def get_progress(self, enrollment) -> dict:
        from .course_services import course_progress

        return course_progress(enrollment)

    def get_next_lesson(self, enrollment) -> dict | None:
        """Where "Continue" takes an active learner (shown on My Learning)."""
        from .course_services import next_lesson
        from .models import TrainingEnrollmentStatus

        if enrollment.status not in (TrainingEnrollmentStatus.ENROLLED, TrainingEnrollmentStatus.IN_PROGRESS):
            return None
        lesson = next_lesson(enrollment)
        return {"id": str(lesson.id), "title": lesson.title, "kind": lesson.kind} if lesson else None

    def get_last_activity_at(self, enrollment):
        from .course_services import last_activity_at

        moment = last_activity_at(enrollment)
        return serializers.DateTimeField().to_representation(moment) if moment else None

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
    applicant_phone = serializers.CharField(source="applicant.phone", read_only=True)
    job_title = serializers.CharField(source="job_posting.title", read_only=True)
    company_name = serializers.CharField(source="job_posting.company_name", read_only=True)
    has_cv = serializers.SerializerMethodField()
    certificates = serializers.SerializerMethodField()

    def get_has_cv(self, obj) -> bool:
        return bool(obj.cv_file)

    def get_certificates(self, obj) -> list[dict]:
        """Verified Oaziland course certificates earned by this applicant (preloaded in context when listing)."""
        preloaded = self.context.get("certificates_by_user")
        if preloaded is not None:
            return preloaded.get(obj.applicant_id, [])
        from .models import TrainingEnrollment
        rows = (
            TrainingEnrollment.objects.select_related("program")
            .filter(student_id=obj.applicant_id, certificate_issued_at__isnull=False)
            .exclude(certificate_code="")
            .order_by("-certificate_issued_at")[:5]
        )
        return [{"code": r.certificate_code, "title": r.program.title} for r in rows]

    class Meta:
        model = JobApplication
        fields = [
            "id", "job_posting", "job_title", "company_name",
            "applicant", "applicant_name", "applicant_phone",
            "cover_message", "years_experience", "has_cv", "cv_filename",
            "certificates", "status", "applied_at",
        ]
        read_only_fields = ["applicant", "status", "applied_at", "cv_filename"]


class UpdateApplicationStatusSerializer(serializers.Serializer):
    application_id = serializers.UUIDField()
    new_status = serializers.ChoiceField(choices=["REVIEWED", "SHORTLISTED", "REJECTED", "HIRED"])


class ShareJobPostingSerializer(serializers.Serializer):
    recipient_phone = serializers.CharField(max_length=50)


class JobPostingSerializer(serializers.ModelSerializer):
    quarter_name = serializers.CharField(source="quarter.name", read_only=True, default=None)
    city_name = serializers.CharField(source="quarter.village_or_district.name", read_only=True, default=None)
    posted_by_name = serializers.CharField(source="posted_by.full_name", read_only=True)
    application_count = serializers.SerializerMethodField()
    is_open = serializers.SerializerMethodField()
    my_application_status = serializers.SerializerMethodField()

    def get_application_count(self, posting) -> int:
        annotated = getattr(posting, "applications_total", None)
        return annotated if annotated is not None else posting.applications.count()

    def get_is_open(self, posting) -> bool:
        from .services import job_is_open
        return job_is_open(posting)

    def get_my_application_status(self, posting):
        """The viewer's own application to this job, if any. The view looks them all up once, so a list costs one query."""
        return self.context.get("my_applications", {}).get(posting.id)

    def validate(self, attrs):
        from django.utils import timezone
        low = attrs.get("salary_min_xaf", getattr(self.instance, "salary_min_xaf", None))
        high = attrs.get("salary_max_xaf", getattr(self.instance, "salary_max_xaf", None))
        if low is not None and high is not None and low > high:
            raise serializers.ValidationError({"salary_max_xaf": "The maximum salary can't be lower than the minimum."})
        closes_at = attrs.get("closes_at")
        if closes_at is not None and closes_at <= timezone.now():
            raise serializers.ValidationError({"closes_at": "The closing date must be in the future."})
        return attrs

    class Meta:
        model = JobPosting
        fields = [
            "id", "posted_by", "posted_by_name", "company_name", "title",
            "role_category", "employment_type", "workplace_type", "description",
            "quarter", "quarter_name", "city_name", "salary_min_xaf", "salary_max_xaf",
            "status", "is_open", "posted_at", "closes_at", "application_count", "my_application_status",
        ]
        read_only_fields = ["posted_by", "status", "posted_at"]


class JobApplySerializer(serializers.Serializer):
    cover_message = serializers.CharField(required=False, allow_blank=True, max_length=2000, default="")
    years_experience = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=60, default=None)
    cv_file = serializers.FileField(required=False, allow_null=True, default=None)
