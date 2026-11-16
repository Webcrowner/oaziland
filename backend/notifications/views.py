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
from .serializers import NotificationSerializer, GreetingSettingsSerializer, ListingShareMessageSerializer, PushDeviceSerializer


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

    def list(self, request, *args, **kwargs):
        from .links import resolve_targets
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        rows = page if page is not None else list(self.filter_queryset(self.get_queryset()))
        serializer = self.get_serializer(rows, many=True, context={**self.get_serializer_context(), "targets": resolve_targets(rows, request.user)})
        return self.get_paginated_response(serializer.data) if page is not None else Response(serializer.data)

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.mark_read()
        return Response(self.get_serializer(notification).data)

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


class PushConfigView(APIView):
    """Public: what a browser needs to subscribe to push (the VAPID public key), and whether sending is switched on."""
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .push import web_push_configured, web_push_public_key
        return Response({"web_push_enabled": web_push_configured(), "web_push_public_key": web_push_public_key()})


class PushDeviceView(APIView):
    """POST registers this browser or phone for the signed-in user's push notifications (re-registering moves
    the device to whoever is signed in now). POST to .../remove/ unregisters it, e.g. on sign-out."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=PushDeviceSerializer, responses={201: dict, 400: dict})
    def post(self, request):
        from .models import PushDevice
        serializer = PushDeviceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        device, created = PushDevice.objects.update_or_create(
            token=data["token"],
            defaults={
                "user": request.user, "platform": data["platform"],
                "web_p256dh": data.get("web_p256dh", ""), "web_auth": data.get("web_auth", ""),
            },
        )
        return Response({"id": device.pk, "platform": device.platform}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class PushDeviceRemoveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=dict, responses={200: dict})
    def post(self, request):
        from .models import PushDevice
        token = str(request.data.get("token", "")).strip()
        removed, _ = PushDevice.objects.filter(token=token, user=request.user).delete() if token else (0, None)
        return Response({"removed": removed})
