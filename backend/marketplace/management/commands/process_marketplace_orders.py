"""
Management command: process_marketplace_orders — meant to run on a schedule (for example hourly).
Refunds orders a seller never handed over, and releases payment on orders handed over but never confirmed.
docker-compose.yml runs it from the `scheduler` service.
"""
from django.core.management.base import BaseCommand
from marketplace.services import process_marketplace_orders
from marketplace.engagement import remind_expiring_listings
from marketplace.offers import expire_offers


class Command(BaseCommand):
    help = "Refunds unfulfilled marketplace orders and auto-releases payment on unconfirmed handovers."

    def handle(self, *args, **options):
        result = process_marketplace_orders()
        reminded = remind_expiring_listings()
        expired_offers = expire_offers()
        self.stdout.write(self.style.SUCCESS(
            f"Expired {len(result['expired'])} pending payment(s); Refunded {len(result['refunded'])} "
            f"unfulfilled order(s); released {len(result['released'])} unconfirmed order(s); "
            f"relisted {len(result['relisted'])} ended rental(s); returned {len(result['deposits_returned'])} unclaimed deposit(s); "
            f"reminded {len(reminded)} lister(s) of expiring listings; expired {len(expired_offers)} offer(s)."
        ))
