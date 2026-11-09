from oaziland.admin_base import register

from .models import Hotel, Reservation, RoomType

register(Hotel, list_display=("name", "owner", "quarter", "star_rating", "verified", "deleted_at", "created_at"),
         list_filter=("verified", "star_rating"), search_fields=("name", "owner__username", "quarter__name"),
         readonly_fields=("verified", "deleted_at"))
register(RoomType, list_display=("hotel", "category", "capacity", "base_rate_xaf"), list_filter=("category",), search_fields=("hotel__name",))
register(Reservation, read_only=True, list_display=("id", "hotel", "guest", "check_in", "check_out", "rate_xaf", "status", "created_at"),
         list_filter=("status", "source"), search_fields=("id", "guest__username", "hotel__name"))
