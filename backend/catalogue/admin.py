from oaziland.admin_base import register

from .models import Amenity, AmenityCategory, PartnerServiceCategory, PartnerServiceOffering

register(AmenityCategory, list_display=("name",), search_fields=("name",), allow_delete=True)
register(Amenity, list_display=("name", "category", "price_xaf", "billing_type", "is_active"), list_filter=("category", "is_active", "billing_type"),
         search_fields=("name",))
register(PartnerServiceCategory, list_display=("name",), search_fields=("name",), allow_delete=True)
register(PartnerServiceOffering, list_display=("name", "category", "price_hint_xaf", "is_active"), list_filter=("category", "is_active"),
         search_fields=("name",))
