"""
Management command: populates the catalogue with every real item from
the Complementary Services Catalogue document — not just building the
mechanism, but actually filling it, per 'should be added ... if not yet
present'. Safe to re-run: uses get_or_create throughout.
"""
from django.core.management.base import BaseCommand
from catalogue.models import (
    AmenityCategory, Amenity, BillingType, SourcedVia,
    PartnerServiceCategory, PartnerServiceOffering,
)

AMENITIES = {
    "Connectivity": [
        ("Wi-Fi — Basic Tier", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 5000),
        ("Wi-Fi — Standard Tier", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 10000),
        ("Wi-Fi — Unlimited Tier", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 20000),
        ("Private Router Upgrade", BillingType.ONE_TIME, False, SourcedVia.VENDOR_PARTNER, 25000),
        ("Mobile Data Top-Up Bundle (MTN/Orange)", BillingType.ON_DEMAND, False, SourcedVia.VENDOR_PARTNER, None),
        ("Printing & Scanning Credit Allowance", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 3000),
    ],
    "Utilities & Backup Power": [
        ("Generator/Inverter Backup Access", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 15000),
        ("Water Storage/Backup Tank Access", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 8000),
        ("Prepaid Electricity Top-Up Service", BillingType.ON_DEMAND, True, SourcedVia.VENDOR_PARTNER, None),
        ("Air Conditioning/Fan Upgrade", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 10000),
    ],
    "Household & Domestic Services": [
        ("Cooking Gas Refill/Delivery", BillingType.ON_DEMAND, True, SourcedVia.TASKLN, None),
        ("Cooking Gas Auto-Refill Subscription", BillingType.RECURRING, True, SourcedVia.TASKLN, 12000),
        ("Cooking Gas Cylinder Exchange/Swap", BillingType.ON_DEMAND, True, SourcedVia.TASKLN, None),
        ("Kerosene or Charcoal Supply", BillingType.ON_DEMAND, True, SourcedVia.VENDOR_PARTNER, None),
        ("Firewood/Charcoal Delivery", BillingType.ON_DEMAND, True, SourcedVia.VENDOR_PARTNER, None),
        ("Toiletries & Essentials Restocking Subscription", BillingType.RECURRING, True, SourcedVia.VENDOR_PARTNER, 8000),
        ("Drinking Water Bottle/Sachet Delivery", BillingType.RECURRING, True, SourcedVia.VENDOR_PARTNER, 6000),
        ("Insecticide & Mosquito Coil Refill Service", BillingType.ON_DEMAND, True, SourcedVia.TASKLN, None),
        ("Light Bulb & Electrical Fixture Maintenance", BillingType.ON_DEMAND, True, SourcedVia.TASKLN, None),
    ],
    "Waste & Sanitation": [
        ("Dustbin Emptying — Scheduled", BillingType.RECURRING, True, SourcedVia.OAZILAND_DIRECT, 5000),
        ("Dustbin Emptying — On-Demand", BillingType.ON_DEMAND, True, SourcedVia.OAZILAND_DIRECT, 2000),
        ("Bathroom Deep-Cleaning Add-On", BillingType.ON_DEMAND, True, SourcedVia.TASKLN, 8000),
        ("Drainage & Plumbing Inspection Subscription", BillingType.RECURRING, True, SourcedVia.TASKLN, 5000),
    ],
    "Food & Catering": [
        ("Full Meal Plan (Breakfast, Lunch, Dinner)", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 60000),
        ("Partial Meal Plan (Breakfast or Dinner Only)", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 30000),
        ("Communal Kitchen Access Subscription", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 5000),
        ("Snack/Vending Pre-Loaded Credit", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 5000),
        ("Water Dispenser Subscription", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 4000),
    ],
    "Cleaning & Upkeep": [
        ("Weekly Room Cleaning Service", BillingType.RECURRING, True, SourcedVia.TASKLN, 15000),
        ("Bi-Weekly Room Cleaning Service", BillingType.RECURRING, True, SourcedVia.TASKLN, 8000),
        ("Laundry Service — Per-Load", BillingType.ON_DEMAND, True, SourcedVia.TASKLN, 1500),
        ("Laundry Service — Monthly Unlimited", BillingType.RECURRING, True, SourcedVia.TASKLN, 20000),
        ("Linen & Bedding Change Service", BillingType.RECURRING, True, SourcedVia.TASKLN, 6000),
        ("Pest Control Subscription", BillingType.RECURRING, True, SourcedVia.TASKLN, 10000),
    ],
    "Security & Safety": [
        ("24/7 Security Guard Tier", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 15000),
        ("Basic Gate Access", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 0),
        ("CCTV-Monitored Wing/Floor (Premium)", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 8000),
        ("Biometric/Key-Card Room Access Upgrade", BillingType.ONE_TIME, False, SourcedVia.VENDOR_PARTNER, 20000),
        ("Personal Locker/Safe Rental", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 5000),
    ],
    "Study & Productivity": [
        ("Study Room/Quiet Hall Booking", BillingType.ON_DEMAND, True, SourcedVia.OAZILAND_DIRECT, 1000),
        ("Printing & Study Materials Package", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 5000),
        ("Group Study Room Reservation", BillingType.ON_DEMAND, True, SourcedVia.OAZILAND_DIRECT, 2000),
        ("Library/Resource Center Access Fee", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 3000),
    ],
    "Wellness & Lifestyle": [
        ("Gym/Fitness Room Access", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 10000),
        ("On-Call Nurse/Health Service Subscription", BillingType.RECURRING, False, SourcedVia.VENDOR_PARTNER, 5000),
        ("Bicycle/Shuttle Transport to Campus", BillingType.RECURRING, False, SourcedVia.TASKLN, 15000),
        ("Recreation Room Access (TV Lounge, Games Room)", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 3000),
    ],
    "Convenience Add-Ons": [
        ("Storage Locker for Luggage (Holiday Breaks)", BillingType.ON_DEMAND, True, SourcedVia.OAZILAND_DIRECT, 5000),
        ("Package & Mail Receiving Service", BillingType.RECURRING, False, SourcedVia.OAZILAND_DIRECT, 2000),
        ("Guest Pass System with Security Logging", BillingType.ON_DEMAND, True, SourcedVia.OAZILAND_DIRECT, 500),
        ("Room Upgrade Subscription (Shared to Single, Mid-Semester)", BillingType.ONE_TIME, False, SourcedVia.OAZILAND_DIRECT, None),
        ("Grocery/Market-Run Errand Service", BillingType.ON_DEMAND, True, SourcedVia.TASKLN, 2000),
        ("Photocopy & Document Printing Pickup-Drop Service", BillingType.ON_DEMAND, True, SourcedVia.TASKLN, 1000),
    ],
}

