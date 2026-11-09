from oaziland.admin_base import register

from .models import DriverProfile, MarketplaceListingBase, MarketplaceOrder

register(MarketplaceOrder, read_only=True, list_display=("id", "listing__title", "buyer", "amount_xaf", "status", "created_at"),
         list_filter=("status",), search_fields=("id", "buyer__username", "listing__title"))
# removed_by_moderation is set and cleared by the console's takedown / restore, which also tells the seller.
register(MarketplaceListingBase, list_display=("title", "lister_user", "price_basis", "price_xaf", "availability_status", "removed_by_moderation", "created_at"),
         list_filter=("availability_status", "removed_by_moderation", "price_basis"), search_fields=("title", "lister_user__username"),
         readonly_fields=("removed_by_moderation",))
register(DriverProfile, list_display=("user", "is_verified", "is_online", "last_seen_at", "created_at"), list_filter=("is_verified", "is_online"),
         search_fields=("user__username", "user__phone"), masked_fields=("license_number",),
         readonly_fields=("is_verified", "is_online", "last_latitude", "last_longitude", "last_seen_at"))
