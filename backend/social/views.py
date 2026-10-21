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
from rest_framework.throttling import UserRateThrottle
from drf_spectacular.utils import extend_schema
from .models import SocialAccountLink, Conversation, Post, Comment, ContentStatus, Rating, Review
from .serializers import SocialAccountLinkSerializer, ConversationSerializer, MessageSerializer, PostSerializer, CommentSerializer, RatingSerializer, ReviewSerializer
from .services import (
    link_social_account, create_or_update_rating, create_review, CannotRateSelfError, RatingNotEarnedError,
    ReviewRequiresCompletedBookingError, AlreadyReviewedError, is_following, is_mutual_follow,
    toggle_follow, get_follow_counts,
)


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


class ChatThrottle(UserRateThrottle):
    scope = "chat"


# Deliberately identical whichever side blocked, so a block never reveals itself.
BLOCKED_MESSAGE_DETAIL = "You can't message this user."


class ConversationViewSet(viewsets.ModelViewSet):
    """A real inbox — list/retrieve/create all scoped to conversations
    the requester is actually a participant in. WHY create looks for
    an EXISTING conversation with the same participant first: starting
    a new, empty conversation every time someone messages the same
    person again would fragment message history across many
    conversations instead of keeping one real thread."""
    serializer_class = ConversationSerializer
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ChatThrottle]

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

        from engagement.services import is_blocked_either_way
        from identity.models import User
        target = User.objects.filter(pk=participant_id).first()
        if target is not None and is_blocked_either_way(request.user, target):
            return Response({"detail": BLOCKED_MESSAGE_DETAIL}, status=status.HTTP_403_FORBIDDEN)

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
        from engagement.services import is_blocked_either_way
        conversation = self.get_object()
        for other in conversation.participants.exclude(id=request.user.id):
            if is_blocked_either_way(request.user, other):
                return Response({"detail": BLOCKED_MESSAGE_DETAIL}, status=status.HTTP_403_FORBIDDEN)
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


class PresenceThrottle(UserRateThrottle):
    scope = "presence"


