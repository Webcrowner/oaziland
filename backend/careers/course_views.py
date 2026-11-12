"""Course authoring + supervision API (admin / lecturer / supervisor)."""
from django.db.models import Count
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .course_serializers import (
    AssignStaffSerializer, CourseManageSerializer, CourseModuleStaffSerializer, CourseStaffSerializer,
    LessonStaffSerializer, QuizQuestionStaffSerializer,
)
from .course_services import (
    OWNER, CourseError, assign_staff, can_create_courses, can_edit_course, can_manage_team, can_publish_own_courses,
    editable_programs, is_platform_admin, manageable_programs, may_publish, require_no_empty_quizzes, review_submission,
    staff_role_for,
)
from .models import AssignmentSubmission, CourseModule, CourseStaff, Lesson, QuizAttempt, QuizQuestion, TrainingEnrollment
from .services import InvalidEnrollmentTransitionError, mark_training_completed
from .views import pdf_response


def _require_admin(user):
    if not is_platform_admin(user):
        raise PermissionDenied("Only an administrator can do this.")


def _require_team_manager(user, program):
    if not can_manage_team(user, program):
        raise PermissionDenied("Only an administrator or the course's creator can change the course team.")


def _fee_goes_to_confirmer(user, enrollment) -> bool:
    """Confirming completion releases a paid learner's escrowed fee to the provider; a trainer mustn't release
    their own payment."""
    from transactions.models import EscrowStatus
    if is_platform_admin(user) or enrollment.program.provider_id != user.pk:
        return False
    escrow = getattr(enrollment.booking, "escrow", None) if enrollment.booking_id else None
    return escrow is not None and escrow.status == EscrowStatus.HELD


def _notify_admins_of_review(program, requested_by):
    from identity.models import AdminProfile
    from .services import _in_language, _send
    name = requested_by.full_name or requested_by.username
    for profile in AdminProfile.objects.select_related("user"):
        admin = profile.user
        _send(
            recipient=admin, notification_type="COURSE_REVIEW_REQUESTED",
            title=_in_language(admin, "Course awaiting review", "Formation à vérifier"),
            message=_in_language(
                admin,
                f'{name} submitted "{program.title}" for review. Open it in Manage courses to check and publish it.',
                f"{name} a soumis « {program.title} » pour vérification. Ouvrez-la dans Gérer les cours pour la vérifier et la publier.",
            ),
            related_reference=str(program.id),
        )


