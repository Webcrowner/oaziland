from rest_framework import serializers

from .models import Faq, SupportTicket, SupportMessage, ContactMessage


class AdminSupportMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()

    class Meta:
        model = SupportMessage
        fields = ["id", "sender_type", "sender_name", "text", "sent_at"]
        read_only_fields = fields

    def get_sender_name(self, obj) -> str:
        return (obj.sender_user.full_name or obj.sender_user.username) if obj.sender_user else ""


class AdminSupportTicketSerializer(serializers.ModelSerializer):
    """One support conversation as the admin inbox shows it: who is asking, how it stands and
    what was said last. `messages` is only included on the single-ticket view."""
    user = serializers.SerializerMethodField()
    message_count = serializers.IntegerField(read_only=True)
    last_message_at = serializers.DateTimeField(read_only=True)
    last_sender = serializers.CharField(read_only=True, allow_null=True)
    last_message_preview = serializers.SerializerMethodField()
    awaiting_admin = serializers.SerializerMethodField()
    assigned_to_name = serializers.SerializerMethodField()
    messages = serializers.SerializerMethodField()

    class Meta:
        model = SupportTicket
        fields = [
            "id", "subject", "status", "ai_handled", "created_at", "resolved_at", "user",
            "message_count", "last_message_at", "last_sender", "last_message_preview",
            "awaiting_admin", "assigned_to_name", "messages",
        ]
        read_only_fields = fields

    def get_user(self, obj):
        user = obj.submitted_by
        return {
            "id": str(user.id), "username": user.username, "name": user.full_name or user.username,
            "phone": user.phone or "", "email": user.email or "",
        }

    def get_last_message_preview(self, obj) -> str:
        text = getattr(obj, "last_text", "") or ""
        return text[:160]

    def get_awaiting_admin(self, obj) -> bool:
        return (
            not obj.ai_handled
            and obj.status in ("OPEN", "IN_PROGRESS")
            and getattr(obj, "last_sender", None) != SupportMessage.SenderType.HUMAN_AGENT
        )

    def get_assigned_to_name(self, obj) -> str:
        return (obj.assigned_to.full_name or obj.assigned_to.username) if obj.assigned_to else ""

    def get_messages(self, obj):
        if not self.context.get("include_messages"):
            return None
        return AdminSupportMessageSerializer(obj.messages.select_related("sender_user"), many=True).data


class AdminContactMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactMessage
        fields = ["id", "name", "email", "message", "resolved", "created_at"]
        read_only_fields = fields


class PublicFaqSerializer(serializers.ModelSerializer):
    """Question/answer in the requested language, falling back to English when French is blank."""
    question = serializers.SerializerMethodField()
    answer = serializers.SerializerMethodField()

    class Meta:
        model = Faq
        fields = ["id", "question", "answer"]

    def _pick(self, obj, field: str) -> str:
        if self.context.get("lang") == "fr":
            return getattr(obj, f"{field}_fr") or getattr(obj, f"{field}_en")
        return getattr(obj, f"{field}_en")

    def get_question(self, obj) -> str:
        return self._pick(obj, "question")

    def get_answer(self, obj) -> str:
        return self._pick(obj, "answer")


class AdminFaqSerializer(serializers.ModelSerializer):
    class Meta:
        model = Faq
        fields = [
            "id", "question_en", "answer_en", "question_fr", "answer_fr",
            "display_order", "is_published", "show_on_homepage", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {"display_order": {"required": False}}

    def create(self, validated_data):
        if "display_order" not in validated_data:
            last = Faq.objects.order_by("-display_order").first()
            validated_data["display_order"] = (last.display_order + 1) if last else 0
        return super().create(validated_data)
