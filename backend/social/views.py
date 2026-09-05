"""
social.views — the connected-social-accounts API. A user can only ever
manage their OWN links through this endpoint (get_queryset scopes it),
and creating one REPLACES any existing link for that platform rather
than erroring on a duplicate — matches link_social_account()'s own
update_or_create behavior exactly.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from drf_spectacular.utils import extend_schema
from .models import SocialAccountLink, Conversation
from .serializers import SocialAccountLinkSerializer, ConversationSerializer, MessageSerializer
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


class ConversationViewSet(viewsets.ModelViewSet):
    """A real inbox — list/retrieve/create all scoped to conversations
    the requester is actually a participant in. WHY create looks for
    an EXISTING conversation with the same participant first: starting
    a new, empty conversation every time someone messages the same
    person again would fragment message history across many
    conversations instead of keeping one real thread."""
    serializer_class = ConversationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Conversation.objects.none()
        return Conversation.objects.filter(participants=self.request.user).order_by("-created_at")

    def get_serializer_context(self):
        return {"request": self.request}

    def create(self, request, *args, **kwargs):
        participant_id = request.data.get("participant_id")
        if not participant_id:
            return Response({"detail": "participant_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        existing = Conversation.objects.filter(participants=request.user).filter(participants=participant_id).first()
        if existing:
            return Response(ConversationSerializer(existing, context={"request": request}).data, status=status.HTTP_200_OK)

        conversation = Conversation.objects.create()
        conversation.participants.add(request.user, participant_id)
        return Response(ConversationSerializer(conversation, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def messages(self, request, pk=None):
        conversation = self.get_object()
        messages = conversation.messages.filter(folder="SENT").order_by("sent_at")
        return Response(MessageSerializer(messages, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        """Reuses the EXISTING send_message_now() exactly, including
        its client_message_id-based offline-safe retry handling — the
        API layer never duplicates that logic."""
        from .services import send_message_now
        conversation = self.get_object()
        text = request.data.get("text", "")
        client_message_id = request.data.get("client_message_id")
        message = send_message_now(conversation=conversation, sender=request.user, text=text, client_message_id=client_message_id)
        return Response(MessageSerializer(message, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def mark_seen(self, request, pk=None):
        """Marks every message in this conversation NOT sent by the
        requester as seen — reuses the existing mark_message_seen()
        per-message, rather than a bulk update that bypasses its logic."""
        from .services import mark_message_seen
        conversation = self.get_object()
        unseen_messages = conversation.messages.filter(folder="SENT").exclude(sender=request.user).filter(
            receipts__recipient=request.user, receipts__seen_at__isnull=True,
        )
        for message in unseen_messages:
            mark_message_seen(message=message, recipient=request.user)
        return Response({"marked_seen": unseen_messages.count()})
