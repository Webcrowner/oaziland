from django.contrib import admin
from .models import KYCProfile


@admin.register(KYCProfile)
class KYCProfileAdmin(admin.ModelAdmin):
    """Fallback review path — the real review queue is the Admin
    Console's own KYC Review tab (AdminKYCReviewViewSet), but a raw
    Django admin registration is a cheap, useful safety net for support
    staff who need direct access."""
    list_display = ["user", "legal_full_name", "kyc_status", "submitted_at", "reviewed_at"]
    list_filter = ["kyc_status"]
    search_fields = ["user__username", "user__phone", "legal_full_name", "national_id_number"]
    readonly_fields = ["submitted_at"]
