from django.utils import timezone

from oaziland.admin_base import OaziAdmin, register

from .models import (
    Amenity, AmenityCategory, PartnerServiceCategory, PartnerServiceOffering, PartnerServiceRequest, PartnerServiceRequestStatus,
)

register(AmenityCategory, list_display=("name",), search_fields=("name",), allow_delete=True)
register(Amenity, list_display=("name", "category", "price_xaf", "billing_type", "is_active"), list_filter=("category", "is_active", "billing_type"),
         search_fields=("name",))
register(PartnerServiceCategory, list_display=("name",), search_fields=("name",), allow_delete=True)
register(PartnerServiceOffering, list_display=("name", "category", "price_hint_xaf", "is_active"), list_filter=("category", "is_active"),
         search_fields=("name",))


def _save_partner_request(self, request, obj, form, change):
    """Only the status is editable here; completing a request stamps when it was done."""
    if obj.status == PartnerServiceRequestStatus.COMPLETED:
        obj.completed_at = obj.completed_at or timezone.now()
    else:
        obj.completed_at = None
    OaziAdmin.save_model(self, request, obj, form, change)


register(
    PartnerServiceRequest,
    list_display=("offering", "requester", "status", "requested_at", "completed_at"), list_filter=("status", "offering__category"),
    search_fields=("offering__name", "requester__username", "requester__phone"), ordering=("-requested_at",),
    readonly_fields=("requester", "offering", "notes"), save_model=_save_partner_request,
)
