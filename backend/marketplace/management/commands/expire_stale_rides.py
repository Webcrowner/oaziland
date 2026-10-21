"""
Management command: expire_stale_rides — meant to run on a schedule (for example hourly).
Cancels OaziGo ride requests that no driver accepted in time and tells the rider.
docker-compose.yml runs it from the `scheduler` service alongside expire_stale_service_requests.
"""
from django.core.management.base import BaseCommand
from marketplace.services import expire_stale_rides, STALE_RIDE_HOURS


class Command(BaseCommand):
    help = "Cancels OaziGo ride requests that no driver accepted in time."

    def add_arguments(self, parser):
        parser.add_argument("--max-age-hours", type=int, default=STALE_RIDE_HOURS)

    def handle(self, *args, **options):
        expired = expire_stale_rides(max_age_hours=options["max_age_hours"])
        self.stdout.write(self.style.SUCCESS(f"Expired {len(expired)} unaccepted ride request(s)."))
