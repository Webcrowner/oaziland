from oaziland.admin_base import register

from .models import JobPosting

register(JobPosting, list_display=("title", "posted_by", "role_category", "status", "posted_at", "closes_at"),
         list_filter=("status", "role_category"), search_fields=("title", "posted_by__username"), ordering=("-posted_at",))
