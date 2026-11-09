from oaziland.admin_base import register

from .models import GuestHouseLodge, Listing, PropertyAsset

OWNER_SEARCH = ("owner__username", "owner__phone", "quarter__name", "description")
# deleted_at is set when a report against the place is confirmed; restoring goes through the console.
register(PropertyAsset, list_display=("id", "type", "owner", "quarter", "deleted_at", "created_at"), list_filter=("type",),
         search_fields=OWNER_SEARCH, readonly_fields=("deleted_at",))
register(GuestHouseLodge, list_display=("id", "owner", "quarter", "is_coastal_leisure", "deleted_at", "created_at"),
         search_fields=OWNER_SEARCH, readonly_fields=("deleted_at",))
# status is changed through the console (publish, take down, restore) so the owner is told and a takedown is recorded.
register(Listing, list_display=("id", "property_asset", "listed_by", "listing_type", "status", "price_xaf", "created_at"),
         list_filter=("status", "listing_type"), search_fields=("id", "listed_by__username", "property_asset__quarter__name"),
         readonly_fields=("status", "published_at"))
