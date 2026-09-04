"""
Management command: process_listing_expirations — meant to run once
daily via a scheduler. Sends reminders first, then expires anything
genuinely overdue, in that order.
"""
from django.core.management.base import BaseCommand
from property.services import send_listing_expiration_reminders, expire_overdue_listings


class Command(BaseCommand):
    help = "Sends listing-expiration reminders and expires any listing genuinely past its expiry date."

    def handle(self, *args, **options):
        reminders = send_listing_expiration_reminders()
        expired = expire_overdue_listings()
        self.stdout.write(self.style.SUCCESS(
            f"Sent {len(reminders)} expiration reminder(s); expired {len(expired)} overdue listing(s)."
        ))
