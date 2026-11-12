"""
Management command: send_course_reminders — meant to run once a day via the scheduler (cron), like
send_daily_greetings. Reminds learners who haven't made progress on an online course for a week.
"""
from django.core.management.base import BaseCommand

from careers.course_reminders import send_course_reminders


class Command(BaseCommand):
    help = "Reminds learners who haven't finished a lesson for a week to continue their course."

    def handle(self, *args, **options):
        sent = send_course_reminders()
        self.stdout.write(self.style.SUCCESS(f"Sent {sent} course reminder(s)."))
