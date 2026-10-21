from django.contrib import admin

from .models import ServiceRequest, ServiceReview


@admin.register(ServiceReview)
class ServiceReviewAdmin(admin.ModelAdmin):
    list_display = ("service_request", "author", "subject", "subject_is_requester", "score", "created_at")
    list_filter = ("subject_is_requester",)
    search_fields = ("author__username", "subject__username", "comment")


@admin.register(ServiceRequest)
class ServiceRequestAdmin(admin.ModelAdmin):
    # Disputed jobs are reviewed here: filter by status, read dispute_reason.
    list_display = ("id", "category", "status", "requester", "technician", "quoted_amount_xaf", "requested_at")
    list_filter = ("status", "category")
    search_fields = ("id", "requester__username", "technician__username")
    readonly_fields = ("requested_at", "accepted_at", "en_route_at", "started_at", "completed_at")
