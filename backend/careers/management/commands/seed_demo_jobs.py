"""
Seeds realistic demo job postings across Cameroon's real estate, hospitality, and transport sectors:
    manage.py seed_demo_jobs            # create (skips if already there)
    manage.py seed_demo_jobs --reset    # remove demo jobs and their users, then create them again
    manage.py seed_demo_jobs --remove   # remove them only
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

PREFIX = "demo_jobs_"
DEMO_NOTE = "Demo opening: sample job listing illustrating how Oaziland Careers works."

EMPLOYERS = {
    "bastos": ("bastos_estates", "+237670800001", "Bastos", "Prime Estates", "Bastos Prime Estates"),
    "akwa": ("akwa_commercial", "+237670800002", "Akwa", "Commercial Realty", "Akwa Commercial Realty"),
    "molyko": ("molyko_residences", "+237670800003", "Molyko", "Student Living", "Molyko Student Living"),
    "kribi": ("kribi_resort", "+237670800004", "Kribi", "Oceanfront Suites", "Kribi Oceanfront Suites"),
    "oazigo": ("oazigo_fleet", "+237670800005", "OaziGo", "Logistics Partners", "OaziGo Fleet Partners"),
}

JOBS = [
    (
        "bastos",
        "Senior Property Manager — Residential Portfolio",
        "PROPERTY_MANAGER",
        "FULL_TIME",
        "ON_SITE",
        "Bastos",
        Decimal("350000"),
        Decimal("500000"),
        21,
        "Lead daily operations across 35 serviced apartments and diplomatic villas in Bastos and Golf.\n\n"
        "Responsibilities:\n"
        "• Oversee tenant onboarding, lease renewals, and monthly rent reconciliation.\n"
        "• Coordinate preventive maintenance, generator servicing, and vetted Taskln technicians.\n"
        "• Prepare clear monthly owner statements and occupancy reports.\n\n"
        "Requirements:\n"
        "• 3+ years managing residential or mixed-use properties in Yaoundé.\n"
        "• Fluent in French and English, with strong owner communication skills.",
    ),
    (
        "akwa",
        "Licensed Real Estate Leasing Agent",
        "AGENT",
        "FULL_TIME",
        "HYBRID",
        "Akwa",
        Decimal("180000"),
        Decimal("320000"),
        18,
        "Represent verified commercial offices, retail storefronts, and modern apartments across Akwa and Bonapriso.\n\n"
        "Responsibilities:\n"
        "• Conduct property inspections, verify title documentation, and host scheduled viewings.\n"
        "• Guide clients from initial inquiry through Oaziland escrow reservation and key handover.\n"
        "• Maintain accurate photos, pricing, and availability on all assigned listings.\n\n"
        "Compensation includes base retainer plus transparent leasing commission.",
    ),
    (
        "molyko",
        "Resident Hostel Warden & Student Coordinator",
        "HOSTEL_WARDEN",
        "FULL_TIME",
        "ON_SITE",
        "Molyko",
        Decimal("120000"),
        Decimal("160000"),
        14,
        "On-site warden for a 60-room gated student residence near the University of Buea.\n\n"
        "Responsibilities:\n"
        "• Manage semester check-ins, room condition inspections, and quiet study hours.\n"
        "• Supervise compound security, borehole water schedules, and backup power.\n"
        "• Act as the first point of contact for students and parents.\n\n"
        "Includes a private self-contained warden studio on the premises.",
    ),
    (
        "kribi",
        "Facilities & Maintenance Lead (HVAC & Electrical)",
        "MAINTENANCE_STAFF",
        "CONTRACT",
        "ON_SITE",
        "Bonapriso",
        Decimal("200000"),
        Decimal("280000"),
        25,
        "Full-time facilities technician supporting boutique guest houses and serviced stays.\n\n"
        "Responsibilities:\n"
        "• Diagnose and repair split AC units, water heaters, pumps, and three-phase inverters.\n"
        "• Run weekly safety checklists and supervise external contractors when needed.\n"
        "• Keep spare-parts inventory organized and respond promptly to guest room tickets.",
    ),
    (
        "oazigo",
        "Corporate & Property Viewing Chauffeur",
        "DRIVER",
        "FULL_TIME",
        "ON_SITE",
        "Bastos",
        Decimal("140000"),
        Decimal("190000"),
        10,
        "Dedicated full-time driver for client property tours, airport transfers, and document dispatch in Yaoundé.\n\n"
        "Requirements:\n"
        "• Valid Category B driver's license with at least 4 years of clean city driving.\n"
        "• Thorough knowledge of Yaoundé neighborhoods (Bastos, Odza, Mvan, Nkolbisson).\n"
        "• Punctual, courteous, and comfortable using mobile navigation.",
    ),
    (
        "kribi",
        "Front Desk & Guest Experience Supervisor",
        "OTHER",
        "PART_TIME",
        "ON_SITE",
        "Bonanjo",
        Decimal("160000"),
        Decimal("230000"),
        30,
        "Welcome domestic and international guests at a 28-room boutique hotel and event venue.\n\n"
        "Responsibilities:\n"
        "• Coordinate reservations, Mobile Money & card check-ins, and housekeeping turnovers.\n"
        "• Support corporate seminar and wedding hall bookings.\n"
        "• Ensure every guest review and inquiry receives a fast, helpful response.",
    ),
]


class Command(BaseCommand):
    help = "Seed realistic demo job postings for Oaziland Careers."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing demo jobs and recreate them.")
        parser.add_argument("--remove", action="store_true", help="Remove demo jobs and their demo employer accounts.")

    @transaction.atomic
    def handle(self, *args, **options):
        from careers.models import JobPosting
        from geo.models import Quarter
        from identity.models import User
        from notifications.models import Notification

        demo_users = User.objects.filter(username__startswith=PREFIX)
        if options["remove"] or options["reset"]:
            deleted_jobs, _ = JobPosting.objects.filter(posted_by__in=demo_users).delete()
            Notification.objects.filter(recipient__in=demo_users).delete()
            demo_users.delete()
            if options["remove"]:
                self.stdout.write(self.style.SUCCESS(f"Removed {deleted_jobs} demo job posting(s)."))
                return

        if JobPosting.objects.filter(posted_by__username__startswith=PREFIX).exists():
            self.stdout.write("Demo job postings already exist (use --reset to recreate).")
            return

        employers = {}
        companies = {}
        for key, (suffix, phone, first, last, company) in EMPLOYERS.items():
            user, _ = User.objects.get_or_create(
                username=PREFIX + suffix,
                defaults={"phone": phone, "first_name": first, "last_name": last},
            )
            user.set_unusable_password()
            user.save(update_fields=["password"])
            employers[key] = user
            companies[key] = company

        now = timezone.now()
        created = 0
        for idx, (emp_key, title, role, emp_type, workplace, quarter_name, sal_min, sal_max, days_open, desc) in enumerate(JOBS):
            quarter = Quarter.objects.filter(name__iexact=quarter_name).first()
            posting = JobPosting.objects.create(
                posted_by=employers[emp_key],
                company_name=companies[emp_key],
                title=title,
                role_category=role,
                employment_type=emp_type,
                workplace_type=workplace,
                quarter=quarter,
                salary_min_xaf=sal_min,
                salary_max_xaf=sal_max,
                closes_at=now + timedelta(days=days_open),
                description=f"{desc}\n\n— {DEMO_NOTE}",
            )
            # Stagger posted_at slightly so the feed reads naturally.
            JobPosting.objects.filter(pk=posting.pk).update(posted_at=now - timedelta(hours=idx * 7 + 2))
            created += 1

        self.stdout.write(self.style.SUCCESS(f"Seeded {created} demo job posting(s)."))
