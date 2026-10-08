"""Seeds a small set of realistic demo listings (landlord, agent and agency lister) for local development."""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from geo.models import Quarter
from identity.models import AgencyProfile, AgentProfile, User
from property.models import House, Listing, ListingPhoto, ListingStatus, ListingType, PropertyAsset, Shop

DEMO_PREFIX = "demo_"
IMG = "https://images.unsplash.com/photo-{}?auto=format&fit=crop&w=1200&q=80"
VIDEO = "https://www.w3schools.com/html/mov_bbb.mp4"
PHOTOS = {
    "villa": ["1600585154340-be6161a56a0c", "1512917774080-9991f1c4c750", "1598928506311-c55ded91a20c", "1484154218962-a197022b5858"],
    "apartment": ["1545324418-cc1a3fa10c00", "1502672260266-1c1ef2d93688", "1493809842364-78817add7ffb", "1556912172-45b7abe8b7e1"],
    "studio": ["1522708323590-d24dbb6b0267", "1560448204-e02f11c3d0e2", "1493809842364-78817add7ffb"],
    "house": ["1564013799919-ab600027ffc6", "1560185007-cde436f6a4d0", "1598928506311-c55ded91a20c", "1484154218962-a197022b5858"],
    "shop": ["1523217582562-09d0def993a6", "1572120360610-d971b9d7767c"],
}

# (quarter name, kind, lister, listing type, price, style, beds, baths, parlours, size, finish, amenities, photos key, video, description)
LISTINGS = [
    ("Bastos Ambassades", "house", "landlord", "RENT", 650000, "DETACHED_VILLA", 4, 3, 2, 260, "MODERN",
     ["PARKING", "BACKUP_GENERATOR", "FENCED_COMPOUND", "SECURITY_24_7", "SWIMMING_POOL"], "villa", True,
     "Modern four-bedroom villa with two parlours, a landscaped garden and a double garage in the diplomatic quarter."),
    ("Bonanjo Centre Commercial", "house", "agency", "RENT", 250000, "APARTMENT", 2, 2, 1, 95, "MODERN",
     ["PARKING", "AIR_CONDITIONING", "BALCONY_TERRACE", "WIFI_READY"], "apartment", True,
     "Bright two-bedroom apartment close to banks and restaurants, with a fitted kitchen and a balcony."),
    ("Molyko Checkpoint", "house", "landlord", "RENT", 85000, "STUDIO", 1, 1, 0, 38, "MODERN",
     ["FURNISHED", "AIR_CONDITIONING", "WIFI_READY", "BOREHOLE_WATER_TANK"], "studio", False,
     "Furnished air-conditioned studio a short walk from the University of Buea."),
    ("Molyko Checkpoint", "house", "agent", "RENT", 45000, "SELF_CONTAIN", 1, 1, 0, 24, "STANDARD",
     ["BOREHOLE_WATER_TANK", "FENCED_COMPOUND"], "studio", False,
     "Self-contained room with private bathroom and prepaid meter in a quiet gated compound."),
    ("Ngoa-Ekellé Campus 1", "house", "agent", "RENT", 180000, "DUPLEX", 3, 2, 1, 140, "MODERN",
     ["PARKING", "BACKUP_GENERATOR", "FENCED_COMPOUND"], "house", False,
     "Three-bedroom duplex near the university campus with a spacious parlour and private parking."),
    ("Kribi Beachfront Resort Area", "house", "agency", "RENT", 350000, "DETACHED_VILLA", 3, 2, 1, 180, "MODERN",
     ["SWIMMING_POOL", "AIR_CONDITIONING", "BACKUP_GENERATOR", "SECURITY_24_7"], "villa", True,
     "Beach villa a few minutes from the shore, with a pool, shaded terrace and generator backup."),
    ("Bastos Ambassades", "house", "landlord", "SALE", 85000000, "DETACHED_VILLA", 5, 4, 2, 420, "MODERN",
     ["PARKING", "FENCED_COMPOUND", "CCTV", "SECURITY_24_7", "BACKUP_GENERATOR"], "villa", False,
     "Five-bedroom villa for sale with two parlours, staff quarters and full title, in a prime residential street."),
    ("Kribi Beachfront Resort Area", "house", "agent", "SALE", 42000000, "BUNGALOW", 3, 2, 1, 200, "STANDARD",
     ["PARKING", "FENCED_COMPOUND", "SOLAR_POWER"], "house", False,
     "Comfortable three-bedroom bungalow near the beachfront with a large plot and room to extend."),
    ("Bonanjo Centre Commercial", "shop", "landlord", "RENT", 300000, None, None, None, None, 60, "STANDARD",
     ["PARKING", "SECURITY_24_7"], "shop", False,
     "Ground-floor shop with a wide street frontage in the commercial centre, ideal for retail or a showroom."),
    ("Molyko Checkpoint", "shop", "agency", "SALE", 25000000, None, None, None, None, 45, "STANDARD",
     ["CCTV"], "shop", False,
     "Corner shop in a high-footfall student area, sold with its lease rights in place."),
]


