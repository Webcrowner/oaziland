"""
Management command: process_hotel_reservations — meant to run on a schedule (hourly); docker-compose.yml runs it from
the `scheduler` service. Pays hotel and guest-house owners for stays that ended with no problem reported, and cancels
reservations that were never paid.
"""
from django.core.management.base import BaseCommand

from hotels.stays import process_hotel_reservations


class Command(BaseCommand):
    help = "Pays owners for completed stays after the dispute window and cancels long-unpaid reservations."

    def handle(self, *args, **options):
        result = process_hotel_reservations()
        self.stdout.write(self.style.SUCCESS(
            f"Paid {len(result['paid'])} owner(s) for finished stays; cancelled {len(result['cancelled_unpaid'])} unpaid reservation(s)."
        ))