PARTNER_SERVICES = {
    "Legal & Financial Services": [
        ("Notary & Title Transfer Assistance", SourcedVia.VENDOR_PARTNER, None),
        ("Mortgage / Land-Purchase Financing Partnership", SourcedVia.VENDOR_PARTNER, None),
        ("Property & Tenant Liability Insurance", SourcedVia.VENDOR_PARTNER, None),
        ("Land-Title Fraud Insurance", SourcedVia.VENDOR_PARTNER, None),
        ("Financing / Mortgage Matchmaking (Buyers)", SourcedVia.VENDOR_PARTNER, None),
        ("Post-Purchase Support: Title Registration & Utility Connection", SourcedVia.OAZILAND_DIRECT, None),
    ],
    "Move-In Logistics": [
        ("Moving & Transport Service", SourcedVia.TASKLN, None),
        ("Furniture Rental / Move-In Ready Package", SourcedVia.VENDOR_PARTNER, None),
        ("Utility Setup Assistance (ENEO/CAMWATER/Internet)", SourcedVia.VENDOR_PARTNER, None),
    ],
    "Marketing & Media": [
        ("Professional Photography", SourcedVia.TASKLN, 15000),
        ("Drone Video", SourcedVia.TASKLN, 30000),
        ("3D / Virtual Tour Production", SourcedVia.TASKLN, 50000),
    ],
    "Education & Community": [
        ("Peer Tutoring", SourcedVia.OAZILAND_DIRECT, None),
    ],
}


class Command(BaseCommand):
    help = "Seeds the catalogue app with every service from the Complementary Services Catalogue document."

    def handle(self, *args, **options):
        amenity_count = 0
        for category_name, items in AMENITIES.items():
            category, _ = AmenityCategory.objects.get_or_create(name=category_name)
            for name, billing_type, requires_scheduling, sourced_via, price in items:
                _, created = Amenity.objects.get_or_create(
                    name=name, category=category,
                    defaults={
                        "billing_type": billing_type, "requires_scheduling": requires_scheduling,
                        "sourced_via": sourced_via, "price_xaf": price,
                    },
                )
                if created:
                    amenity_count += 1

        partner_count = 0
        for category_name, items in PARTNER_SERVICES.items():
            category, _ = PartnerServiceCategory.objects.get_or_create(name=category_name)
            for name, sourced_via, price_hint in items:
                _, created = PartnerServiceOffering.objects.get_or_create(
                    name=name, category=category,
                    defaults={"sourced_via": sourced_via, "price_hint_xaf": price_hint},
                )
                if created:
                    partner_count += 1

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {amenity_count} new amenities and {partner_count} new partner service offerings."
        ))
