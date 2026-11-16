"""
Seeds realistic demo guest houses (auberges): each is one card in guest house search, and its page lists its room
types (photos, price per night, beds, size) with real numbered rooms behind each, booked through the same engine
as hotels.

Everything belongs to demo_guesthouse_* users and every description says it is demo data.
    manage.py seed_demo_guest_houses            # create (skips if already there)
    manage.py seed_demo_guest_houses --reset    # remove them and their users, then create them again
    manage.py seed_demo_guest_houses --remove   # remove them only
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from .seed_demo_hotels import DEMO_NOTE, IMG, ROOM_PHOTOS

PREFIX = "demo_guesthouse_"
EXTERIOR = ["1571896349842-33c89424de2d", "1520250497591-112f2f40a3f4", "1551882547-ff40c63fe5fa", "1566073771259-6a8506099945"]

USERS = {
    "kribi": ("kribi", "+237677940001", "Odette", "Mbappe"),
    "limbe": ("limbe", "+237677940002", "George", "Mokake"),
    "buea": ("buea", "+237677940003", "Grace", "Efange"),
    "dschang": ("dschang", "+237677940004", "Albert", "Kamga"),
}

# owner key, name, (quarter, town), coastal, finish, amenities, description, room types.
# A room type: (name, category, sleeps, rate/night, bed set-up, size m², rooms, photos key, amenities, description).
GUEST_HOUSES = [
    ("kribi", "Auberge La Plage", ("Kribi Centre", "Kribi"), True, "MODERN",
     ["WIFI_READY", "AIR_CONDITIONING", "BALCONY_TERRACE", "PARKING"],
     "Family-run auberge two minutes from the beach in Kribi, with a shaded terrace and grilled fish on request.",
     [
         ("Garden double", "STANDARD", 2, 18000, "1 double bed", 16, 4, "standard", ["Fan", "Mosquito net", "Private shower"],
          "Simple, clean double opening onto the garden."),
         ("Sea-view double", "DELUXE", 2, 27000, "1 queen bed", 20, 3, "deluxe", ["Sea view", "Air conditioning", "Balcony"],
          "Upstairs double with a balcony facing the ocean."),
         ("Family room", "FAMILY", 4, 35000, "1 double bed + 2 single beds", 28, 1, "suite", ["Air conditioning", "Fridge"],
          "Large room for a family, with a fridge and a sitting corner."),
     ]),
    ("limbe", "Bota Bay Lodge", ("Bota", "Limbe"), True, "STANDARD",
     ["WIFI_READY", "BACKUP_GENERATOR", "SECURITY_24_7"],
     "Quiet lodge near Bota wharf and the botanical garden, with views of Mount Cameroon on clear mornings.",
     [
         ("Standard room", "STANDARD", 2, 15000, "1 double bed", 14, 5, "standard", ["Fan", "Wi-Fi"],
          "Comfortable room with a private shower and toilet."),
         ("Air-conditioned double", "DELUXE", 2, 22000, "1 queen bed", 18, 3, "deluxe", ["Air conditioning", "Wi-Fi", "TV"],
          "Air-conditioned double with a TV and work table."),
     ]),
    ("buea", "Great Soppo Guest House", ("Great Soppo", "Buea"), False, "MODERN",
     ["WIFI_READY", "BOREHOLE_WATER_TANK", "FENCED_COMPOUND", "PARKING"],
     "Calm guest house in Great Soppo, close to the University of Buea and the start of the Mount Cameroon trail.",
     [
         ("Single room", "STANDARD", 1, 12000, "1 single bed", 11, 4, "standard", ["Wi-Fi", "Hot water"],
          "Single room with hot water, ideal for visiting parents and short stays."),
         ("Double room", "DELUXE", 2, 17000, "1 double bed", 15, 4, "deluxe", ["Wi-Fi", "Hot water", "Desk"],
          "Double room with hot water and a desk."),
     ]),
    ("dschang", "Auberge des Collines", ("Centre-Ville", "Dschang"), False, "STANDARD",
     ["BOREHOLE_WATER_TANK", "SOLAR_POWER", "FENCED_COMPOUND"],
     "Small auberge in central Dschang near the lake and the climate-tourism centre, with cool highland nights.",
     [
         ("Double room", "STANDARD", 2, 13000, "1 double bed", 14, 5, "standard", ["Hot water", "Blankets"],
          "Warm double room with hot water and extra blankets for chilly nights."),
         ("Twin room", "FAMILY", 3, 18000, "3 single beds", 18, 2, "suite", ["Hot water"],
          "Room with three single beds for friends or small families."),
     ]),
]


class Command(BaseCommand):
    help = "Create realistic demo guest houses with room types, rooms and photos. --reset to recreate, --remove to delete."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Remove the demo guest houses first, then create them again.")
        parser.add_argument("--remove", action="store_true", help="Remove the demo guest houses and their users only.")

    def handle(self, *args, reset=False, remove=False, **options):
        from identity.models import User
        if reset or remove:
            removed = remove_demo_guest_houses()
            self.stdout.write(f"Removed {removed} demo guest house(s) and their demo users.")
            if remove:
                return
        elif User.objects.filter(username__startswith=PREFIX).exists():
            self.stdout.write(self.style.WARNING("Demo guest houses already exist; run with --reset to recreate them."))
            return
        count = create_demo_guest_houses()
        self.stdout.write(self.style.SUCCESS(f"Created {count} demo guest houses."))


def remove_demo_guest_houses() -> int:
    from hotels.models import Reservation, Room
    from identity.models import User
    from property.models import GuestHouseLodge
    from transactions.models import Booking

    users = User.objects.filter(username__startswith=PREFIX)
    with transaction.atomic():
        houses = list(GuestHouseLodge.objects.filter(owner__in=users))
        reservations = Reservation.objects.filter(guest_house__in=houses)
        Booking.objects.filter(target_content_type="hotels.Reservation", target_id__in=list(reservations.values_list("id", flat=True))).delete()
        reservations.delete()
        Room.objects.filter(guest_house__in=houses).delete()
        for house in houses:
            house.delete()
        users.delete()
    return len(houses)


@transaction.atomic
def create_demo_guest_houses() -> int:
    from geo.models import Quarter
    from hotels.room_types import add_room_type_photo, save_room_type
    from identity.models import User
    from property.models import GuestHouseLodge, PropertyAssetPhoto

    users = {}
    for key, (suffix, phone, first, last) in USERS.items():
        user = User.objects.create(username=PREFIX + suffix, phone=phone, first_name=first, last_name=last)
        user.set_unusable_password()
        user.save(update_fields=["password"])
        users[key] = user

    for index, (owner_key, name, (quarter_name, town), coastal, finish, amenities, description, room_types) in enumerate(GUEST_HOUSES):
        quarter = Quarter.objects.filter(name=quarter_name, village_or_district__name=town).first()
        if quarter is None:
            raise CommandError(f"Quarter {quarter_name} ({town}) is missing: run seed_cameroon_geography first.")
        house = GuestHouseLodge.objects.create(
            owner=users[owner_key], quarter=quarter, type="HOUSE", name=name, is_coastal_leisure=coastal,
            finish_level=finish, amenities=amenities, description=f"{description}\n\n{DEMO_NOTE}",
        )
        shift = index % len(EXTERIOR)
        for position, photo_id in enumerate(EXTERIOR[shift:] + EXTERIOR[:shift]):
            PropertyAssetPhoto.objects.create(property_asset=house, url=IMG.format(photo_id), media_type="PHOTO", is_primary=position == 0)
        for (rt_name, category, sleeps, rate, beds, size, rooms, photos_key, rt_amenities, rt_description) in room_types:
            room_type = save_room_type(house, {
                "name": rt_name, "category": category, "capacity": sleeps, "base_rate_xaf": str(rate), "bed_setup": beds,
                "size_sqm": str(size), "room_count": rooms, "amenities": rt_amenities, "description": rt_description,
            })
            for photo_id in ROOM_PHOTOS[photos_key]:
                add_room_type_photo(room_type, IMG.format(photo_id))
    return len(GUEST_HOUSES)