class Command(BaseCommand):
    help = "Create demo listings from a demo landlord, an independent agent and an agency agent. Use --reset to remove them."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete previously seeded demo data first.")

    @transaction.atomic
    def handle(self, *args, reset=False, **options):
        demo_users = User.objects.filter(username__startswith=DEMO_PREFIX)
        if reset:
            Listing.objects.filter(listed_by__in=demo_users).delete()
            PropertyAsset.objects.filter(owner__in=demo_users).delete()
            demo_users.delete()
            self.stdout.write("Removed existing demo data.")
        elif demo_users.exists():
            self.stdout.write(self.style.WARNING("Demo data already exists; run with --reset to recreate it."))
            return

        quarters = {q.name: q for q in Quarter.objects.all()}
        missing = {row[0] for row in LISTINGS} - set(quarters)
        if missing:
            self.stderr.write(f"Missing quarters, nothing seeded: {sorted(missing)}")
            return

        landlord = User.objects.create(username="demo_landlord", phone="+237670000001", first_name="Paul", last_name="Mbarga")
        agent = User.objects.create(username="demo_agent", phone="+237670000002", first_name="Aïcha", last_name="Njoya")
        agency_user = User.objects.create(username="demo_agency", phone="+237670000003", first_name="Prime", last_name="Homes")
        agency_agent = User.objects.create(username="demo_agency_agent", phone="+237670000004", first_name="Samuel", last_name="Etoa")
        for user in (landlord, agent, agency_user, agency_agent):
            user.set_unusable_password()
            user.save()
        agency = AgencyProfile.objects.create(user=agency_user, registration_number="DEMO-001", agency_commission_percent=Decimal("5"))
        AgentProfile.objects.create(user=agent, agent_commission_percent=Decimal("10"))
        AgentProfile.objects.create(user=agency_agent, agency=agency, agent_commission_percent=Decimal("10"))
        listers = {"landlord": landlord, "agent": agent, "agency": agency_agent}

        for index, row in enumerate(LISTINGS):
            (quarter_name, kind, lister_key, listing_type, price, style, beds, baths, parlours, size, finish,
             amenities, photo_key, with_video, description) = row
            lister = listers[lister_key]
            # Agents list a landlord's property; direct landlord listings are owned by the lister.
            owner = lister if lister_key == "landlord" else landlord
            common = dict(owner=owner, quarter=quarters[quarter_name], size_sqm=size, description=description,
                          finish_level=finish, amenities=amenities)
            if kind == "house":
                asset = House.objects.create(type="HOUSE", house_style=style, bedrooms=beds, bathrooms=baths,
                                             living_rooms=parlours, **common)
            else:
                asset = Shop.objects.create(type="SHOP", frontage_meters=Decimal("8"), **common)

            listing = Listing.objects.create(
                property_asset=asset, listed_by=lister, listing_type=ListingType[listing_type],
                status=ListingStatus.DRAFT, price_xaf=Decimal(price),
            )
            listing.publish()
            for i, photo_id in enumerate(PHOTOS[photo_key]):
                ListingPhoto.objects.create(listing=listing, url=IMG.format(photo_id), media_type="PHOTO", is_primary=(i == 0))
            if with_video:
                ListingPhoto.objects.create(listing=listing, url=VIDEO, media_type="VIDEO", is_primary=False)

        self.stdout.write(self.style.SUCCESS(f"Created {len(LISTINGS)} demo listings."))
