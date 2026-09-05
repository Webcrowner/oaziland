"""
social.serializers — connected-social-accounts, and the real
messaging API (closing a genuine gap: send_message_now(),
mark_message_seen(), get_message_tick_status(), save_draft(), and
schedule_message() all existed and were tested, but nothing exposed
any of them over HTTP — no real inbox was possible).
"""
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from .models import SocialAccountLink, Conversation, Message
from .services import get_message_tick_status


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
