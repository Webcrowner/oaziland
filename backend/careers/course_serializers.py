from rest_framework import serializers

from .course_services import MAX_PDF_BYTES, MAX_VIDEO_BYTES, VIDEO_CONTENT_TYPES, may_publish, staff_role_for
from .models import (
    CourseModule, CourseStaff, Lesson, LessonKind, QuizChoice, QuizQuestion, TrainingProgram,
)
from .serializers import cover_image_url


class QuizChoiceStaffSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizChoice
        fields = ["id", "text", "is_correct", "position"]
        read_only_fields = ["id", "position"]


class QuizQuestionStaffSerializer(serializers.ModelSerializer):
    choices = QuizChoiceStaffSerializer(many=True)

    class Meta:
        model = QuizQuestion
        fields = ["id", "lesson", "text", "explanation", "position", "choices"]
        read_only_fields = ["id"]

    def validate_lesson(self, lesson):
        if lesson.kind != LessonKind.QUIZ:
            raise serializers.ValidationError("Questions can only be added to a quiz lesson.")
        return lesson

    def validate_choices(self, choices):
        if len(choices) < 2:
            raise serializers.ValidationError("A question needs at least two choices.")
        if not any(c.get("is_correct") for c in choices):
            raise serializers.ValidationError("Mark at least one choice as correct.")
        return choices

    @staticmethod
    def _write_choices(question, choices):
        question.choices.all().delete()
        QuizChoice.objects.bulk_create(
            [QuizChoice(question=question, text=c["text"], is_correct=c.get("is_correct", False), position=i)
             for i, c in enumerate(choices)]
        )

    def create(self, validated_data):
        choices = validated_data.pop("choices")
        question = QuizQuestion.objects.create(**validated_data)
        self._write_choices(question, choices)
        return question

    def update(self, instance, validated_data):
        choices = validated_data.pop("choices", None)
        validated_data.pop("lesson", None)  # a question never moves between quizzes
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if choices is not None:
            self._write_choices(instance, choices)
        return instance


