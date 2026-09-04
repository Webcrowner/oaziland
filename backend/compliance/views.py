"""
compliance.views — consent, data export, and public policy documents.
Consent and export are scoped to the authenticated user's OWN records;
policy documents are public (AllowAny) — anyone should be able to read
the current Terms/Privacy Policy without an account.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import ConsentRecord, DataExportRequest, PolicyDocument
from .serializers import ConsentRecordSerializer, DataExportRequestSerializer, PolicyDocumentSerializer
from .services import record_consent, generate_data_export


class ConsentRecordViewSet(viewsets.ModelViewSet):
    serializer_class = ConsentRecordSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # WHY this guard: drf-spectacular calls get_queryset() during
        # schema generation with no real authenticated user, which
        # previously crashed comparing AnonymousUser to a UUID field.
        if getattr(self, "swagger_fake_view", False):
            return ConsentRecord.objects.none()
        return ConsentRecord.objects.filter(user=self.request.user).order_by("-granted_at")

    def perform_create(self, serializer):
        record_consent(
            user=self.request.user,
            consent_type=serializer.validated_data["consent_type"],
            version=serializer.validated_data["version"],
        )


class DataExportRequestViewSet(viewsets.ModelViewSet):
    serializer_class = DataExportRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # WHY this guard: drf-spectacular calls get_queryset() during
        # schema generation with no real authenticated user, which
        # previously crashed comparing AnonymousUser to a UUID field.
        if getattr(self, "swagger_fake_view", False):
            return DataExportRequest.objects.none()
        return DataExportRequest.objects.filter(user=self.request.user).order_by("-requested_at")

    def create(self, request, *args, **kwargs):
        export_request = generate_data_export(request.user)
        return Response(DataExportRequestSerializer(export_request).data, status=status.HTTP_201_CREATED)


class PolicyDocumentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PolicyDocumentSerializer
    permission_classes = [permissions.AllowAny]
    queryset = PolicyDocument.objects.filter(is_current=True)
