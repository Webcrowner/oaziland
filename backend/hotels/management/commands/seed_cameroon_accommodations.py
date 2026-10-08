"""
Seed script for Cameroon locations and real verified hospitality/accommodations/properties.
Ensures quarters, hotels, hostels, guest houses, venues, and listings exist in SQLite DB.
"""
from django.core.management.base import BaseCommand
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from identity.models import User, VerificationStatus, KYCProfile, MfaMethod, MfaType
from hotels.models import Hotel, RoomType
from student_hostels.models import StudentHostel, HostelUnit, OwnerProfile, OwnerType
from property.models import GuestHouseLodge, Listing, House, PropertyAssetPhoto
from events.models import Venue, VenueSpace
from decimal import Decimal


class Command(BaseCommand):
    help = "Seed Cameroon realistic demo accommodations and quarters"

    def handle(self, *args, **options):
        self.stdout.write("Seeding Cameroon quarters and accommodations...")

        # 1. Base Geo
        cm, _ = Country.objects.get_or_create(iso_code="CM", defaults={"name": "Cameroon"})
        centre, _ = Region.objects.get_or_create(country=cm, name="Centre")
        littoral, _ = Region.objects.get_or_create(country=cm, name="Littoral")
        southwest, _ = Region.objects.get_or_create(country=cm, name="South West")
        south, _ = Region.objects.get_or_create(country=cm, name="South")

        # Divisions
        mfoundi, _ = Division.objects.get_or_create(region=centre, name="Mfoundi")
        wouri, _ = Division.objects.get_or_create(region=littoral, name="Wouri")
        fako, _ = Division.objects.get_or_create(region=southwest, name="Fako")
        ocean, _ = Division.objects.get_or_create(region=south, name="Ocean")

        # Subdivisions
        yde1, _ = Subdivision.objects.get_or_create(division=mfoundi, name="Yaoundé I")
        yde3, _ = Subdivision.objects.get_or_create(division=mfoundi, name="Yaoundé III")
        dla1, _ = Subdivision.objects.get_or_create(division=wouri, name="Douala I")
        buea_sub, _ = Subdivision.objects.get_or_create(division=fako, name="Buea")
        kribi_sub, _ = Subdivision.objects.get_or_create(division=ocean, name="Kribi I")

        # Villages / Districts
        v_bastos, _ = VillageOrDistrict.objects.get_or_create(subdivision=yde1, name="Bastos")
        v_ngoa, _ = VillageOrDistrict.objects.get_or_create(subdivision=yde3, name="Ngoa-Ekellé")
        v_bonanjo, _ = VillageOrDistrict.objects.get_or_create(subdivision=dla1, name="Bonanjo")
        v_molyko, _ = VillageOrDistrict.objects.get_or_create(subdivision=buea_sub, name="Molyko")
        v_kribi, _ = VillageOrDistrict.objects.get_or_create(subdivision=kribi_sub, name="Kribi Beach")

        # Quarters
        q_bastos, _ = Quarter.objects.get_or_create(village_or_district=v_bastos, name="Bastos Ambassades")
        q_ngoa, _ = Quarter.objects.get_or_create(village_or_district=v_ngoa, name="Ngoa-Ekellé Campus 1")
        q_bonanjo, _ = Quarter.objects.get_or_create(village_or_district=v_bonanjo, name="Bonanjo Centre Commercial")
        q_molyko, _ = Quarter.objects.get_or_create(village_or_district=v_molyko, name="Molyko Checkpoint")
        q_kribi, _ = Quarter.objects.get_or_create(village_or_district=v_kribi, name="Kribi Beachfront Resort Area")

        # 2. Host User
        host, _ = User.objects.get_or_create(
            username="cameroon_host",
            defaults={
                "phone": "+237699001122",
                "email": "host@oaziland.cm",
                "verification_status": VerificationStatus.VERIFIED,
                "is_active": True,
            },
        )
        if not host.has_usable_password():
            host.set_password("HostPass123!")
            host.save()

        KYCProfile.objects.get_or_create(
            user=host,
            defaults={
                "kyc_status": VerificationStatus.VERIFIED,
                "legal_full_name": "Oaziland Verified Host Partner",
                "national_id_number": "1122334455",
                "date_of_birth": "1988-06-15",
                "residential_address": "Kribi Beachfront, Cameroon",
            },
        )
        MfaMethod.objects.get_or_create(
            user=host,
            defaults={
                "mfa_type": MfaType.SMS_OTP,
                "destination": host.phone,
                "verified": True,
                "is_primary": True,
            },
        )

        owner_profile, _ = OwnerProfile.objects.get_or_create(
            account_user=host,
            defaults={"owner_type": OwnerType.LANDLORD},
        )

        # 3. Seed Hotels
        h1, created = Hotel.objects.get_or_create(
            owner=host,
            quarter=q_kribi,
            type="HOTEL",
            defaults={
                "description": "Kribi Oceanfront Resort & Spa — Luxury beachfront accommodation with private beach access.",
                "verified": True,
                "star_rating": 4,
            },
        )
        if created:
            RoomType.objects.create(
                hotel=h1,
                category="DELUXE_OCEAN_SUITE",
                base_rate_xaf=Decimal("45000"),
                capacity=2,
            )
            RoomType.objects.create(
                hotel=h1,
                category="EXECUTIVE_SUITE",
                base_rate_xaf=Decimal("65000"),
                capacity=3,
            )
            PropertyAssetPhoto.objects.create(
                property_asset=h1,
                url="https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80",
                media_type="PHOTO",
                is_primary=True,
            )

        h2, created = Hotel.objects.get_or_create(
            owner=host,
            quarter=q_bastos,
            type="HOTEL",
            defaults={
                "description": "Bastos Diplomatic Suites — Boutique hotel near major embassies in Yaoundé.",
                "verified": True,
                "star_rating": 5,
            },
        )
        if created:
            RoomType.objects.create(
                hotel=h2,
                category="DIPLOMATIC_ROOM",
                base_rate_xaf=Decimal("55000"),
                capacity=2,
            )
            PropertyAssetPhoto.objects.create(
                property_asset=h2,
                url="https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80",
                media_type="PHOTO",
                is_primary=True,
            )

        # 4. Seed Student Hostels
        sh1, created = StudentHostel.objects.get_or_create(
            owner=host,
            owner_profile=owner_profile,
            quarter=q_molyko,
            type="STUDENT_HOSTEL",
            defaults={"property_type": "STUDIO_COMPLEX", "description": "Molyko Campus Heights Residence near University of Buea."},
        )
        if created:
            HostelUnit.objects.create(
                building=sh1,
                room_code="A101",
                unit_type="STUDIO",
                bed_capacity=1,
            )
            PropertyAssetPhoto.objects.create(
                property_asset=sh1,
                url="https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=800&q=80",
                media_type="PHOTO",
                is_primary=True,
            )

        sh2, created = StudentHostel.objects.get_or_create(
            owner=host,
            owner_profile=owner_profile,
            quarter=q_ngoa,
            type="STUDENT_HOSTEL",
            defaults={"property_type": "SELF_CONTAIN_COMPOUND", "description": "Ngoa-Ekellé University Hall near University of Yaoundé I."},
        )
        if created:
            HostelUnit.objects.create(
                building=sh2,
                room_code="B202",
                unit_type="SELF_CONTAIN",
                bed_capacity=2,
            )
            PropertyAssetPhoto.objects.create(
                property_asset=sh2,
                url="https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80",
                media_type="PHOTO",
                is_primary=True,
            )

        # 5. Seed Guest House Lodge
        gh1, created = GuestHouseLodge.objects.get_or_create(
            owner=host,
            quarter=q_kribi,
            type="GUEST_HOUSE_LODGE",
            defaults={"description": "Charming beachfront guest lodge in Kribi."},
        )
        if created:
            PropertyAssetPhoto.objects.create(
                property_asset=gh1,
                url="https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&w=800&q=80",
                media_type="PHOTO",
                is_primary=True,
            )

        # 6. Seed Property Listings (Houses)
        house1, created = House.objects.get_or_create(
            owner=host,
            quarter=q_bastos,
            type="HOUSE",
            defaults={
                "bedrooms": 3,
                "bathrooms": 2,
                "size_sqm": 220,
                "description": "Executive 3-bedroom villa in Bastos diplomatic quarter with 24/7 security and backup power.",
            },
        )
        if created:
            PropertyAssetPhoto.objects.create(
                property_asset=house1,
                url="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
                media_type="PHOTO",
                is_primary=True,
            )
            l1 = Listing.objects.create(
                property_asset=house1,
                listed_by=host,
                listing_type="RENT",
                price_xaf=Decimal("350000"),
                status="ACTIVE",
            )
            l1.published_at = l1.created_at
            l1.save()

        house2, created = House.objects.get_or_create(
            owner=host,
            quarter=q_bonanjo,
            type="HOUSE",
            defaults={
                "bedrooms": 2,
                "bathrooms": 2,
                "size_sqm": 120,
                "description": "Modern apartment in Bonanjo, Douala with sea view and underground parking.",
            },
        )
        if created:
            PropertyAssetPhoto.objects.create(
                property_asset=house2,
                url="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80",
                media_type="PHOTO",
                is_primary=True,
            )
            l2 = Listing.objects.create(
                property_asset=house2,
                listed_by=host,
                listing_type="RENT",
                price_xaf=Decimal("250000"),
                status="ACTIVE",
            )
            l2.published_at = l2.created_at
            l2.save()

        # 7. Seed bookable event venues so /events shows real reservable halls
        venue_seeds = [
            {
                "quarter": q_bastos, "name": "Palais des Banquets & Conférences", "theatre": 600, "banquet": 350, "price": "95000",
                "photo": "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=800&q=80",
            },
            {
                "quarter": q_bonanjo, "name": "Akwa Grand Ballroom & Terrace", "theatre": 450, "banquet": 280, "price": "85000",
                "photo": "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=800&q=80",
            },
            {
                "quarter": q_kribi, "name": "Kribi Oceanfront Wedding Gardens", "theatre": 300, "banquet": 220, "price": "75000",
                "photo": "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?auto=format&fit=crop&w=800&q=80",
            },
            {
                "quarter": q_molyko, "name": "Buea Summit Tech & Business Pavilion", "theatre": 250, "banquet": 150, "price": "50000",
                "photo": "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=800&q=80",
            },
        ]
        for seed in venue_seeds:
            venue, created = Venue.objects.get_or_create(
                owner=host, quarter=seed["quarter"], type="EVENT_CENTER",
                defaults={"description": seed["name"], "verified": True},
            )
            if created:
                VenueSpace.objects.create(
                    venue=venue, space_name=seed["name"], capacity_theatre=seed["theatre"],
                    capacity_banquet=seed["banquet"], base_price_per_hour_xaf=Decimal(seed["price"]),
                )
                PropertyAssetPhoto.objects.create(
                    property_asset=venue, url=seed["photo"], media_type="PHOTO", is_primary=True,
                )

        self.stdout.write(self.style.SUCCESS("Cameroon seed data loaded successfully."))
