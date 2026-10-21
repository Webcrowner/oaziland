"""
Management command: expire_stale_service_requests — meant to run on a
schedule (for example hourly). Cancels Taskln jobs that no technician
accepted within the allowed window and tells the requester, and returns accepted
jobs to the board when the technician never sent a quote.

Scheduling: docker-compose.yml runs it hourly in the `scheduler` service. On
Railway, add a cron service that runs `python manage.py expire_stale_service_requests`
on the schedule `0 * * * *`.
"""
from django.core.management.base import BaseCommand
from services.services import (
    expire_stale_service_requests, release_unresponsive_technicians, auto_release_completed_jobs,
    release_no_show_technicians, QUOTE_DEADLINE_HOURS, URGENT_QUOTE_DEADLINE_HOURS, AUTO_RELEASE_HOURS, NO_SHOW_GRACE_HOURS,
)


class Command(BaseCommand):
    help = "Cancels unaccepted Taskln requests and releases technicians who never sent a quote."

    def add_arguments(self, parser):
        parser.add_argument("--max-age-hours", type=int, default=48)
        parser.add_argument("--quote-deadline-hours", type=int, default=QUOTE_DEADLINE_HOURS)
        parser.add_argument("--urgent-quote-deadline-hours", type=int, default=URGENT_QUOTE_DEADLINE_HOURS)
        parser.add_argument("--auto-release-hours", type=int, default=AUTO_RELEASE_HOURS)
        parser.add_argument("--no-show-grace-hours", type=int, default=NO_SHOW_GRACE_HOURS)

    def handle(self, *args, **options):
        expired = expire_stale_service_requests(max_age_hours=options["max_age_hours"])
        self.stdout.write(self.style.SUCCESS(f"Expired {len(expired)} unaccepted service request(s)."))
        released = release_unresponsive_technicians(
            max_hours=options["quote_deadline_hours"], urgent_max_hours=options["urgent_quote_deadline_hours"],
        )
        self.stdout.write(self.style.SUCCESS(f"Released {len(released)} unresponsive technician(s)."))
        no_shows = release_no_show_technicians(grace_hours=options["no_show_grace_hours"])
        self.stdout.write(self.style.SUCCESS(f"Released {len(no_shows)} no-show technician(s)."))
        paid = auto_release_completed_jobs(max_hours=options["auto_release_hours"])
        self.stdout.write(self.style.SUCCESS(f"Auto-released payment on {len(paid)} finished job(s)."))
