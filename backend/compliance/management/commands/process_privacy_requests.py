"""Runs the scheduled privacy work: deletes accounts whose retention window has passed (unless they still hold
money or an open deal) and deletes data-export files past their lifetime. Safe to run as often as you like;
schedule it at least daily, e.g. `python manage.py process_privacy_requests`."""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Complete due account deletions and expire old data exports."

    def handle(self, *args, **options):
        from compliance.services import expire_data_exports
        from engagement.services import process_due_account_deletions

        deleted = process_due_account_deletions()
        expired = expire_data_exports()
        self.stdout.write(f"Deleted {len(deleted)} account(s); expired {expired} data export(s).")
