"""
Management command: sync_channel_calendars - meant to run on a schedule (hourly); docker-compose.yml runs it from the
`scheduler` service. Reads every connected booking site's calendar so its bookings block nights on Oaziland.
"""
from django.core.management.base import BaseCommand

from guest_houses.calendar_sync import sync_all_channel_calendars


class Command(BaseCommand):
    help = "Imports the calendars of every connected booking site (Airbnb, Booking.com, Vrbo)."

    def handle(self, *args, **options):
        summary = sync_all_channel_calendars()
        self.stdout.write(self.style.SUCCESS(f"Synced {summary['synced']} calendar(s); {summary['failed']} failed."))
