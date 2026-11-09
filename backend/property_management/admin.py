from oaziland.admin_base import register

from .models import DisputeCase, Lease

register(DisputeCase, read_only=True, list_display=("id", "raised_by", "status", "created_at", "response_due_at", "resolved_at"),
         list_filter=("status",), search_fields=("id", "raised_by__username"))
register(Lease, read_only=True, list_display=("booking_id", "start_date", "end_date"))
