"""
social.serializers — connected-social-accounts, and the real
messaging API (closing a genuine gap: send_message_now(),
mark_message_seen(), get_message_tick_status(), save_draft(), and
schedule_message() all existed and were tested, but nothing exposed
any of them over HTTP — no real inbox was possible).
"""
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from .models import SocialAccountLink, Conversation, Message, Post, Comment, PostMedia, Rating, Review, Referral
from .services import get_message_tick_status, get_presence_info


class SocialAccountLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = SocialAccountLink
        fields = ["id", "platform", "handle_or_url", "added_at"]
        read_only_fields = ["added_at"]


class MessageSerializer(serializers.ModelSerializer):
    tick_status = serializers.SerializerMethodField()
    sender_name = serializers.CharField(source="sender.full_name", read_only=True)

    class Meta:
        model = Message
        fields = ["id", "conversation", "sender", "sender_name", "text", "folder", "sent_at", "created_at", "tick_status"]
        read_only_fields = ["sender", "folder", "sent_at", "created_at"]

    def get_tick_status(self, message) -> dict:
        return get_message_tick_status(message)


class ConversationSerializer(serializers.ModelSerializer):
    participant_usernames = serializers.SerializerMethodField()
    participants_details = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ["id", "participant_usernames", "participants_details", "last_message", "unread_count", "created_at"]

    def get_participant_usernames(self, conversation) -> list[str]:
        request = self.context.get("request")
        others = conversation.participants.all()
        if request:
            others = others.exclude(id=request.user.id)
        return [u.full_name or u.username for u in others]

    def get_participants_details(self, conversation) -> list[dict]:
        from .models import UserPresence
        request = self.context.get("request")
        others = list(conversation.participants.all())
        if request:
            others = [u for u in others if u.id != request.user.id]
        presences = {p.user_id: p for p in UserPresence.objects.filter(user__in=others)}
        blocked_ids = set()
        if request:
            from engagement.models import BlockRelationship
            blocked_ids = set(BlockRelationship.objects.filter(blocker=request.user).values_list("blocked_id", flat=True))
        return [
            {
                "id": str(u.id),
                "username": u.username,
                "full_name": u.full_name or u.username,
                "profile_image_url": getattr(u, "profile_image_url", None),
                "is_blocked": u.id in blocked_ids,
                **get_presence_info(presences.get(u.id)),
            }
            for u in others
        ]

    @extend_schema_field(MessageSerializer(allow_null=True))
    def get_last_message(self, conversation):
        last = conversation.messages.filter(folder="SENT").order_by("-sent_at").first()
        return MessageSerializer(last, context=self.context).data if last else None

    def get_unread_count(self, conversation) -> int:
        request = self.context.get("request")
        if not request:
            return 0
        return conversation.messages.filter(folder="SENT").exclude(sender=request.user).filter(
            receipts__recipient=request.user, receipts__seen_at__isnull=True,
        ).count()


MAX_CAPTION_LENGTH = 2200
MAX_COMMENT_LENGTH = 1000
MAX_POST_MEDIA = 10
MAX_POST_TAGS = 20


def _display_name(user) -> str:
    # A blank full_name must never render as an anonymous, nameless author.
    return user.full_name or user.username


