"""Runs the scheduled messaging work: sends "send later" messages whose time has come and permanently deletes
messages that have sat in Trash past the retention window. Safe to run as often as you like (hourly or more)."""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Send due scheduled messages and purge expired trash."

    def handle(self, *args, **options):
        from social.services import purge_expired_trash, send_due_scheduled_messages

        sent = send_due_scheduled_messages()
        purged = purge_expired_trash()
        purged_count = purged if isinstance(purged, int) else len(purged or [])
        self.stdout.write(f"Sent {len(sent)} scheduled message(s); purged {purged_count} trashed message(s).")
