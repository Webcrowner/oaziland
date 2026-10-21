"""
Management command: process_marketplace_orders — meant to run on a schedule (for example hourly).
Refunds orders a seller never handed over, and releases payment on orders handed over but never confirmed.
docker-compose.yml runs it from the `scheduler` service.
"""
from django.core.management.base import BaseCommand
from marketplace.services import process_marketplace_orders


class Command(BaseCommand):
    help = "Refunds unfulfilled marketplace orders and auto-releases payment on unconfirmed handovers."

    def handle(self, *args, **options):
        result = process_marketplace_orders()
        self.stdout.write(self.style.SUCCESS(
            f"Refunded {len(result['refunded'])} unfulfilled order(s); released {len(result['released'])} unconfirmed order(s)."
        ))
