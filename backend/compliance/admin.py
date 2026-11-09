from oaziland.admin_base import register

from .models import ConsentRecord, DataExportRequest, PolicyDocument

register(PolicyDocument, list_display=("document_type", "version", "is_current", "published_at"), list_filter=("document_type", "is_current"))
# Consent history and data exports are evidence of what a person agreed to and received: view-only, and the
# export file itself is never offered here.
register(ConsentRecord, read_only=True, list_display=("user", "consent_type", "version", "granted_at", "revoked_at"),
         list_filter=("consent_type",), search_fields=("user__username",), ordering=("-granted_at",))
register(DataExportRequest, read_only=True, list_display=("user", "status", "requested_at", "completed_at", "expires_at", "downloaded_at"),
         list_filter=("status",), search_fields=("user__username",), hidden_fields=("export_file",), ordering=("-requested_at",))
