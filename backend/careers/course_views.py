"""Course authoring + supervision API (admin / lecturer / supervisor)."""
from django.db.models import Count
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .course_serializers import (
    AssignStaffSerializer, CourseManageSerializer, CourseModuleStaffSerializer, CourseStaffSerializer,
    LessonStaffSerializer, QuizQuestionStaffSerializer,
)
from .course_services import (
    CourseError, assign_staff, can_edit_course, editable_programs, is_platform_admin,
    manageable_programs, review_submission,
)
from .models import AssignmentSubmission, CourseModule, CourseStaff, Lesson, QuizAttempt, QuizQuestion, TrainingEnrollment
from .views import pdf_response


def _require_admin(user):
    if not is_platform_admin(user):
        raise PermissionDenied("Only an administrator can do this.")


class ManageCourseViewSet(viewsets.ModelViewSet):
    """Admins see and create every course; lecturers edit the courses
    they're assigned to; supervisors can only follow learners."""
    serializer_class = CourseManageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return CourseManageSerializer.Meta.model.objects.none()
        return (
            manageable_programs(self.request.user).distinct().order_by("title")
            .prefetch_related("modules__lessons__questions__choices")
        )

    def perform_create(self, serializer):
        _require_admin(self.request.user)
        serializer.save(provider=self.request.user)

    def perform_update(self, serializer):
        if not can_edit_course(self.request.user, serializer.instance):
            raise PermissionDenied("Only an administrator or the course lecturer can edit this course.")
        serializer.save()

    def perform_destroy(self, instance):
        _require_admin(self.request.user)
        instance.delete()

    @action(detail=True, methods=["get", "post"], url_path="staff")
    def staff(self, request, pk=None):
        program = self.get_object()
        if request.method == "GET":
            rows = CourseStaff.objects.filter(program=program).select_related("user").order_by("assigned_at")
            return Response(CourseStaffSerializer(rows, many=True).data)
        _require_admin(request.user)
        data = AssignStaffSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            row = assign_staff(program=program, **data.validated_data)
        except CourseError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CourseStaffSerializer(row).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"staff/(?P<staff_id>\d+)")
    def remove_staff(self, request, pk=None, staff_id=None):
        program = self.get_object()
        _require_admin(request.user)
        deleted, _ = CourseStaff.objects.filter(program=program, pk=staff_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=["get"])
    def submissions(self, request, pk=None):
        """Every assignment submitted to this course — the reviewer's queue."""
        program = self.get_object()
        rows = (
            AssignmentSubmission.objects.filter(enrollment__program=program)
            .select_related("enrollment__student", "lesson", "reviewed_by")
        )
        wanted = request.query_params.get("status")
        if wanted:
            rows = rows.filter(status=wanted)
        return Response([
            {
                "id": str(s.id), "lesson": str(s.lesson_id), "lesson_title": s.lesson.title,
                "student_name": s.enrollment.student.full_name, "username": s.enrollment.student.username,
                "status": s.status, "feedback": s.feedback, "submitted_at": s.submitted_at,
                "reviewed_by": s.reviewed_by.full_name or s.reviewed_by.username if s.reviewed_by else None,
                "reviewed_at": s.reviewed_at,
            }
            for s in rows
        ])

    @action(detail=True, methods=["get"], url_path=r"submissions/(?P<submission_id>[0-9a-fA-F-]{32,36})/file")
    def submission_file(self, request, pk=None, submission_id=None):
        program = self.get_object()
        submission = AssignmentSubmission.objects.filter(pk=submission_id, enrollment__program=program).first()
        if submission is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return pdf_response(submission)

    @action(detail=True, methods=["post"], url_path=r"submissions/(?P<submission_id>[0-9a-fA-F-]{32,36})/review")
    def review_submission(self, request, pk=None, submission_id=None):
        program = self.get_object()
        submission = AssignmentSubmission.objects.select_related("enrollment__program", "lesson").filter(
            pk=submission_id, enrollment__program=program,
        ).first()
        if submission is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        try:
            review_submission(
                submission, reviewer=request.user,
                decision=request.data.get("decision", ""), feedback=request.data.get("feedback", ""),
            )
        except CourseError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"status": submission.status})

    @action(detail=True, methods=["get"])
    def learners(self, request, pk=None):
        """Tracking view for the supervisor: every learner with their
        progress, plus each quiz's best and latest result."""
        program = self.get_object()
        total = Lesson.objects.filter(module__program=program).count()
        enrollments = (
            TrainingEnrollment.objects.filter(program=program).select_related("student")
            .annotate(done=Count("lesson_progress", distinct=True)).order_by("-enrolled_at")
        )
        attempts = {}
        for attempt in QuizAttempt.objects.filter(enrollment__program=program).select_related("lesson").order_by("submitted_at"):
            attempts.setdefault(attempt.enrollment_id, {}).setdefault(attempt.lesson_id, []).append(attempt)

        rows = []
        for e in enrollments:
            quizzes = [
                {
                    "lesson": str(lesson_id), "lesson_title": items[-1].lesson.title,
                    "attempts": len(items), "best_score_percent": max(a.score_percent for a in items),
                    "latest_score_percent": items[-1].score_percent, "passed": any(a.passed for a in items),
                }
                for lesson_id, items in attempts.get(e.id, {}).items()
            ]
            rows.append({
                "enrollment": str(e.id), "student_name": e.student.full_name, "username": e.student.username,
                "phone": e.student.phone, "status": e.status, "enrolled_at": e.enrolled_at,
                "completed_at": e.completed_at, "certificate_issued_at": e.certificate_issued_at,
                "lessons_done": e.done, "lessons_total": total,
                "progress_percent": round(e.done * 100 / total) if total else 0, "quizzes": quizzes,
            })
        return Response(rows)


class _EditorViewSet(mixins.CreateModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                     mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Create/read/update/delete limited to the courses the requester
    may edit; subclasses say how an object maps back to its program."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    program_of = staticmethod(lambda obj: obj.program)
    program_lookup = "program"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.model.objects.none()
        return self.model.objects.filter(**{f"{self.program_lookup}__in": editable_programs(self.request.user)})

    def perform_create(self, serializer):
        parent = serializer.validated_data[self.parent_field]
        program = self.program_of_parent(parent)
        if not can_edit_course(self.request.user, program):
            raise PermissionDenied("You can't edit this course.")
        extra = {}
        if "position" not in serializer.validated_data:
            extra["position"] = self.model.objects.filter(**{self.parent_field: parent}).count()  # append at the end
        serializer.save(**extra)


class ModuleEditorViewSet(_EditorViewSet):
    model = CourseModule
    serializer_class = CourseModuleStaffSerializer
    parent_field = "program"
    program_of_parent = staticmethod(lambda program: program)


class LessonEditorViewSet(_EditorViewSet):
    model = Lesson
    serializer_class = LessonStaffSerializer
    program_lookup = "module__program"
    parent_field = "module"
    program_of_parent = staticmethod(lambda module: module.program)


class QuestionEditorViewSet(_EditorViewSet):
    model = QuizQuestion
    serializer_class = QuizQuestionStaffSerializer
    program_lookup = "lesson__module__program"
    parent_field = "lesson"
    program_of_parent = staticmethod(lambda lesson: lesson.module.program)
