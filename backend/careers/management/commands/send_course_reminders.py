"""
Management command: send_course_reminders — runs hourly in the scheduler. Reminds learners who haven't made progress
on an online course for a week, reminds course staff about assignments waiting for their review, and alerts admins
about assignments nobody has reviewed for 5 days. Each reminder has its own spacing, so running it often is safe.
"""
from django.core.management.base import BaseCommand

from careers.course_reminders import send_course_reminders, send_review_reminders


class Command(BaseCommand):
    help = "Reminds inactive learners, and course staff (then admins) about assignments waiting for review."

    def handle(self, *args, **options):
        sent = send_course_reminders()
        reviews = send_review_reminders()
        self.stdout.write(self.style.SUCCESS(
            f"Sent {sent} course reminder(s); {reviews['reminded']} review reminder(s); "
            f"{reviews['escalated']} escalation(s) to admins."
        ))
