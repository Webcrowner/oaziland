from oaziland.admin_base import register

from .models import ServiceRequest, ServiceReview

register(ServiceReview, list_display=("service_request_id", "author", "subject", "subject_is_requester", "score", "created_at"),
         list_filter=("subject_is_requester",), search_fields=("author__username", "subject__username", "comment"))
# Jobs hold money: view-only here (disputed jobs can be found by status and their dispute reason read).
register(ServiceRequest, read_only=True, list_display=("id", "category", "status", "requester", "technician", "quoted_amount_xaf", "requested_at"),
         list_filter=("status", "category"), search_fields=("id", "requester__username", "technician__username"), ordering=("-requested_at",))