def _is_own(serializer, author_id) -> bool:
    request = serializer.context.get("request")
    return bool(request and request.user.is_authenticated and request.user.id == author_id)


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    text = serializers.CharField(max_length=MAX_COMMENT_LENGTH)

    class Meta:
        model = Comment
        fields = ["id", "post", "author", "author_name", "is_mine", "text", "created_at", "edited_at"]
        read_only_fields = ["author", "created_at", "edited_at"]

    def get_author_name(self, comment) -> str:
        return _display_name(comment.author)

    def get_is_mine(self, comment) -> bool:
        return _is_own(self, comment.author_id)

    def validate_text(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("A comment can't be empty.")
        return value


class PostMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = PostMedia
        fields = ["id", "media_type", "file_url"]


class PostSerializer(serializers.ModelSerializer):
    """WHY tags/media_urls are write-only inputs distinct from the
    read-side tag_names/media fields: creating a post takes plain
    strings (tag names, media URLs); reading one back should show the
    real tag names and PostMedia rows actually created."""
    author_name = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    my_reaction = serializers.SerializerMethodField()
    is_verified_creator = serializers.SerializerMethodField()
    poster_role = serializers.CharField(source="attribution.poster_role", read_only=True)
    tag_names = serializers.SerializerMethodField()
    media = PostMediaSerializer(many=True, read_only=True)
    reaction_counts = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    is_sponsored = serializers.BooleanField(read_only=True)

    tags = serializers.ListField(
        child=serializers.CharField(max_length=50), write_only=True, required=False, max_length=MAX_POST_TAGS,
    )
    media_urls = serializers.ListField(
        child=serializers.URLField(), write_only=True, required=False, max_length=MAX_POST_MEDIA,
    )

    class Meta:
        model = Post
        fields = [
            "id", "author", "author_name", "is_mine", "my_reaction", "is_verified_creator", "poster_role", "post_type",
            "caption", "tag_names", "tags", "media", "media_urls", "linked_listing_id", "status",
            "published_at", "created_at", "reaction_counts", "comment_count", "is_sponsored",
        ]
        read_only_fields = ["author", "status", "published_at", "created_at"]

    def validate_caption(self, value):
        if len(value) > MAX_CAPTION_LENGTH:
            raise serializers.ValidationError(f"A caption can be at most {MAX_CAPTION_LENGTH} characters.")
        return value

    def validate(self, attrs):
        # Only enforced on create; a post with neither text nor media is an empty card in everyone's feed.
        if self.instance is None and not attrs.get("caption", "").strip() and not attrs.get("media_urls"):
            raise serializers.ValidationError({"caption": "A post needs a caption or at least one photo or video."})
        if attrs.get("post_type") == "REEL":
            from .services import has_video_url
            if not has_video_url(attrs.get("media_urls") or []):
                raise serializers.ValidationError({"media_urls": "A video post needs a video file."})
        return attrs

    def get_author_name(self, post) -> str:
        return _display_name(post.author)

    def get_is_mine(self, post) -> bool:
        return _is_own(self, post.author_id)

    def get_my_reaction(self, post) -> str | None:
        request = self.context.get("request")
        if not (request and request.user.is_authenticated):
            return None
        reaction = next((r for r in post.reactions.all() if r.author_id == request.user.id), None)
        return reaction.emoji if reaction else None

    def get_is_verified_creator(self, post) -> bool:
        from monetization.services import is_premium_creator
        return is_premium_creator(post.author)

    def get_tag_names(self, post) -> list[str]:
        return [tag.name for tag in post.tags.all()]

    def get_reaction_counts(self, post) -> dict:
        # post.reactions is prefetched by the feed views; reading it avoids one COUNT query per card.
        counts: dict[str, int] = {}
        for reaction in post.reactions.all():
            counts[reaction.emoji] = counts.get(reaction.emoji, 0) + 1
        return counts

    def get_comment_count(self, post) -> int:
        return post.comments.count()


class ReelSerializer(PostSerializer):
    """A post as one full-screen video card: everything PostSerializer gives, plus the
    counters, the viewer's follow/save state, and a small preview of the linked listing
    so the card can show price + place and link straight to the description page."""
    author_username = serializers.CharField(source="author.username", read_only=True)
    author_avatar = serializers.SerializerMethodField()
    is_following_author = serializers.SerializerMethodField()
    is_saved = serializers.SerializerMethodField()
    share_count = serializers.SerializerMethodField()
    listing_preview = serializers.SerializerMethodField()

    class Meta(PostSerializer.Meta):
        fields = PostSerializer.Meta.fields + [
            "author_username", "author_avatar", "is_following_author", "is_saved", "share_count",
            "view_count", "listing_preview",
        ]
        read_only_fields = PostSerializer.Meta.read_only_fields + ["view_count"]

    def _viewer(self):
        request = self.context.get("request")
        return request.user if request and request.user.is_authenticated else None

    def get_author_avatar(self, post) -> str | None:
        return getattr(post.author, "profile_image_url", None) or None

    def get_is_following_author(self, post) -> bool:
        viewer = self._viewer()
        if viewer is None or viewer.id == post.author_id:
            return False
        from .models import Follow
        return Follow.objects.filter(follower=viewer, followee_id=post.author_id).exists()

    def get_is_saved(self, post) -> bool:
        viewer = self._viewer()
        if viewer is None:
            return False
        from .models import Favorite
        return Favorite.objects.filter(user=viewer, post=post).exists()

    def get_share_count(self, post) -> int:
        from .models import ShareEvent
        return ShareEvent.objects.filter(post=post).count()

    def get_listing_preview(self, post) -> dict | None:
        if not post.linked_listing_id:
            return None
        from property.models import Listing, ListingStatus
        listing = (
            Listing.objects.select_related("property_asset__quarter")
            .filter(id=post.linked_listing_id).first()
        )
        if listing is None:
            return None
        cover = listing.photos.filter(media_type="PHOTO").first()
        return {
            "id": str(listing.id),
            "listing_type": listing.listing_type,
            "property_type": listing.property_asset.type,
            "price_xaf": str(listing.price_xaf),
            "quarter": listing.property_asset.quarter.name,
            "cover_url": cover.url if cover else None,
            "is_available": listing.status == ListingStatus.PUBLISHED,
        }


class RatingSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = Rating
        fields = ["id", "author", "author_name", "subject_user", "subject_property_id", "score", "created_at"]
        read_only_fields = ["author", "created_at"]


class ReviewSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = Review
        fields = ["id", "author", "author_name", "booking", "score", "text", "created_at", "edited_at"]
        read_only_fields = ["author", "created_at", "edited_at"]


class ReferralItemSerializer(serializers.ModelSerializer):
    referred_user_name = serializers.CharField(source="referred_user.full_name", read_only=True)
    referred_username = serializers.CharField(source="referred_user.username", read_only=True)

    class Meta:
        model = Referral
        fields = [
            "id",
            "referred_user",
            "referred_user_name",
            "referred_username",
            "status",
            "reward_earned_xaf",
            "created_at",
        ]
        read_only_fields = fields
