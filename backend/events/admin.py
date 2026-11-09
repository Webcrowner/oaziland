from oaziland.admin_base import register

from .models import Caterer, CatererReview, EventBooking, Venue, VenueReview

register(Venue, list_display=("id", "owner", "quarter", "verified", "deleted_at", "created_at"), list_filter=("verified",),
         search_fields=("owner__username", "quarter__name", "description"), readonly_fields=("verified", "deleted_at"))
register(Caterer, list_display=("name", "cuisine_type", "price_per_head_min_xaf", "price_per_head_max_xaf", "verified"),
         list_filter=("verified",), search_fields=("name", "cuisine_type"), readonly_fields=("verified",))
register(EventBooking, read_only=True, list_display=("id", "organiser", "venue_space__space_name", "event_date", "status", "total_cost_xaf", "created_at"),
         list_filter=("status", "event_type"), search_fields=("id", "organiser__username"))
register(VenueReview, list_display=("venue", "organiser", "rating", "event_date", "created_at"), search_fields=("organiser__username", "review_text"))
register(CatererReview, list_display=("caterer__name", "organiser", "score", "created_at"), search_fields=("organiser__username", "review_text"))
