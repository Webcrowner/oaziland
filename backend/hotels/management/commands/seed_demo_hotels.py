"""
Seeds realistic demo hotels and apartment buildings: each is one card in hotel search, and its page lists its
room/unit types (photos, price per night, bed set-up, size) with real numbered rooms behind each, so guests can
book a specific type for their dates.

Everything belongs to demo_hotel_* users and every description says it is demo data.
    manage.py seed_demo_hotels            # create (skips if already there)
    manage.py seed_demo_hotels --reset    # remove the demo hotels and their users, then create them again
    manage.py seed_demo_hotels --remove   # remove them only
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

PREFIX = "demo_hotel_"
DEMO_NOTE = "Demo listing: sample data showing how Oaziland works, not a real offer."
IMG = "https://images.unsplash.com/photo-{}?auto=format&fit=crop&w=1200&q=80"
EXTERIOR = ["1566073771259-6a8506099945", "1542314831-068cd1dbfeeb", "1520250497591-112f2f40a3f4", "1551882547-ff40c63fe5fa", "1571896349842-33c89424de2d"]
ROOM_PHOTOS = {
    "standard": ["1631049307264-da0ec9d70304", "1611892440504-42a792e24d32"],
    "deluxe": ["1590490360182-c33d57733427", "1618773928121-c32242e63f39", "1611892440504-42a792e24d32"],
    "suite": ["1578683010236-d716f9a3f461", "1582719508461-905c673771fd", "1596394516093-501ba68a0ba6"],
}

USERS = {
    "douala": ("douala", "+237677930001", "Paul", "Ekane"),
    "yaounde": ("yaounde", "+237677930002", "Solange", "Mbarga"),
    "limbe": ("limbe", "+237677930003", "Rita", "Ndive"),
}

# owner key, name, (quarter, town), stars, amenities, description, unit types.
# A unit type: (name, category, sleeps, rate/night, bed set-up, size m², rooms, photos key, amenities, description).
HOTELS = [
    ("douala", "Bonapriso Residence Hotel", ("Bonapriso", "Douala"), 4,
     ["WIFI_READY", "BACKUP_GENERATOR", "SECURITY_24_7", "PARKING"],
     "Business hotel on a quiet Bonapriso street, ten minutes from Akwa and the port. Generator backup, airport pick-up on request.",
     [
         ("Standard single", "STANDARD", 1, 28000, "1 double bed", 16, 8, "standard", ["Air conditioning", "Wi-Fi", "Work desk"],
          "Compact room for one with a work desk, a shower room and air conditioning."),
         ("Deluxe double", "DELUXE", 2, 42000, "1 queen bed", 26, 10, "deluxe", ["Air conditioning", "Wi-Fi", "Smart TV", "Minibar"],
          "Bright double with a seating corner, a smart TV and a walk-in shower."),
         ("Family room", "FAMILY", 4, 60000, "1 queen bed + 2 single beds", 34, 3, "suite", ["Air conditioning", "Wi-Fi", "Fridge"],
          "Room for a family of four, with a fridge and a large bathroom."),
         ("Executive suite", "SUITE", 2, 85000, "1 king bed", 45, 2, "suite", ["Air conditioning", "Wi-Fi", "Living room", "Bathtub", "Minibar"],
          "Suite with a separate living room, a bathtub and a view over Bonapriso."),
     ]),
    ("yaounde", "Résidence Mvan Appartements", ("Mvan", "Yaoundé"), 3,
     ["WIFI_READY", "FENCED_COMPOUND", "SECURITY_24_7", "BOREHOLE_WATER_TANK"],
     "Building of furnished studios and apartments near the Mvan bus stations, let by the night. Kitchen in every unit, borehole water, guard at the gate.",
     [
         ("Furnished studio", "STANDARD", 2, 22000, "1 double bed", 24, 12, "standard", ["Kitchenette", "Wi-Fi", "Fan"],
          "Studio with a kitchenette, a double bed and a private shower room."),
         ("One-bedroom apartment", "DELUXE", 3, 35000, "1 queen bed + sofa bed", 40, 6, "deluxe", ["Kitchen", "Living room", "Wi-Fi", "Air conditioning"],
          "Separate bedroom and living room with a fitted kitchen."),
         ("Two-bedroom apartment", "FAMILY", 5, 55000, "2 queen beds + sofa bed", 65, 3, "suite", ["Kitchen", "Living room", "Balcony", "Wi-Fi", "Air conditioning"],
          "Two bedrooms, a living room with balcony and a full kitchen, for families or teams."),
     ]),
    ("limbe", "Down Beach Guest Hotel", ("Down Beach", "Limbe"), 3,
     ["WIFI_READY", "PARKING", "BACKUP_GENERATOR"],
     "Small hotel a short walk from Down Beach and the fish market, with sea breezes and a terrace restaurant.",
     [
         ("Garden double", "STANDARD", 2, 25000, "1 double bed", 20, 6, "standard", ["Fan", "Wi-Fi", "Garden view"],
          "Ground-floor double opening onto the garden."),
         ("Sea-view double", "DELUXE", 2, 38000, "1 queen bed", 24, 5, "deluxe", ["Sea view", "Balcony", "Air conditioning", "Wi-Fi"],
          "Upper-floor double with a balcony facing the sea."),
     ]),
]


class Command(BaseCommand):
    help = "Create realistic demo hotels with room/unit types, rooms and photos. --reset to recreate, --remove to delete."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Remove the demo hotels first, then create them again.")
        parser.add_argument("--remove", action="store_true", help="Remove the demo hotels and their users only.")

    def handle(self, *args, reset=False, remove=False, **options):
        from identity.models import User
        if reset or remove:
            removed = remove_demo_hotels()
            self.stdout.write(f"Removed {removed} demo hotel(s) and their demo users.")
            if remove:
                return
        elif User.objects.filter(username__startswith=PREFIX).exists():
            self.stdout.write(self.style.WARNING("Demo hotels already exist; run with --reset to recreate them."))
            return
        count = create_demo_hotels()
        self.stdout.write(self.style.SUCCESS(f"Created {count} demo hotels."))


def remove_demo_hotels() -> int:
    from hotels.models import Hotel, Reservation
    from identity.models import User
    from transactions.models import Booking

    users = User.objects.filter(username__startswith=PREFIX)
    with transaction.atomic():
        hotels = list(Hotel.objects.filter(owner__in=users))
        reservations = Reservation.objects.filter(hotel__in=hotels)
        Booking.objects.filter(target_content_type="hotels.Reservation", target_id__in=list(reservations.values_list("id", flat=True))).delete()
        reservations.delete()
        for hotel in hotels:
            hotel.rooms.all().delete()
            hotel.delete()
        users.delete()
    return len(hotels)


@transaction.atomic
def create_demo_hotels() -> int:
    from geo.models import Quarter
    from hotels.models import Hotel
    from hotels.room_types import add_room_type_photo, save_room_type
    from identity.models import User
    from property.models import PropertyAssetPhoto

    users = {}
    for key, (suffix, phone, first, last) in USERS.items():
        user = User.objects.create(username=PREFIX + suffix, phone=phone, first_name=first, last_name=last)
        user.set_unusable_password()
        user.save(update_fields=["password"])
        users[key] = user

    for index, (owner_key, name, (quarter_name, town), stars, amenities, description, unit_types) in enumerate(HOTELS):
        quarter = Quarter.objects.filter(name=quarter_name, village_or_district__name=town).first()
        if quarter is None:
            raise CommandError(f"Quarter {quarter_name} ({town}) is missing: run seed_cameroon_geography first.")
        hotel = Hotel.objects.create(
            owner=users[owner_key], quarter=quarter, type="HOTEL", name=name, star_rating=stars, verified=True,
            description=f"{description}\n\n{DEMO_NOTE}", amenities=amenities,
        )
        shift = index % len(EXTERIOR)
        for position, photo_id in enumerate(EXTERIOR[shift:] + EXTERIOR[:shift]):
            PropertyAssetPhoto.objects.create(property_asset=hotel, url=IMG.format(photo_id), media_type="PHOTO", is_primary=position == 0)
        for (ut_name, category, sleeps, rate, beds, size, rooms, photos_key, ut_amenities, ut_description) in unit_types:
            room_type = save_room_type(hotel, {
                "name": ut_name, "category": category, "capacity": sleeps, "base_rate_xaf": str(rate), "bed_setup": beds,
                "size_sqm": str(size), "room_count": rooms, "amenities": ut_amenities, "description": ut_description,
            })
            for photo_id in ROOM_PHOTOS[photos_key]:
                add_room_type_photo(room_type, IMG.format(photo_id))
    return len(HOTELS)