def _is_uuid(value) -> bool:
    import uuid
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


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
            .select_related("provider")
            .prefetch_related("modules__lessons__questions__choices")
        )

    def perform_create(self, serializer):
        user = self.request.user
        if not can_create_courses(user):
            raise PermissionDenied("An administrator needs to give you course-creator access first.")
        published = serializer.validated_data.get("is_published", True) and can_publish_own_courses(user)
        serializer.save(provider=user, is_published=published)

    def perform_update(self, serializer):
        user, program = self.request.user, serializer.instance
        if not can_edit_course(user, program):
            raise PermissionDenied("Only an administrator or the course lecturer can edit this course.")
        publishing = serializer.validated_data.get("is_published") is True and not program.is_published
        if publishing and not may_publish(user, program):
            raise PermissionDenied("An administrator reviews and publishes this course. Submit it for review instead.")
        if publishing:
            _require_ready(program)
        serializer.save(**({"review_requested_at": None} if publishing else {}))

    def perform_destroy(self, instance):
        user = self.request.user
        if is_platform_admin(user):
            return instance.delete()
        if staff_role_for(user, instance) != OWNER:
            raise PermissionDenied("Only an administrator or the course's creator can delete it.")
        if instance.enrollments.exists():
            raise PermissionDenied("Learners have enrolled in this course, so only an administrator can delete it. Unpublish it instead.")
        instance.delete()

    @action(detail=False, methods=["get"])
    def access(self, request):
        """GET /api/manage/courses/access/ — what the signed-in user may do in course management."""
        user = request.user
        return Response({
            "is_admin": is_platform_admin(user),
            "can_create": can_create_courses(user),
            "can_publish": can_publish_own_courses(user),
            "has_courses": manageable_programs(user).exists(),
        })

    @action(detail=True, methods=["post"], url_path="request-review")
    def request_review(self, request, pk=None):
        """A trainer without publishing rights asks the admins to review and publish their draft."""
        from django.utils import timezone
        program = self.get_object()
        if not can_edit_course(request.user, program):
            raise PermissionDenied("Only the course's creator or lecturer can submit it for review.")
        if program.is_published:
            return Response({"detail": "This course is already published."}, status=status.HTTP_400_BAD_REQUEST)
        if not program.modules.exists() and not program.description.strip():
            return Response({"detail": "Add a description or some lessons before submitting the course."}, status=status.HTTP_400_BAD_REQUEST)
        _require_ready(program)
        program.review_requested_at = timezone.now()
        program.save(update_fields=["review_requested_at"])
        _notify_admins_of_review(program, request.user)
        return Response(self.get_serializer(program).data)

    @action(detail=True, methods=["get", "post"], url_path="staff")
    def staff(self, request, pk=None):
        program = self.get_object()
        if request.method == "GET":
            rows = CourseStaff.objects.filter(program=program).select_related("user").order_by("assigned_at")
            return Response(CourseStaffSerializer(rows, many=True).data)
        _require_team_manager(request.user, program)
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
        _require_team_manager(request.user, program)
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
    def analytics(self, request, pk=None):
        """Learner funnel, quiz difficulty, rating and (for admins and the provider) earnings for this course."""
        from .course_analytics import course_analytics
        return Response(course_analytics(self.get_object(), request.user))

    @action(detail=True, methods=["get", "put"], url_path="certificate-template")
    def certificate_template(self, request, pk=None):
        """GET: the course's certificate design and the templates it can use. PUT {template_id | null}: admins assign
        a template to the course (null = the platform default)."""
        from . import certificate_templates as templates
        from .certificate_template_views import _payload
        from .models import CertificateTemplate

        program = self.get_object()
        if request.method == "PUT":
            _require_admin(request.user)
            template_id = request.data.get("template_id")
            if template_id in (None, ""):
                program.certificate_template = None
            else:
                program.certificate_template = CertificateTemplate.objects.filter(pk=template_id).first() if _is_uuid(template_id) else None
                if program.certificate_template is None:
                    return Response({"detail": "This certificate template doesn't exist."}, status=status.HTTP_400_BAD_REQUEST)
            program.save(update_fields=["certificate_template"])

        default = templates.active_template()
        return Response({
            "template_id": str(program.certificate_template_id) if program.certificate_template_id else None,
            "default": _payload(request, default) if default else None,
            "builtin": {"layout": templates.default_layout(), "background_color": templates.DEFAULT_BACKGROUND},
            "options": [_payload(request, t) for t in CertificateTemplate.objects.all()],
            "can_change": is_platform_admin(request.user),
        })

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

    @action(detail=True, methods=["post"], url_path=r"learners/(?P<enrollment_id>[0-9a-fA-F-]{32,36})/complete")
    def complete_learner(self, request, pk=None, enrollment_id=None):
        """Course staff confirm that a learner finished a course without lessons (an in-person or scheduled
        training). Lesson-based courses complete on their own once every lesson and quiz is done, so this is
        refused for them until then."""
        program = self.get_object()
        enrollment = TrainingEnrollment.objects.select_related("program").filter(pk=enrollment_id, program=program).first()
        if enrollment is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if _fee_goes_to_confirmer(request.user, enrollment):
            raise PermissionDenied(
                "This learner paid for the course and finishing it pays you, so an administrator confirms their completion."
            )
        try:
            mark_training_completed(enrollment)
        except InvalidEnrollmentTransitionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response({
            "status": enrollment.status, "completed_at": enrollment.completed_at,
            "certificate_issued_at": enrollment.certificate_issued_at,
        })


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

    def perform_destroy(self, instance):
        # Learners would be left with a quiz they can't pass (Coursera-style: live content is never left unfinished).
        if instance.lesson.module.program.is_published and not instance.lesson.questions.exclude(pk=instance.pk).exists():
            raise CourseNotReady(
                "This is the quiz's last question and the course is published, so learners would have a quiz they can't "
                "pass. Add the new question first, or unpublish the course."
            )
        instance.delete()


class CourseNotReady(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "course_not_ready"


def _require_ready(program):
    try:
        require_no_empty_quizzes(program)
    except CourseError as error:
        raise CourseNotReady(str(error))
