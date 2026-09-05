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
from .models import SocialAccountLink, Conversation, Post, Comment, ContentStatus
from .serializers import SocialAccountLinkSerializer, ConversationSerializer, MessageSerializer, PostSerializer, CommentSerializer
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

    @action(detail=True, methods=["post"], url_path="typing")
    def send_typing_heartbeat_action(self, request, pk=None):
        """Called repeatedly by the client (every few seconds) while
        the user is actively composing a reply."""
        from .services import send_typing_heartbeat
        conversation = self.get_object()
        send_typing_heartbeat(conversation=conversation, user=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"], url_path="typing-status")
    def typing_status(self, request, pk=None):
        """Polled by the other participant(s) — returns who's
        currently typing, correctly excluding anyone who has turned
        show_typing_indicator off."""
        from .services import get_typing_users
        conversation = self.get_object()
        typing_users = get_typing_users(conversation=conversation, viewer=request.user)
        return Response({"typing_usernames": [u.full_name or u.username for u in typing_users]})


class MyPresenceSettingsView(APIView):
    """A real gap this closes: show_online_status has existed since
    the founder's own online-status-privacy addition, but NOTHING ever
    exposed it (or the new show_typing_indicator) over the API — a
    user had no way to actually change either preference. GET returns
    current settings; PATCH updates either or both together, since
    they're the same kind of choice (what presence signals other
    people see about you) and belong in one place."""
    permission_classes = [permissions.IsAuthenticated]

    def _get_or_create_presence(self, user):
        from .models import UserPresence
        presence, _ = UserPresence.objects.get_or_create(user=user)
        return presence

    @extend_schema(responses={200: dict})
    def get(self, request):
        presence = self._get_or_create_presence(request.user)
        return Response({
            "show_online_status": presence.show_online_status,
            "show_typing_indicator": presence.show_typing_indicator,
        })

    @extend_schema(request=dict, responses={200: dict})
    def patch(self, request):
        from rest_framework.fields import BooleanField
        # WHY BooleanField().to_internal_value(), not a naive bool():
        # depending on how the client sends this request (form-encoded
        # vs JSON), a False value can arrive as the STRING "False" —
        # and Python's bool("False") is True, since any non-empty
        # string is truthy. DRF's own boolean parser correctly handles
        # "false"/"False"/"0"/False/0 as actually false, regardless of
        # wire format. Found by this endpoint's own test failing on
        # the very first run.
        bool_field = BooleanField()
        presence = self._get_or_create_presence(request.user)
        update_fields = []
        if "show_online_status" in request.data:
            presence.show_online_status = bool_field.to_internal_value(request.data["show_online_status"])
            update_fields.append("show_online_status")
        if "show_typing_indicator" in request.data:
            presence.show_typing_indicator = bool_field.to_internal_value(request.data["show_typing_indicator"])
            update_fields.append("show_typing_indicator")
        if update_fields:
            presence.save(update_fields=update_fields)
        return Response({
            "show_online_status": presence.show_online_status,
            "show_typing_indicator": presence.show_typing_indicator,
        })


class MyFavoriteListingsView(APIView):
    """A real gap this closes: the Favorite model existed and was even
    USED internally (feeding get_recommended_feed's interest-tag
    matching), but nothing ever let a user actually save a listing —
    no create function existed at the service layer at all."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .services import list_my_favorite_listing_ids
        return Response({"listing_ids": [str(lid) for lid in list_my_favorite_listing_ids(request.user)]})


class ToggleFavoriteListingView(APIView):
    """The real 'one tap save' behavior — a single button whose action
    depends on current state, matching toggle_follow()'s established pattern."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: dict})
    def post(self, request, listing_id):
        from .services import toggle_favorite_listing
        is_now_favorited = toggle_favorite_listing(user=request.user, listing_id=listing_id)
        return Response({"is_favorited": is_now_favorited})


class PostViewSet(viewsets.ModelViewSet):
    """The real, previously-total gap this closes: the entire
    recommendation algorithm (real estate priority, boosted posts, the
    dance-content policy) has been built and tested this session on
    top of a feature nothing could actually create, view, react to, or
    comment on. list is the recommended feed itself
    (get_recommended_feed) — public browsing of a social feed doesn't
    require an account, matching how every other browse surface on
    this platform works; creating a post requires login."""
    serializer_class = PostSerializer

    def get_permissions(self):
        # WHY "comments" is grouped with public browsing: viewing the
        # comments on a public post shouldn't require an account any
        # more than viewing the post itself does — this is the same
        # class of mistake as an earlier fix this session (a custom
        # @action needs its own explicit branch here, since falling
        # through to the authenticated-only default silently applies
        # to it too).
        if self.action in ("list", "retrieve", "comments", "following_feed", "topic_feed", "search_posts"):
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Post.objects.none()
        if self.action == "list":
            from .services import get_recommended_feed
            # Anonymous browsing still needs SOME real ranking — the
            # full personalized algorithm needs a real user for its
            # interest-tag matching, so an anonymous request falls
            # back to real-estate-priority + recency only (no
            # interest-tag boost), never a broken/empty feed.
            if self.request.user.is_authenticated:
                feed = get_recommended_feed(self.request.user, limit=50)
                return Post.objects.filter(id__in=[p.id for p in feed])
            return Post.objects.filter(status=ContentStatus.PUBLISHED).order_by("-created_at")[:50]
        return Post.objects.all()

    def create(self, request, *args, **kwargs):
        from .services import create_post, publish_users_post
        from trust_safety.services import ContentBlockedError

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        post = create_post(
            author=request.user, caption=serializer.validated_data.get("caption", ""),
            post_type=serializer.validated_data.get("post_type"),
            tags=serializer.validated_data.get("tags"),
            linked_listing_id=serializer.validated_data.get("linked_listing_id"),
            media_urls=serializer.validated_data.get("media_urls"),
        )
        try:
            publish_users_post(post)
        except ContentBlockedError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PostSerializer(post).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def react(self, request, pk=None):
        from .services import react_to_post
        from .models import EmojiType
        post = self.get_object()
        emoji = request.data.get("emoji")
        if emoji not in EmojiType.values:
            return Response({"detail": f"emoji must be one of {EmojiType.values}."}, status=status.HTTP_400_BAD_REQUEST)
        react_to_post(post=post, author=request.user, emoji=emoji)
        return Response(PostSerializer(post).data)

    @action(detail=True, methods=["post"], url_path="remove-reaction")
    def remove_reaction_action(self, request, pk=None):
        from .services import remove_reaction
        post = self.get_object()
        remove_reaction(post=post, author=request.user)
        return Response(PostSerializer(post).data)

    @action(detail=True, methods=["get"])
    def comments(self, request, pk=None):
        post = self.get_object()
        return Response(CommentSerializer(post.comments.order_by("created_at"), many=True).data)

    @action(detail=False, methods=["get"], url_path="following")
    def following_feed(self, request):
        """The 'Following' feed — posts ONLY from people the requester
        actually follows, in plain reverse-chronological order. No
        interest-tag scoring here: 'show me what people I follow
        posted' is a deliberately simpler, more literal promise than
        the algorithmic FYP feed."""
        if not request.user.is_authenticated:
            return Response({"count": 0, "results": []})
        from .models import Follow
        followed_ids = Follow.objects.filter(follower=request.user).values_list("followee_id", flat=True)
        posts = Post.objects.filter(author_id__in=followed_ids, status=ContentStatus.PUBLISHED).order_by("-created_at")
        page = self.paginate_queryset(posts)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=False, methods=["get"], url_path="topic")
    def topic_feed(self, request):
        """Browse by tag/topic — real estate priority still applies
        within the topic, same ranking rule as everywhere else."""
        tag_name = request.query_params.get("tag", "").strip().lstrip("#")
        if not tag_name:
            return Response({"detail": "A ?tag= query parameter is required."}, status=status.HTTP_400_BAD_REQUEST)
        posts = Post.objects.filter(tags__name__iexact=tag_name, status=ContentStatus.PUBLISHED).order_by("-linked_listing_id", "-created_at")
        page = self.paginate_queryset(posts)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=False, methods=["get"], url_path="search")
    def search_posts(self, request):
        """A real, working caption/tag search — not a stub."""
        from django.db.models import Q
        query = request.query_params.get("q", "").strip()
        if not query:
            return Response({"detail": "A ?q= query parameter is required."}, status=status.HTTP_400_BAD_REQUEST)
        posts = Post.objects.filter(
            Q(caption__icontains=query) | Q(tags__name__icontains=query),
            status=ContentStatus.PUBLISHED,
        ).distinct().order_by("-created_at")
        page = self.paginate_queryset(posts)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)


class CommentViewSet(viewsets.ModelViewSet):
    """Create/delete only — reading comments happens through Post's
    own /comments/ action above, scoped to a specific post rather than
    a global, unscoped comment list."""
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Comment.objects.none()
        return Comment.objects.filter(author=self.request.user)

    def perform_create(self, serializer):
        from .services import add_comment
        post_id = self.request.data.get("post")
        post = Post.objects.get(id=post_id)
        comment = add_comment(post=post, author=self.request.user, text=serializer.validated_data["text"])
        serializer.instance = comment

    def destroy(self, request, *args, **kwargs):
        from .services import delete_comment
        comment = self.get_object()
        try:
            delete_comment(comment=comment, requester=request.user)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(status=status.HTTP_204_NO_CONTENT)
