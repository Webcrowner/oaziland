"""Seeds a small, idempotent catalogue of training programs for local
development: `python manage.py seed_training_programs`."""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from careers.models import TrainingCategory, TrainingProgram
from engagement.models import Event
from identity.models import User

PROVIDER_USERNAME = "training_academy"

PROGRAMS = [
    {
        "title": "Property Management Basics",
        "category": TrainingCategory.PROPERTY_MANAGEMENT_BASICS,
        "description": "Rent collection, tenant onboarding, maintenance coordination and record keeping for landlords and caretakers.",
        "price_xaf": Decimal("25000"),
        "issues_certification": True,
    },
    {
        "title": "Tenant Law in Cameroon",
        "category": TrainingCategory.TENANT_LAW,
        "description": "Lease agreements, deposits, notice periods and how disputes between landlords and tenants are resolved.",
        "price_xaf": None,
        "issues_certification": False,
    },
    {
        "title": "Real Estate Agency Licensing Prep",
        "category": TrainingCategory.AGENCY_LICENSING_PREP,
        "description": "Everything you need to prepare for the agency licence assessment, with practice questions and a mock exam.",
        "price_xaf": Decimal("40000"),
        "issues_certification": True,
        "event": {"days_from_now": 14, "hours": 3, "location": "Douala — Akwa, Oaziland Training Room"},
    },
    {
        "title": "Hospitality Operations 101",
        "category": TrainingCategory.HOSPITALITY_OPERATIONS,
        "description": "Front desk, housekeeping standards, guest communication and handling bookings for guest houses and hotels.",
        "price_xaf": Decimal("15000"),
        "issues_certification": True,
    },
    {
        "title": "Photographing Your Listing",
        "category": TrainingCategory.OTHER,
        "description": "A free workshop on taking the clear, honest photos that get listings noticed.",
        "price_xaf": None,
        "issues_certification": False,
        "event": {"days_from_now": 7, "hours": 2, "location": "Online (Zoom)"},
    },
]


class Command(BaseCommand):
    help = "Create demo training programs (safe to run repeatedly)."

    def handle(self, *args, **options):
        provider, _ = User.objects.get_or_create(
            username=PROVIDER_USERNAME,
            defaults={"phone": "+237670000099", "first_name": "Oaziland", "last_name": "Academy"},
        )

        created = 0
        for spec in PROGRAMS:
            spec = dict(spec)
            event_spec = spec.pop("event", None)
            program, was_created = TrainingProgram.objects.get_or_create(
                provider=provider, title=spec.pop("title"), defaults=spec,
            )
            if was_created:
                created += 1
                if event_spec:
                    starts_at = timezone.now() + timedelta(days=event_spec["days_from_now"])
                    program.event = Event.objects.create(
                        organizer=provider,
                        title=program.title,
                        description=program.description,
                        starts_at=starts_at,
                        ends_at=starts_at + timedelta(hours=event_spec["hours"]),
                        location_description=event_spec["location"],
                    )
                    program.save(update_fields=["event"])

        self.stdout.write(self.style.SUCCESS(f"Training programs: {created} created, {len(PROGRAMS) - created} already present."))
