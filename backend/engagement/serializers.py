from rest_framework import serializers

from .models import Faq


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
