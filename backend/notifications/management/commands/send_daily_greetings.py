"""
Management command: send_daily_greetings — meant to run once per day
via a scheduler (cron/Celery beat). Calling all three greeting
functions here means a production deployment just needs ONE scheduled
job, not three separately configured ones.
"""
from django.core.management.base import BaseCommand
from notifications.services import (
    send_birthday_greetings, send_happy_new_month_greetings, send_platform_anniversary_greetings,
)


class Command(BaseCommand):
    help = "Sends birthday, new-month, and platform-anniversary greetings to all eligible active users."

    def handle(self, *args, **options):
        birthdays = send_birthday_greetings()
        new_month = send_happy_new_month_greetings()
        anniversaries = send_platform_anniversary_greetings()

        self.stdout.write(self.style.SUCCESS(
            f"Sent {len(birthdays)} birthday greeting(s), {len(new_month)} new-month greeting(s), "
            f"{len(anniversaries)} anniversary greeting(s)."
        ))
