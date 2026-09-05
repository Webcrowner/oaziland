"""
notifications.views — a real gap this closes: every notification
(booking confirmed, listing expiring, birthday greeting, MFA code...)
gets sent through WhatsApp/SMS/email/in-app, but a user had NO way to
see their own notification history inside the app itself — no bell
icon, no list, nothing.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Notification
from .serializers import NotificationSerializer


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