class LessonStaffSerializer(serializers.ModelSerializer):
    pdf_file = serializers.FileField(write_only=True, required=False, allow_empty_file=False)
    remove_pdf = serializers.BooleanField(write_only=True, required=False, default=False)
    video_file = serializers.FileField(write_only=True, required=False, allow_empty_file=False)
    remove_video_file = serializers.BooleanField(write_only=True, required=False, default=False)
    pdf_url = serializers.SerializerMethodField()
    video_file_url = serializers.SerializerMethodField()
    questions = QuizQuestionStaffSerializer(many=True, read_only=True)

    class Meta:
        model = Lesson
        fields = [
            "id", "module", "title", "kind", "position", "content_text", "video_url",
            "video_file", "remove_video_file", "video_file_url",
            "pdf_file", "remove_pdf", "pdf_url", "pass_mark_percent", "questions",
        ]
        read_only_fields = ["id"]

    def _file_url(self, lesson, kind: str) -> str:
        from .course_media import media_url
        request = self.context.get("request")
        return media_url(request, lesson, kind, getattr(request, "user", None))

    def get_pdf_url(self, lesson) -> str:
        return self._file_url(lesson, "pdf")

    def get_video_file_url(self, lesson) -> str:
        return self._file_url(lesson, "video")

    def validate_video_file(self, file):
        if file.size > MAX_VIDEO_BYTES:
            raise serializers.ValidationError("Video files can be at most 500 MB.")
        head = file.read(12)
        file.seek(0)
        looks_valid = head[4:8] == b"ftyp" or head[:4] == b"\x1aE\xdf\xa3" or head[:4] == b"OggS"
        if file.content_type not in VIDEO_CONTENT_TYPES or not looks_valid:
            raise serializers.ValidationError("Upload a valid MP4, WebM, OGG or MOV video.")
        return file

    def validate_pdf_file(self, file):
        if file.size > MAX_PDF_BYTES:
            raise serializers.ValidationError("PDF files can be at most 20 MB.")
        if file.content_type != "application/pdf" or file.read(5) != b"%PDF-":
            raise serializers.ValidationError("Upload a valid PDF file.")
        file.seek(0)
        return file

    def validate_pass_mark_percent(self, value):
        if not 1 <= value <= 100:
            raise serializers.ValidationError("The pass mark must be between 1 and 100.")
        return value

    def validate(self, attrs):
        current = self.instance
        kind = attrs.get("kind", current.kind if current else LessonKind.TEXT)
        has_video_url = bool(attrs.get("video_url", current.video_url if current else ""))
        has_video_file = bool(attrs.get("video_file")) or bool(
            current and current.video_file and not attrs.get("remove_video_file")
        )
        if kind == LessonKind.VIDEO and not (has_video_url or has_video_file):
            raise serializers.ValidationError({"video_url": "A video lesson needs a video link or an uploaded video."})
        has_pdf = bool(attrs.get("pdf_file")) or bool(current and current.pdf_file and not attrs.get("remove_pdf"))
        if kind == LessonKind.PDF and not has_pdf:
            raise serializers.ValidationError({"pdf_file": "A PDF lesson needs a PDF file."})
        return attrs

    def create(self, validated_data):
        validated_data.pop("remove_pdf", None)
        validated_data.pop("remove_video_file", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("module", None)  # a lesson never moves between modules
        if validated_data.pop("remove_pdf", False) and "pdf_file" not in validated_data:
            instance.pdf_file.delete(save=False)
            instance.pdf_file = ""
        if validated_data.pop("remove_video_file", False) and "video_file" not in validated_data:
            instance.video_file.delete(save=False)
            instance.video_file = ""
        return super().update(instance, validated_data)


class CourseModuleStaffSerializer(serializers.ModelSerializer):
    lessons = LessonStaffSerializer(many=True, read_only=True)

    class Meta:
        model = CourseModule
        fields = ["id", "program", "title", "position", "lessons"]
        read_only_fields = ["id"]

    def update(self, instance, validated_data):
        validated_data.pop("program", None)
        return super().update(instance, validated_data)


class CourseManageSerializer(serializers.ModelSerializer):
    modules = CourseModuleStaffSerializer(many=True, read_only=True)
    my_role = serializers.SerializerMethodField()
    learner_count = serializers.SerializerMethodField()
    cover_image = serializers.ImageField(write_only=True, required=False, allow_empty_file=False)
    remove_cover_image = serializers.BooleanField(write_only=True, required=False, default=False)
    cover_image_url = serializers.SerializerMethodField()
    provider_name = serializers.SerializerMethodField()
    can_publish = serializers.SerializerMethodField()

    class Meta:
        model = TrainingProgram
        fields = [
            "id", "title", "description", "category", "price_xaf", "issues_certification",
            "duration_hours", "certificate_validity_months",
            "is_published", "cover_image", "remove_cover_image", "cover_image_url", "modules", "my_role", "learner_count",
            "provider_name", "review_requested_at", "can_publish",
        ]
        read_only_fields = ["id", "review_requested_at"]

    def get_can_publish(self, program) -> bool:
        return may_publish(self.context["request"].user, program)

    def get_provider_name(self, program) -> str:
        return program.provider.full_name or program.provider.username

    def get_my_role(self, program) -> str | None:
        return staff_role_for(self.context["request"].user, program)

    def get_learner_count(self, program) -> int:
        return program.enrollments.count()

    def get_cover_image_url(self, program) -> str:
        return cover_image_url(program, self.context.get("request"))

    def validate_cover_image(self, file):
        from uploads.services import ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE_BYTES
        if file.size > MAX_IMAGE_SIZE_BYTES:
            raise serializers.ValidationError("Cover images can be at most 10 MB.")
        if file.content_type not in ALLOWED_IMAGE_TYPES:
            raise serializers.ValidationError("Upload a JPEG, PNG or WebP image.")
        return file

    def create(self, validated_data):
        validated_data.pop("remove_cover_image", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        old_cover = instance.cover_image.name if instance.cover_image else ""
        if validated_data.pop("remove_cover_image", False) and "cover_image" not in validated_data:
            validated_data["cover_image"] = ""
        program = super().update(instance, validated_data)
        if old_cover and old_cover != (program.cover_image.name if program.cover_image else ""):
            program.cover_image.storage.delete(old_cover)  # replaced or removed: don't leave the old file behind
        return program


class CourseStaffSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)

    class Meta:
        model = CourseStaff
        fields = ["id", "user", "user_name", "username", "phone", "role", "assigned_at"]
        read_only_fields = fields


class AssignStaffSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    role = serializers.ChoiceField(choices=["LECTURER", "SUPERVISOR"])
