from oaziland.admin_base import register

from .models import AIModerationResult, AuditLog, ContentReport, ContentTakedown, UserWarning

# Moderation history is view-only: reports are resolved, strikes issued and content removed in the console.
register(AuditLog, read_only=True, list_display=("created_at", "actor_username", "action", "target_label", "status_code", "ip_address"),
         list_filter=("action", "status_code"), search_fields=("actor_username", "target_label", "target_id", "action"))
register(ContentReport, read_only=True, list_display=("created_at", "reason", "status", "reported_by", "target_kind", "target_user"),
         list_filter=("status", "reason", "target_kind"), search_fields=("reported_by__username", "target_user__username", "target_object_id", "notes"))
register(UserWarning, read_only=True, list_display=("subject", "strike_number", "reason", "issued_by", "acknowledged", "issued_at"),
         list_filter=("reason", "acknowledged"), search_fields=("subject__username",), ordering=("-issued_at",))
register(ContentTakedown, read_only=True, list_display=("content_type", "title", "owner", "removed_by", "removed_at", "restored_at"),
         list_filter=("content_type",), search_fields=("title", "owner__username", "reason"), ordering=("-removed_at",))
register(AIModerationResult, read_only=True, list_display=("scored_at", "category", "confidence_score", "action", "review_outcome", "reviewed_at"),
         list_filter=("category", "action", "review_outcome"), ordering=("-scored_at",))
