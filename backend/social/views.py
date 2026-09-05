"""
social.views — the connected-social-accounts API. A user can only ever
manage their OWN links through this endpoint (get_queryset scopes it),
and creating one REPLACES any existing link for that platform rather
than erroring on a duplicate — matches link_social_account()'s own
update_or_create behavior exactly.
"""
from rest_framework import viewsets, permissions
from rest_framework.views import APIView
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import SocialAccountLink
from .serializers import SocialAccountLinkSerializer
from .services import link_social_account


class SocialAccountLinkViewSet(viewsets.ModelViewSet):
    serializer_class = SocialAccountLinkSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # WHY this guard: drf-spectacular calls get_queryset() during
        # schema generation with no real authenticated user, which
        # previously crashed comparing AnonymousUser to a UUID field.
        if getattr(self, "swagger_fake_view", False):
            return SocialAccountLink.objects.none()
        return SocialAccountLink.objects.filter(user=self.request.user).order_by("-added_at")

    def perform_create(self, serializer):
        link_social_account(
            user=self.request.user,
            platform=serializer.validated_data["platform"],
            handle_or_url=serializer.validated_data["handle_or_url"],
        )


class TestimonialsView(APIView):
    """Real testimonials — pulls from Review (tied to a completed
    Booking, so only people who actually transacted can appear here),
    filtered to a 4+ star score WITH actual written text. WHY this
    never fabricates content: an early-stage platform may genuinely
    have few or zero qualifying reviews yet — this returns exactly
    what's real, including an honestly empty list, rather than ever
    showing placeholder testimonials that didn't happen."""
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .models import Review
        reviews = Review.objects.filter(score__gte=4).exclude(text="").select_related("author").order_by("-created_at")[:20]
        results = [
            {
                "author_name": r.author.full_name or r.author.username,
                "score": r.score,
                "text": r.text,
                "created_at": r.created_at,
            }
            for r in reviews
        ]
        return Response({"count": len(results), "results": results})
