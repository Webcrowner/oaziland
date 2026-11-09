from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from visitors.models import VisitorEvent


class Command(BaseCommand):
    help = "Deletes visitor page-view rows older than VISITOR_RETENTION_DAYS (or --days). Schedule it daily."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=None, help="Keep this many days (default: settings.VISITOR_RETENTION_DAYS).")

    def handle(self, *args, **options):
        days = options["days"] if options["days"] is not None else settings.VISITOR_RETENTION_DAYS
        cutoff = timezone.now() - timedelta(days=days)
        deleted, _ = VisitorEvent.objects.filter(created_at__lt=cutoff).delete()
        self.stdout.write(f"Deleted {deleted} visitor rows older than {days} days.")