class PresenceHeartbeatView(APIView):
    """Called by the signed-in web/mobile client every ~30s. This is the
    only thing that moves a user to ONLINE; last_seen_at (auto_now) is
    what makes 'last seen X ago' real."""
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [PresenceThrottle]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        from .services import record_heartbeat
        record_heartbeat(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PresenceOfflineView(APIView):
    """Explicit clean-exit signal (tab closed / logout); a crash still
    falls back to the heartbeat timeout."""
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [PresenceThrottle]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        from .services import set_explicitly_offline
        set_explicitly_offline(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyFavoriteListingsView(APIView):
    """A real gap this closes: the Favorite model existed and was even
    USED internally (feeding get_recommended_feed's interest-tag
    matching), but nothing ever let a user actually save a listing —
    no create function existed at the service layer at all."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .services import list_my_favorite_listing_ids
        from marketplace.services import marketplace_summaries_for_ids
        listing_ids = list_my_favorite_listing_ids(request.user)
        return Response({
            "listing_ids": [str(lid) for lid in listing_ids],
            "marketplace_listings": marketplace_summaries_for_ids(listing_ids),
        })


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
                from engagement.services import exclude_blocked_users
                feed = get_recommended_feed(self.request.user, limit=50)
                return exclude_blocked_users(Post.objects.filter(id__in=[p.id for p in feed]), self.request.user)
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


class RateUserView(APIView):
    """The real gap this closes: Rating had a real model, already
    consumed by agent/agency dashboard aggregation for
    average_rating/rating_count, but zero way for a real user to
    actually rate an agent, agency, landlord, or owner. Requires
    login: an anonymous rating is a real integrity problem for a
    number meant to reflect real people's real opinions."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=RatingSerializer, responses={201: RatingSerializer, 400: dict})
    def post(self, request):
        subject_user_id = request.data.get("subject_user")
        subject_property_id = request.data.get("subject_property_id")
        score = request.data.get("score")
        if not subject_user_id and not subject_property_id:
            return Response({"detail": "Either subject_user or subject_property_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        if score is None:
            return Response({"detail": "score is required."}, status=status.HTTP_400_BAD_REQUEST)

        subject_user = None
        if subject_user_id:
            from identity.models import User
            subject_user = User.objects.filter(id=subject_user_id).first()
            if subject_user is None:
                return Response({"detail": "That user was not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            rating = create_or_update_rating(author=request.user, score=score, subject_user=subject_user, subject_property_id=subject_property_id)
        except CannotRateSelfError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except RatingNotEarnedError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(RatingSerializer(rating).data, status=status.HTTP_201_CREATED)


class MyRatingsView(APIView):
    """The real gap this closes: average_rating/rating_count were
    aggregated and shown on public agent/agency profiles, but a plain
    user had no page of their own listing every rating they'd received
    or given — the numbers existed, the underlying list never did."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from django.db.models import Avg, Count
        received = Rating.objects.filter(subject_user=request.user).select_related("author").order_by("-created_at")
        given = Rating.objects.filter(author=request.user).order_by("-created_at")
        aggregate = received.aggregate(average=Avg("score"), count=Count("id"))
        return Response({
            "average_rating": aggregate["average"],
            "rating_count": aggregate["count"],
            "ratings_received": RatingSerializer(received, many=True).data,
            "ratings_given": RatingSerializer(given, many=True).data,
        })


class ReviewViewSet(viewsets.ModelViewSet):
    """The real gap this closes: Review had a real model — TestimonialsView
    already reads FROM it — but zero way for a real user to actually
    leave one. create/list/retrieve only; a review is left once for a
    real completed transaction, not something to freely rewrite via a
    generic update endpoint (edit() exists as its own real, permission-
    checked method on the model itself for the one legitimate case)."""
    serializer_class = ReviewSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Review.objects.none()
        return Review.objects.all().order_by("-created_at")

    def create(self, request, *args, **kwargs):
        from transactions.models import Booking
        booking_id = request.data.get("booking")
        booking = Booking.objects.filter(id=booking_id).first()
        if booking is None:
            return Response({"detail": "That booking was not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            review = create_review(author=request.user, booking=booking, score=request.data.get("score"), text=request.data.get("text", ""))
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except (ReviewRequiresCompletedBookingError, AlreadyReviewedError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        from engagement.services import evaluate_badges_for_user
        evaluate_badges_for_user(request.user)
        return Response(ReviewSerializer(review).data, status=status.HTTP_201_CREATED)


class FollowView(APIView):
    """The real gap this closes: follow_user/unfollow_user/toggle_follow/
    is_mutual_follow were fully built and unit-tested (UC13 in docs/01's
    use-case diagram), but nothing ever exposed any of it over HTTP — no
    real 'Follow' button was possible anywhere in the app."""
    permission_classes = [permissions.IsAuthenticated]

    def _status_payload(self, request, target_user):
        return {
            "is_following": is_following(follower=request.user, followee=target_user),
            "is_mutual": is_mutual_follow(user_a=request.user, user_b=target_user),
            **get_follow_counts(target_user),
        }

    @extend_schema(responses={200: dict, 404: dict})
    def get(self, request, user_id):
        from identity.models import User
        target_user = User.objects.filter(id=user_id).first()
        if target_user is None:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self._status_payload(request, target_user))

    @extend_schema(request=None, responses={200: dict, 400: dict, 404: dict})
    def post(self, request, user_id):
        from identity.models import User
        target_user = User.objects.filter(id=user_id).first()
        if target_user is None:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            toggle_follow(follower=request.user, followee=target_user)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self._status_payload(request, target_user))


class MyReferralsView(APIView):
    """Returns the list of referrals made by the authenticated user along with
    summary metrics (total referred, qualified, rewarded, and total rewards earned)."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .models import Referral, ReferralStatus
        from .serializers import ReferralItemSerializer
        from django.db.models import Sum

        referrals = Referral.objects.filter(referrer=request.user).select_related("referred_user").order_by("-created_at")
        total_count = referrals.count()
        qualified_count = referrals.filter(status__in=[ReferralStatus.QUALIFIED, ReferralStatus.REWARDED]).count()
        rewarded_count = referrals.filter(status=ReferralStatus.REWARDED).count()
        total_reward = referrals.aggregate(total=Sum("reward_earned_xaf"))["total"] or 0

        return Response({
            "total_count": total_count,
            "qualified_count": qualified_count,
            "rewarded_count": rewarded_count,
            "total_reward_xaf": total_reward,
            "results": ReferralItemSerializer(referrals, many=True).data,
        })
