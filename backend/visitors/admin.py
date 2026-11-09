from oaziland.admin_base import register

from .models import VisitorEvent

register(VisitorEvent, read_only=True, list_display=("created_at", "country_code", "city", "device_type", "os", "browser", "path"),
         list_filter=("country_code", "device_type", "browser", "os"), search_fields=("path", "city", "referrer_host"))
