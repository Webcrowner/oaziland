"""Search assistance endpoints for the marketplace search box: spelling and synonym hints, trending searches
and search by photo. See marketplace/search_assist.py."""
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .search_assist import VisualSearchUnavailable, describe_image_keywords, did_you_mean, expand_terms, fold, trending_searches

MAX_QUERY_LENGTH = 100
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")


def _looks_like_image(head: bytes) -> bool:
    """The file's own first bytes (JPEG, PNG or WebP), since the declared type is only what the browser claims."""
    return head.startswith(b"\xff\xd8\xff") or head.startswith(b"\x89PNG\r\n\x1a\n") or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")


class MarketplaceSearchAssistView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = "marketplace_browse"
    throttle_classes = [ScopedRateThrottle]

    @extend_schema(responses={200: dict})
    def get(self, request):
        q = request.query_params.get("q", "").strip()[:MAX_QUERY_LENGTH]
        typed = {fold(word) for word in q.split()}
        synonyms = []
        for alternatives in expand_terms(q):
            for alternative in alternatives[1:]:
                if fold(alternative) not in typed and alternative not in synonyms:
                    synonyms.append(alternative)
        return Response({"query": q, "did_you_mean": did_you_mean(q), "synonyms": synonyms})


class MarketplaceTrendingSearchesView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = "marketplace_browse"
    throttle_classes = [ScopedRateThrottle]

    @extend_schema(responses={200: dict})
    def get(self, request):
        try:
            days = int(request.query_params.get("days", 7))
        except ValueError:
            days = 7
        return Response({"results": trending_searches(days=days)})


class MarketplaceImageSearchView(APIView):
    """Turns a photo into search words (Google Vision), so a shopper can search by taking a picture."""
    permission_classes = [permissions.AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = "marketplace_image_search"
    throttle_classes = [ScopedRateThrottle]

    @extend_schema(responses={200: dict, 400: dict, 503: dict})
    def post(self, request):
        upload = request.FILES.get("image")
        if upload is None:
            return Response({"detail": "Send a photo in the 'image' field."}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_IMAGE_BYTES:
            return Response({"detail": "The photo must be 5 MB or smaller."}, status=status.HTTP_400_BAD_REQUEST)
        data = upload.read()
        if upload.content_type not in IMAGE_TYPES or not _looks_like_image(data[:12]):
            return Response({"detail": "Use a JPEG, PNG or WebP photo."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            keywords = describe_image_keywords(data)
        except VisualSearchUnavailable:
            return Response({"detail": "Visual search isn't available right now."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"keywords": keywords, "q": " ".join(keywords[:2])})
