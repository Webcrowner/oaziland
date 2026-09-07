"""
social.serializers — connected-social-accounts, and the real
messaging API (closing a genuine gap: send_message_now(),
mark_message_seen(), get_message_tick_status(), save_draft(), and
schedule_message() all existed and were tested, but nothing exposed
any of them over HTTP — no real inbox was possible).
"""
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from .models import SocialAccountLink, Conversation, Message, Post, Comment, PostMedia, Rating, Review
from .services import get_message_tick_status, get_post_reaction_counts


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
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ["id", "participant_usernames", "last_message", "unread_count", "created_at"]

    def get_participant_usernames(self, conversation) -> list[str]:
        request = self.context.get("request")
        others = conversation.participants.all()
        if request:
            others = others.exclude(id=request.user.id)
        return [u.full_name or u.username for u in others]

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


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = Comment
        fields = ["id", "post", "author", "author_name", "text", "created_at", "edited_at"]
        read_only_fields = ["author", "created_at", "edited_at"]


class PostMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = PostMedia
        fields = ["id", "media_type", "file_url"]


class PostSerializer(serializers.ModelSerializer):
    """WHY tags/media_urls are write-only inputs distinct from the
    read-side tag_names/media fields: creating a post takes plain
    strings (tag names, media URLs); reading one back should show the
    real tag names and PostMedia rows actually created."""
    author_name = serializers.CharField(source="author.full_name", read_only=True)
    is_verified_creator = serializers.SerializerMethodField()
    poster_role = serializers.CharField(source="attribution.poster_role", read_only=True)
    tag_names = serializers.SerializerMethodField()
    media = PostMediaSerializer(many=True, read_only=True)
    reaction_counts = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    is_sponsored = serializers.BooleanField(read_only=True)

    tags = serializers.ListField(child=serializers.CharField(), write_only=True, required=False)
    media_urls = serializers.ListField(child=serializers.URLField(), write_only=True, required=False)

    class Meta:
        model = Post
        fields = [
            "id", "author", "author_name", "is_verified_creator", "poster_role", "post_type", "caption",
            "tag_names", "tags", "media", "media_urls", "linked_listing_id", "status",
            "published_at", "created_at", "reaction_counts", "comment_count", "is_sponsored",
        ]
        read_only_fields = ["author", "status", "published_at", "created_at"]

    def get_is_verified_creator(self, post) -> bool:
        from monetization.services import is_premium_creator
        return is_premium_creator(post.author)

    def get_tag_names(self, post) -> list[str]:
        return [tag.name for tag in post.tags.all()]

    def get_reaction_counts(self, post) -> dict:
        return get_post_reaction_counts(post)

    def get_comment_count(self, post) -> int:
        return post.comments.count()


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
