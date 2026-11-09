from django.contrib import admin

from oaziland.admin_base import OaziAdmin, register

from .models import AdminProfile, AgencyProfile, AgentProfile, KYCProfile, LandlordProfile, StudentProfile, TechnicianProfile, User

USER_SEARCH = ("user__username", "user__phone", "user__first_name", "user__last_name")


@admin.register(User)
class UserAdmin(OaziAdmin):
    """Contact details can be corrected here. Roles, suspensions, verification and deletion go through the
    admin console, which notifies the person and records the reason."""
    list_display = ("username", "full_name", "phone", "email", "account_status", "verification_status", "date_joined")
    list_filter = ("account_status", "verification_status", "preferred_language", "is_staff")
    search_fields = ("username", "phone", "email", "first_name", "last_name")
    ordering = ("-date_joined",)
    hidden_fields = ("password", "groups", "user_permissions")
    readonly_fields = (
        "is_superuser", "is_staff", "is_active", "account_status", "suspended_until", "verification_status",
        "deleted_at", "last_login", "date_joined", "referral_code",
    )


@admin.register(KYCProfile)
class KYCProfileAdmin(OaziAdmin):
    """Look-up only. ID photos and the home address stay in the console's KYC review; the ID number is masked."""
    read_only = True
    list_display = ("user", "legal_full_name", "kyc_status", "submitted_at", "reviewed_at")
    list_filter = ("kyc_status",)
    search_fields = ("user__username", "user__phone", "legal_full_name", "national_id_number")
    hidden_fields = ("id_document_front_image_url", "id_document_back_image_url", "selfie_image_url", "residential_address")
    masked_fields = ("national_id_number",)


@admin.register(AdminProfile)
class AdminProfileAdmin(OaziAdmin):
    """Granting or removing the admin role is done in the console (Users tab), where it is checked and audited."""
    read_only = True
    list_display = ("user", "permissions")
    search_fields = USER_SEARCH


register(LandlordProfile, list_display=("user", "created_at"), search_fields=USER_SEARCH)
register(AgencyProfile, list_display=("user", "registration_number", "agency_commission_percent", "created_at"),
         search_fields=USER_SEARCH + ("registration_number",))
register(AgentProfile, list_display=("user", "agency", "agent_commission_percent", "created_at"), search_fields=USER_SEARCH)
register(StudentProfile, list_display=("user", "institution_name", "programme_year", "is_international_student", "has_accessibility_needs"),
         list_filter=("is_international_student", "has_accessibility_needs"), search_fields=USER_SEARCH + ("institution_name",))
register(TechnicianProfile, list_display=("user", "coverage_quarter", "is_verified", "avg_rating", "reviewed_at"),
         list_filter=("is_verified",), search_fields=USER_SEARCH,
         hidden_fields=("credential_urls",), readonly_fields=("is_verified", "reviewed_at", "rejection_reason", "avg_rating"))
