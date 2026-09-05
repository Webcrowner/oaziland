"""
careers.views — the real Training/Course API. list/retrieve are
public (browsing available courses shouldn't require an account,
matching how the platform treats browsing everywhere else);
enrolling requires login.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import TrainingProgram, TrainingEnrollment
from .serializers import TrainingProgramSerializer, TrainingEnrollmentSerializer
from .services import enroll_in_training, mark_training_completed, AlreadyEnrolledError


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
