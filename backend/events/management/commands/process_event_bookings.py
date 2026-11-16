"""
Management command: process_event_bookings - meant to run on a schedule (hourly); docker-compose.yml runs it from the
`scheduler` service. Pays venue owners for events that ended with no problem reported, cancels bookings whose balance
wasn't paid in time (the venue keeps the deposit), and cancels bookings that never got a deposit.
"""
from django.core.management.base import BaseCommand

from events.lifecycle import process_event_bookings


class Command(BaseCommand):
    help = "Pays venues after the dispute window, enforces the balance deadline and cancels long-unpaid bookings."

    def handle(self, *args, **options):
        result = process_event_bookings()
        self.stdout.write(self.style.SUCCESS(
            f"Paid {len(result['paid'])} venue(s); cancelled {len(result['cancelled_unpaid_balance'])} for an unpaid balance "
            f"and {len(result['cancelled_unpaid'])} that never got a deposit."
        ))
