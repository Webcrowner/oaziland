"""
careers.views — the real Training/Course API. list/retrieve are
public (browsing available courses shouldn't require an account,
matching how the platform treats browsing everywhere else);
enrolling requires login.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from oaziland.permissions import IsOwnerOrReadOnly
from .models import TrainingProgram, TrainingEnrollment, JobPosting, JobApplication
from .serializers import (
    TrainingProgramSerializer, TrainingEnrollmentSerializer, JobPostingSerializer, JobApplicationSerializer,
    UpdateApplicationStatusSerializer, ShareJobPostingSerializer,
)
from .services import (
    enroll_in_training, mark_training_completed, AlreadyEnrolledError, apply_to_job, AlreadyAppliedError,
    update_application_status, share_job_posting_via_whatsapp, mark_training_in_progress, drop_training,
)


class TrainingProgramViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = TrainingProgramSerializer
    queryset = TrainingProgram.objects.select_related("provider").order_by("title")
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return TrainingProgram.objects.none()
        return self.queryset

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def enroll(self, request, pk=None):
        program = self.get_object()
        try:
            enrollment = enroll_in_training(program=program, student=request.user)
        except AlreadyEnrolledError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(TrainingEnrollmentSerializer(enrollment).data, status=status.HTTP_201_CREATED)


class MyEnrollmentViewSet(viewsets.ReadOnlyModelViewSet):
    """A student's own enrollments — scoped to self, the same pattern
    as MyRoomAllocationViewSet and every other 'my X' endpoint."""
    serializer_class = TrainingEnrollmentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return TrainingEnrollment.objects.none()
        return TrainingEnrollment.objects.filter(student=self.request.user).select_related("program").order_by("-enrolled_at")

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Only the enrolled student can mark their own enrollment
        complete — get_queryset already scopes get_object() to the
        requester's own enrollments, so this can't be called on
        someone else's."""
        enrollment = self.get_object()
        mark_training_completed(enrollment)
        return Response(TrainingEnrollmentSerializer(enrollment).data)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """The real gap this closes: enrollment could only ever go
        ENROLLED → COMPLETED, with no way to mark IN_PROGRESS."""
        enrollment = self.get_object()
        mark_training_in_progress(enrollment)
        return Response(TrainingEnrollmentSerializer(enrollment).data)

    @action(detail=True, methods=["post"])
    def drop(self, request, pk=None):
        """The real gap this closes: a student had no way to back out
        of a training they'd enrolled in."""
        enrollment = self.get_object()
        drop_training(enrollment)
        return Response(TrainingEnrollmentSerializer(enrollment).data)


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
