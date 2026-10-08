"""
notifications.views — a real gap this closes: every notification
(booking confirmed, listing expiring, birthday greeting, MFA code...)
gets sent through WhatsApp/SMS/email/in-app, but a user had NO way to
see their own notification history inside the app itself — no bell
icon, no list, nothing.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from oaziland.permissions import IsAdminRole
from .models import Notification, GreetingSettings
from .serializers import NotificationSerializer, GreetingSettingsSerializer, ListingShareMessageSerializer


class AdminGreetingSettingsView(APIView):
    """Admin endpoint to view and update automated celebratory greeting settings
    (happy new month and birthday options toggleable on/off, editable message templates)."""
    permission_classes = [IsAdminRole]

    @extend_schema(responses={200: GreetingSettingsSerializer})
    def get(self, request):
        settings_obj = GreetingSettings.get_settings()
        return Response(GreetingSettingsSerializer(settings_obj).data)

    @extend_schema(request=GreetingSettingsSerializer, responses={200: GreetingSettingsSerializer})
    def put(self, request):
        settings_obj = GreetingSettings.get_settings()
        serializer = GreetingSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ListingShareMessageView(APIView):
    """Public: the admin-editable pre-filled text used by the WhatsApp share button on listing cards."""
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: ListingShareMessageSerializer})
    def get(self, request):
        return Response({"listing_share_message": GreetingSettings.get_settings().listing_share_message})


class MyNotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """Scoped to the requester's own notifications only — the same
    'my X' pattern as MyRoomAllocationViewSet, MyEnrollmentViewSet, etc."""
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notification.objects.none()
        return Notification.objects.filter(recipient=self.request.user).order_by("-created_at")

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.mark_read()
        return Response(NotificationSerializer(notification).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        unread = self.get_queryset().filter(read_at__isnull=True)
        count = unread.count()
        for notification in unread:
            notification.mark_read()
        return Response({"marked_read": count})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        return Response({"unread_count": self.get_queryset().filter(read_at__isnull=True).count()})
