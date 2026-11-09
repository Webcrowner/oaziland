from oaziland.admin_base import register

from .models import (
    HostelManagementContract, HostelReview, HostelUnit, ManagerProfile, OwnerProfile, PartnerInstitution, RoomAllocation,
    Semester, StudentHostel,
)

register(OwnerProfile, list_display=("account_user", "owner_type", "organization_name"), list_filter=("owner_type",),
         search_fields=("account_user__username", "organization_name"))
register(ManagerProfile, list_display=("account_user", "manager_type", "agency"), list_filter=("manager_type",),
         search_fields=("account_user__username",))
register(PartnerInstitution, list_display=("name",), search_fields=("name",))
register(StudentHostel, list_display=("id", "owner", "quarter", "property_type", "deleted_at", "created_at"),
         list_filter=("property_type",), search_fields=("owner__username", "quarter__name"), readonly_fields=("deleted_at",))
register(HostelManagementContract, list_display=("hostel", "manager__account_user__username", "scope", "start_date", "end_date", "revoked_at"),
         list_filter=("scope",), search_fields=("manager__account_user__username",))
register(Semester, list_display=("name", "institution", "start_date", "end_date", "billing_due_date"), search_fields=("name", "institution__name"))
register(HostelUnit, list_display=("room_code", "building", "unit_type", "occupancy_model", "bed_capacity"),
         list_filter=("unit_type", "occupancy_model"), search_fields=("room_code",))
# Allocations change through Hostel rooms (owner page / console tab), which also runs the waitlist and notifies students.
register(RoomAllocation, read_only=True, list_display=("student", "unit", "semester__name", "status", "allocated_at", "ended_at"),
         list_filter=("status",), search_fields=("student__username", "unit__room_code"), ordering=("-allocated_at",))
register(HostelReview, list_display=("hostel", "reviewer", "unit_type", "score", "created_at"), search_fields=("reviewer__username", "text"))
