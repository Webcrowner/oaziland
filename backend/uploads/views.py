"""
uploads.views — the actual endpoint that finally closes the gap:
POST a real file, get back a real, usable URL. Every existing
consumer (Post.media_urls, the new ListingPhoto model) already
expects exactly this shape — a URL — so this endpoint is the missing
first step, not a new data model to migrate around.
"""
import re

from rest_framework import permissions, status
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .services import upload_media_file, UnsupportedMediaTypeError, MediaTooLargeError


class MediaUploadThrottle(UserRateThrottle):
    scope = "media_upload"


class MediaUploadView(APIView):
    """Requires login — an open, unauthenticated upload endpoint is a
    real abuse vector (anyone could use the platform's storage for
    free, unrelated file hosting). Uploads are also rate-limited per user."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser]

    def get_throttles(self):
        return [*super().get_throttles(), MediaUploadThrottle()]

    @extend_schema(request={"multipart/form-data": {"type": "object", "properties": {"file": {"type": "string", "format": "binary"}}}}, responses={201: dict, 400: dict})
    def post(self, request):
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "No file was provided."}, status=status.HTTP_400_BAD_REQUEST)

        folder = request.data.get("folder", "uploads")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,50}", str(folder)):
            folder = "uploads"
        try:
            result = upload_media_file(file=file, folder=folder)
        except (UnsupportedMediaTypeError, MediaTooLargeError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "url": result.url,
                "media_type": result.media_type,
                **({"duration_seconds": result.duration_seconds, "video_codec": result.video_codec} if result.media_type == "VIDEO" else {}),
            },
            status=status.HTTP_201_CREATED,
        )
