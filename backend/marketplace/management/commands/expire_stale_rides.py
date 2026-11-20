"""
Management command: expire_stale_rides — meant to run on a schedule (for example hourly).
Cancels OaziGo ride requests that no driver accepted in time, drops accepted trips that never started and closes
trips that stayed in progress without being paid, telling the people involved.
docker-compose.yml runs it from the `scheduler` service alongside expire_stale_service_requests.
"""
from django.core.management.base import BaseCommand
from marketplace.services import close_stuck_rides, expire_stale_rides, STALE_RIDE_HOURS


class Command(BaseCommand):
    help = "Cancels unaccepted OaziGo ride requests and closes trips that can no longer finish."

    def add_arguments(self, parser):
        parser.add_argument("--max-age-hours", type=int, default=STALE_RIDE_HOURS)

    def handle(self, *args, **options):
        expired = expire_stale_rides(max_age_hours=options["max_age_hours"])
        self.stdout.write(self.style.SUCCESS(f"Expired {len(expired)} unaccepted ride request(s)."))
        closed = close_stuck_rides()
        self.stdout.write(self.style.SUCCESS(
            f"Cancelled {len(closed['never_started'])} trip(s) that never started and closed {len(closed['abandoned'])} unpaid trip(s)."
        ))
