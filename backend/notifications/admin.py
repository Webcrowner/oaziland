from oaziland.admin_base import register

from .models import GreetingSettings, Notification

register(Notification, read_only=True, list_display=("created_at", "recipient", "notification_type", "channel", "title", "delivered", "read_at"),
         list_filter=("channel", "delivered", "notification_type"), search_fields=("recipient__username", "title"),
         masked_fields=("external_phone_number",))
register(GreetingSettings, list_display=("id", "birthday_enabled", "new_month_enabled", "updated_at"))
