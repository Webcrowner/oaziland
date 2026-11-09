from oaziland.admin_base import register

from .models import Land

register(Land, list_display=("id", "owner", "quarter", "land_use_type", "title_type", "deleted_at", "created_at"),
         list_filter=("land_use_type", "title_type"), search_fields=("owner__username", "quarter__name"),
         masked_fields=("title_deed_number",), readonly_fields=("deleted_at",))
