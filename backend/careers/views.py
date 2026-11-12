"""
careers.views — the real Training/Course API. list/retrieve are
public (browsing available courses shouldn't require an account,
matching how the platform treats browsing everywhere else);
enrolling requires login.
"""
import logging

import django_filters
from django.db.models import Count, Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from oaziland.permissions import IsOwnerOrReadOnly
from .models import TrainingProgram, TrainingEnrollment, TrainingEnrollmentStatus, JobPosting, JobApplication
from .serializers import (
    TrainingProgramSerializer, TrainingEnrollmentSerializer, JobPostingSerializer, JobApplicationSerializer,
    UpdateApplicationStatusSerializer, ShareJobPostingSerializer,
)
from .services import (
    enroll_in_training, AlreadyEnrolledError, apply_to_job, AlreadyAppliedError,
    update_application_status, share_job_posting_via_whatsapp, mark_training_in_progress, drop_training,
    InvalidEnrollmentTransitionError, requires_payment, pay_for_training, CoursePaymentError,
    CoursePaymentInProgressError,
)
from .course_services import (
    CourseError, QuizLockedError, complete_lesson, course_progress, is_platform_admin, learner_outline, lessons_of,
    submit_assignment, submit_quiz,
)
from .models import AssignmentSubmission
from .certificate_pdf import certificate_design

logger = logging.getLogger(__name__)


def pdf_response(submission):
    response = FileResponse(submission.file.open("rb"), content_type="application/pdf")
    response["Content-Disposition"] = 'inline; filename="submission.pdf"'
    response["X-Content-Type-Options"] = "nosniff"
    return response


class TrainingProgramFilter(django_filters.FilterSet):
    """?category=TENANT_LAW&q=lease&free=true&certificate=true&ordering=popular|rating|price_asc|price_desc"""
    q = django_filters.CharFilter(method="filter_q")
    free = django_filters.BooleanFilter(method="filter_free")
    certificate = django_filters.BooleanFilter(field_name="issues_certification")
    ordering = django_filters.ChoiceFilter(
        method="filter_ordering",
        choices=[("popular", "Most popular"), ("rating", "Highest rated"), ("price_asc", "Lowest price"), ("price_desc", "Highest price")],
    )

    class Meta:
        model = TrainingProgram
        fields = ["category"]

    def filter_q(self, queryset, name, value):
        value = value.strip()
        if not value:
            return queryset
        return queryset.filter(Q(title__icontains=value) | Q(description__icontains=value))

    def filter_free(self, queryset, name, value):
        free = Q(price_xaf__isnull=True) | Q(price_xaf=0)
        return queryset.filter(free) if value else queryset.exclude(free)

    def filter_ordering(self, queryset, name, value):
        from django.db.models import F
        from django.db.models.functions import Coalesce
        from decimal import Decimal
        return {
            "popular": queryset.order_by(F("learner_total").desc(nulls_last=True), "title"),
            "rating": queryset.order_by(F("rating_avg").desc(nulls_last=True), F("rating_total").desc(nulls_last=True), "title"),
            "price_asc": queryset.order_by(Coalesce("price_xaf", Decimal("0")), "title"),
            "price_desc": queryset.order_by(Coalesce("price_xaf", Decimal("0")).desc(), "title"),
        }.get(value, queryset)


def _with_catalogue_stats(queryset):
    """Adds lesson_total, rating_avg, rating_total and learner_total, each from its own subquery so they never
    multiply each other's rows."""
    from django.db.models import Avg, IntegerField, OuterRef, Subquery
    from django.db.models.functions import Coalesce
    from .models import CourseReview, Lesson
    from .serializers import ACTIVE_LEARNER_STATUSES

    def count_of(qs):
        return Coalesce(Subquery(qs.values("n")[:1], output_field=IntegerField()), 0)

    reviews = CourseReview.objects.filter(program=OuterRef("pk")).values("program")
    return queryset.annotate(
        lesson_total=count_of(Lesson.objects.filter(module__program=OuterRef("pk")).values("module__program").annotate(n=Count("id"))),
        rating_total=count_of(reviews.annotate(n=Count("id"))),
        rating_avg=Subquery(reviews.annotate(a=Avg("score")).values("a")[:1]),
        learner_total=count_of(
            TrainingEnrollment.objects.filter(program=OuterRef("pk"), status__in=ACTIVE_LEARNER_STATUSES)
            .values("program").annotate(n=Count("id"))
        ),
    )


class TrainingProgramViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = TrainingProgramSerializer
    queryset = TrainingProgram.objects.select_related("provider", "event").order_by("title")
    permission_classes = [permissions.AllowAny]
    filterset_class = TrainingProgramFilter

    def get_serializer_class(self):
        if self.action == "retrieve":
            from .serializers import TrainingProgramDetailSerializer
            return TrainingProgramDetailSerializer
        return TrainingProgramSerializer

    def filter_queryset(self, queryset):
        # Catalogue filters (?q=, ?category=...) only apply to the list; a course's own endpoints use ?q= for other things.
        return queryset if self.detail else super().filter_queryset(queryset)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return TrainingProgram.objects.none()
        queryset = _with_catalogue_stats(self.queryset)
        if is_platform_admin(self.request.user):
            return queryset
        # Drafts stay hidden from the public catalogue (staff still reach them via /api/manage/).
        return queryset.filter(is_published=True)

    @action(detail=True, methods=["get", "post", "delete"], permission_classes=[permissions.AllowAny])
    def reviews(self, request, pk=None):
        """GET: the course's rating, reviews and whether the viewer may review it. POST {score, text}: add or update
        the viewer's own review. DELETE: remove it."""
        from .course_reviews import CourseReviewError, delete_review, reviews_payload, save_review
        program = self.get_object()
        if request.method != "GET" and not request.user.is_authenticated:
            return Response({"detail": "Sign in to review this course."}, status=status.HTTP_401_UNAUTHORIZED)
        if request.method == "POST":
            try:
                save_review(program, request.user, score=request.data.get("score"), text=str(request.data.get("text", "")))
            except CourseReviewError as e:
                return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        elif request.method == "DELETE" and not delete_review(program, request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(reviews_payload(program, request.user))

    @action(detail=True, methods=["get", "post"], permission_classes=[permissions.IsAuthenticated])
    def discussions(self, request, pk=None):
        """GET ?lesson=<id>&q=<text>: the course's threads, newest activity first. POST {title, body, lesson?}: start
        a thread. Enrolled learners and course staff only."""
        from .course_discussions import DiscussionError, can_participate, create_thread, list_threads, thread_detail
        program = self.get_object()
        if not can_participate(program, request.user):
            return Response({"detail": "Enroll in this course to join its discussions."}, status=status.HTTP_403_FORBIDDEN)
        if request.method == "POST":
            try:
                thread = create_thread(
                    program, request.user, title=str(request.data.get("title", "")), body=str(request.data.get("body", "")),
                    lesson_id=request.data.get("lesson") or None,
                )
            except DiscussionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
            return Response(thread_detail(thread, request.user), status=status.HTTP_201_CREATED)
        return Response(list_threads(
            program, request.user, lesson_id=request.query_params.get("lesson") or None, query=request.query_params.get("q", ""),
        ))

    @action(
        detail=True, methods=["get", "post", "patch", "delete"], permission_classes=[permissions.IsAuthenticated],
        url_path=r"discussions/(?P<post_id>[0-9a-fA-F-]{32,36})",
    )
    def discussion_post(self, request, pk=None, post_id=None):
        """GET: a thread with its replies. POST {body}: reply to the thread. PATCH {body, title?}: edit your own post.
        DELETE: remove a post (its author or course staff)."""
        from .course_discussions import DiscussionError, can_participate, delete_post, edit_post, reply_to, thread_detail
        from .models import CourseDiscussionPost
        program = self.get_object()
        if not can_participate(program, request.user):
            return Response({"detail": "Enroll in this course to join its discussions."}, status=status.HTTP_403_FORBIDDEN)
        post = CourseDiscussionPost.objects.select_related("program", "author", "lesson", "parent").filter(pk=post_id, program=program).first()
        if post is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        thread = post.parent or post
        try:
            if request.method == "POST":
                reply_to(thread, request.user, body=str(request.data.get("body", "")))
            elif request.method == "PATCH":
                title = request.data.get("title")
                edit_post(post, request.user, body=str(request.data.get("body", "")), title=None if title is None else str(title))
            elif request.method == "DELETE":
                delete_post(post, request.user)
                if post.pk == thread.pk:
                    return Response(status=status.HTTP_204_NO_CONTENT)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except DiscussionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        thread.refresh_from_db()
        return Response(thread_detail(thread, request.user))

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def enroll(self, request, pk=None):
        """Free courses enroll straight away (201). A paid course needs {"phone_number"}: the Mobile Money payment is
        started and the enrollment waits as PAYMENT_PENDING (202) until the provider's webhook confirms it."""
        program = self.get_object()
        if requires_payment(program, request.user):
            from payments.gateways import get_active_gateway
            from transactions.locks import get_booking_lock_client
            try:
                enrollment = pay_for_training(
                    program=program, student=request.user, phone_number=request.data.get("phone_number", ""),
                    lock_client=get_booking_lock_client(), payment_gateway=get_active_gateway(),
                )
            except AlreadyEnrolledError as e:
                return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
            except CoursePaymentInProgressError as e:
                return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
            except CoursePaymentError as e:
                return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
            except Exception:
                logger.exception("Course payment infrastructure is unavailable.")
                return Response(
                    {"detail": "Payments are temporarily unavailable. Please try again later."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            code = status.HTTP_202_ACCEPTED if enrollment.status == TrainingEnrollmentStatus.PAYMENT_PENDING else status.HTTP_201_CREATED
            return Response(TrainingEnrollmentSerializer(enrollment).data, status=code)
        try:
            enrollment = enroll_in_training(program=program, student=request.user)
        except AlreadyEnrolledError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(TrainingEnrollmentSerializer(enrollment).data, status=status.HTTP_201_CREATED)


class MyEnrollmentPagination(PageNumberPagination):
    """The catalogue page maps every enrollment onto its program, so it
    needs the full set — the default 20-per-page would silently hide a
    student's enrollment in any program beyond the first page."""
    page_size = 100


class MyEnrollmentViewSet(viewsets.ReadOnlyModelViewSet):
    """A student's own enrollments — scoped to self, the same pattern
    as MyRoomAllocationViewSet and every other 'my X' endpoint."""
    serializer_class = TrainingEnrollmentSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = MyEnrollmentPagination

    @staticmethod
    def _transition(fn, enrollment):
        try:
            fn(enrollment)
        except InvalidEnrollmentTransitionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(TrainingEnrollmentSerializer(enrollment).data)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return TrainingEnrollment.objects.none()
        return TrainingEnrollment.objects.filter(student=self.request.user).select_related("program", "booking__escrow").order_by("-enrolled_at")

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """The real gap this closes: enrollment could only ever go
        ENROLLED → COMPLETED, with no way to mark IN_PROGRESS."""
        enrollment = self.get_object()
        return self._transition(mark_training_in_progress, enrollment)

    @action(detail=True, methods=["post"])
    def drop(self, request, pk=None):
        """The real gap this closes: a student had no way to back out
        of a training they'd enrolled in."""
        enrollment = self.get_object()
        return self._transition(drop_training, enrollment)

    @action(detail=True, methods=["get"])
    def course(self, request, pk=None):
        """The course player's data: syllabus, lesson content and the
        learner's own progress (never the quiz answers)."""
        enrollment = self.get_object()
        if enrollment.status == TrainingEnrollmentStatus.PAYMENT_PENDING:
            return Response({"detail": "Pay for this course to open it."}, status=status.HTTP_402_PAYMENT_REQUIRED)
        if enrollment.status == TrainingEnrollmentStatus.DROPPED:
            return Response({"detail": "You're no longer enrolled in this course."}, status=status.HTTP_403_FORBIDDEN)
        return Response(learner_outline(enrollment, request))

    @action(detail=True, methods=["post"], url_path=r"lessons/(?P<lesson_id>[0-9a-fA-F-]{32,36})/complete")
    def complete_lesson(self, request, pk=None, lesson_id=None):
        enrollment = self.get_object()
        try:
            complete_lesson(enrollment, lesson_id)
        except (InvalidEnrollmentTransitionError, CourseError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        enrollment.refresh_from_db()
        return Response({"status": enrollment.status, "progress": course_progress(enrollment)})

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser], url_path=r"assignments/(?P<lesson_id>[0-9a-fA-F-]{32,36})/submit")
    def submit_assignment(self, request, pk=None, lesson_id=None):
        enrollment = self.get_object()
        file = request.FILES.get("file")
        if file is None:
            return Response({"detail": "Attach your PDF as 'file'."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            submission = submit_assignment(enrollment, lesson_id, file)
        except (InvalidEnrollmentTransitionError, CourseError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT if isinstance(e, InvalidEnrollmentTransitionError) else status.HTTP_400_BAD_REQUEST)
        return Response({"status": submission.status}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path=r"assignments/(?P<lesson_id>[0-9a-fA-F-]{32,36})/file")
    def assignment_file(self, request, pk=None, lesson_id=None):
        """A learner can always re-open their own submitted PDF."""
        enrollment = self.get_object()
        submission = AssignmentSubmission.objects.filter(enrollment=enrollment, lesson_id=lesson_id).first()
        if submission is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return pdf_response(submission)

    @action(detail=True, methods=["post"], url_path=r"quizzes/(?P<lesson_id>[0-9a-fA-F-]{32,36})/submit")
    def submit_quiz(self, request, pk=None, lesson_id=None):
        enrollment = self.get_object()
        answers = request.data.get("answers")
        if not isinstance(answers, dict):
            return Response({"detail": "answers must be an object of question id to selected choice ids."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = submit_quiz(enrollment, lesson_id, answers)
        except QuizLockedError as e:
            return Response({"detail": str(e), "retry_at": e.retry_at}, status=status.HTTP_409_CONFLICT)
        except (InvalidEnrollmentTransitionError, CourseError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        enrollment.refresh_from_db()
        return Response({**result, "status": enrollment.status, "progress": course_progress(enrollment)})


class JobPostingViewSet(viewsets.ModelViewSet):
    """The real gap this closes: JobPosting/JobApplication had real
    models and real service functions (apply_to_job,
    update_application_status) but no endpoint anywhere ever exposed
    either one. list/retrieve public — browsing open positions
    shouldn't require an account; create requires login; only the
    posting's own poster can update it (IsOwnerOrReadOnly, now
    extended to recognize posted_by alongside listed_by/owner/etc.)."""
    serializer_class = JobPostingSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return JobPosting.objects.none()
        if self.action == "list":
            return JobPosting.objects.filter(status="OPEN").select_related("quarter", "posted_by").order_by("-posted_at")
        return JobPosting.objects.select_related("quarter", "posted_by")

    def perform_create(self, serializer):
        serializer.save(posted_by=self.request.user)

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def apply(self, request, pk=None):
        posting = self.get_object()
        try:
            application = apply_to_job(job_posting=posting, applicant=request.user, cover_message=request.data.get("cover_message", ""))
        except AlreadyAppliedError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(JobApplicationSerializer(application).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def applications(self, request, pk=None):
        """Only the job's own poster can see who applied — a real
        privacy boundary, not just an oversight of who calls this."""
        posting = self.get_object()
        if posting.posted_by_id != request.user.id:
            return Response({"detail": "Only the job's poster can view its applications."}, status=status.HTTP_403_FORBIDDEN)
        return Response(JobApplicationSerializer(posting.applications.select_related("applicant").order_by("-applied_at"), many=True).data)

    @action(detail=True, methods=["post"], url_path="update-application", permission_classes=[permissions.IsAuthenticated])
    def update_application(self, request, pk=None):
        """The real gap this closes: update_application_status() existed
        and was tested, but a poster could only ever VIEW who applied
        (see 'applications' above) — never actually shortlist, reject,
        or hire anyone through the app."""
        posting = self.get_object()
        if posting.posted_by_id != request.user.id:
            return Response({"detail": "Only the job's poster can update an application's status."}, status=status.HTTP_403_FORBIDDEN)
        input_serializer = UpdateApplicationStatusSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        application = posting.applications.filter(id=input_serializer.validated_data["application_id"]).first()
        if application is None:
            return Response({"detail": "That application was not found on this job posting."}, status=status.HTTP_404_NOT_FOUND)
        update_application_status(application=application, new_status=input_serializer.validated_data["new_status"])
        return Response(JobApplicationSerializer(application).data)

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def share(self, request, pk=None):
        """The real gap this closes: share_job_posting_via_whatsapp()
        reused Part B's build_whatsapp_action() exactly as designed,
        but nothing ever exposed it over HTTP."""
        posting = self.get_object()
        input_serializer = ShareJobPostingSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        result = share_job_posting_via_whatsapp(
            job_posting=posting, shared_by=request.user,
            recipient_phone=input_serializer.validated_data["recipient_phone"],
        )
        return Response({"deep_link": result["deep_link"], "message": result["message"]})


class MyJobApplicationViewSet(viewsets.ReadOnlyModelViewSet):
    """A real applicant's own application history — the same 'my X'
    pattern as MyEnrollmentViewSet directly above."""
    serializer_class = JobApplicationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return JobApplication.objects.none()
        return JobApplication.objects.filter(applicant=self.request.user).select_related("job_posting").order_by("-applied_at")


class CertificateView(viewsets.ViewSet):
    """GET /api/certificates/<code>/ — public verification of a course certificate. Shows only what is printed on
    the certificate itself, so an employer can confirm it's genuine."""
    permission_classes = [permissions.AllowAny]
    # Every page view makes several reads (the web server's metadata + page fetches, then the image), often from the
    # web server's single IP, so verification gets its own bucket instead of the 60/hour anonymous one.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "certificate_view"

    @staticmethod
    def _find(code):
        return (
            TrainingEnrollment.objects.select_related(
                "student", "program__provider", "program__certificate_template", "certificate_design",
            )
            .filter(certificate_code=str(code or "").strip().upper(), certificate_issued_at__isnull=False)
            .first()
        )

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """GET /api/certificates/<code>/pdf/?lang=fr — the certificate as a downloadable PDF."""
        from django.http import HttpResponse
        from .certificate_pdf import render_certificate_pdf
        enrollment = self._find(pk)
        if enrollment is None:
            return Response({"detail": "No certificate with this code exists."}, status=status.HTTP_404_NOT_FOUND)
        locale = "fr" if request.query_params.get("lang") == "fr" else "en"
        response = HttpResponse(render_certificate_pdf(enrollment, locale), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="oaziland-certificate-{enrollment.certificate_code}.pdf"'
        return response

    @action(detail=True, methods=["get"])
    def image(self, request, pk=None):
        """GET /api/certificates/<code>/image/?lang=fr — the certificate as a PNG, as shown on the verification page."""
        from django.http import HttpResponse
        from .certificate_pdf import render_certificate_image
        from .certificate_templates import to_png
        enrollment = self._find(pk)
        if enrollment is None:
            return Response({"detail": "No certificate with this code exists."}, status=status.HTTP_404_NOT_FOUND)
        locale = "fr" if request.query_params.get("lang") == "fr" else "en"
        response = HttpResponse(to_png(render_certificate_image(enrollment, locale)), content_type="image/png")
        response["Cache-Control"] = "public, max-age=300"
        return response

    def retrieve(self, request, pk=None):
        enrollment = self._find(pk)
        if enrollment is None:
            return Response({"detail": "No certificate with this code exists."}, status=status.HTTP_404_NOT_FOUND)
        program, student = enrollment.program, enrollment.student
        return Response({
            "code": enrollment.certificate_code,
            "learner_name": student.full_name or student.username,
            "course_id": str(program.id),
            "course_title": program.title,
            "category": program.category,
            "provider_name": program.provider.full_name or program.provider.username,
            "issued_at": enrollment.certificate_issued_at,
            "completed_at": enrollment.completed_at or enrollment.certificate_issued_at,
            "expires_at": enrollment.certificate_expires_at,
            "is_expired": bool(enrollment.certificate_expires_at and enrollment.certificate_expires_at <= timezone.now()),
            "hours": enrollment.certificate_hours,
            "grade_percent": enrollment.certificate_grade_percent,
            "lesson_count": lessons_of(program).count(),
            "orientation": getattr(certificate_design(enrollment), "orientation", "LANDSCAPE"),
        })


class TrainerPublicView(viewsets.ViewSet):
    """GET /api/trainers/<user id>/ — a trainer's public page: profile, stats and published courses."""
    permission_classes = [permissions.AllowAny]

    def retrieve(self, request, pk=None):
        from identity.models import User
        from .trainer_profiles import public_profile
        user = User.objects.filter(pk=pk, is_active=True).first() if _is_uuid(pk) else None
        data = public_profile(user, request) if user else None
        if data is None:
            return Response({"detail": "Trainer not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(data)


class MyTrainerProfileView(viewsets.ViewSet):
    """GET / PUT {headline, bio, website} /api/my-trainer-profile/ — the signed-in trainer's own public profile."""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        from .trainer_profiles import my_profile_payload
        return Response(my_profile_payload(request.user))

    @action(detail=False, methods=["put"], url_path="save")
    def save(self, request):
        from .trainer_profiles import TrainerProfileError, save_my_profile
        try:
            return Response(save_my_profile(request.user, request.data))
        except TrainerProfileError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


def _is_uuid(value) -> bool:
    import uuid
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False
