"""
uploads.views — the actual endpoint that finally closes the gap:
POST a real file, get back a real, usable URL. Every existing
consumer (Post.media_urls, the new ListingPhoto model) already
expects exactly this shape — a URL — so this endpoint is the missing
first step, not a new data model to migrate around.
"""
from rest_framework import permissions, status
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .services import upload_media_file, UnsupportedMediaTypeError, MediaTooLargeError


class MediaUploadView(APIView):
    """Requires login — an open, unauthenticated upload endpoint is a
    real abuse vector (anyone could use the platform's storage for
    free, unrelated file hosting)."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser]

    @extend_schema(request={"multipart/form-data": {"type": "object", "properties": {"file": {"type": "string", "format": "binary"}}}}, responses={201: dict, 400: dict})
    def post(self, request):
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "No file was provided."}, status=status.HTTP_400_BAD_REQUEST)

        folder = request.data.get("folder", "uploads")
        try:
            result = upload_media_file(file=file, folder=folder)
        except (UnsupportedMediaTypeError, MediaTooLargeError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({"url": result.url, "media_type": result.media_type}, status=status.HTTP_201_CREATED)
