from oaziland.admin_base import register

from .models import AccountDeletionRequest, ContactMessage, Faq, SupportTicket, VerificationRequest

# Decisions on these are made in the console (verification queue, privacy requests), which notifies the person.
register(VerificationRequest, read_only=True, list_display=("requester", "request_type", "status", "submitted_at", "reviewed_by", "reviewed_at"),
         list_filter=("status", "request_type"), search_fields=("requester__username",), hidden_fields=("supporting_document_url",),
         ordering=("-submitted_at",))
register(AccountDeletionRequest, read_only=True, list_display=("user", "status", "requested_at", "retention_expires_at", "completed_at", "cancelled_at"),
         list_filter=("status",), search_fields=("user__username",), ordering=("-requested_at",))
register(SupportTicket, list_display=("subject", "submitted_by", "status", "assigned_to", "ai_handled", "created_at"),
         list_filter=("status", "ai_handled"), search_fields=("subject", "submitted_by__username"))
register(ContactMessage, list_display=("name", "email", "resolved", "created_at"), list_filter=("resolved",), search_fields=("name", "email", "message"))
register(Faq, list_display=("question_en", "display_order", "is_published", "show_on_homepage"),
         list_filter=("is_published", "show_on_homepage"), search_fields=("question_en", "question_fr"), ordering=("display_order",), allow_delete=True)
