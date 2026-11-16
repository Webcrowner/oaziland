"""
Seeds realistic demo student hostels near Cameroonian universities: named hostels with photos, room types
(price, period, beds, bathroom, photos), the physical rooms under each type, a partner university and its
current semester. Two are listed by an agent for their landlord and one has a caretaker as manager, so every
way of running a hostel can be tried.

(Lives in the property app because student_hostels.management is a module, not a commands package.)

Everything belongs to demo_hostel_* users and every description says it is demo data.
    manage.py seed_demo_hostels            # create (skips if already there)
    manage.py seed_demo_hostels --reset    # remove the demo hostels and their users, then create them again
    manage.py seed_demo_hostels --remove   # remove them only
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

PREFIX = "demo_hostel_"
DEMO_NOTE = "Demo listing: sample data showing how Oaziland works, not a real offer."
IMG = "https://images.unsplash.com/photo-{}?auto=format&fit=crop&w=1200&q=80"
EXTERIOR = ["1564013799919-ab600027ffc6", "1560185007-cde436f6a4d0", "1512917774080-9991f1c4c750", "1555854877-bab0e564b8d5"]
ROOM_PHOTOS = {
    "studio": ["1522708323590-d24dbb6b0267", "1560448204-e02f11c3d0e2", "1556912172-45b7abe8b7e1"],
    "self_contain": ["1595526114035-0d45ed16cfbf", "1502672260266-1c1ef2d93688", "1493809842364-78817add7ffb"],
    "shared": ["1555854877-bab0e564b8d5", "1484154218962-a197022b5858"],
    "apartment": ["1545324418-cc1a3fa10c00", "1598928506311-c55ded91a20c", "1556912172-45b7abe8b7e1"],
}

USERS = {
    # key: (username suffix, phone, first name, last name, is agent)
    "landlord_buea": ("landlord_buea", "+237670100001", "Emmanuel", "Tabi", False),
    "landlord_yaounde": ("landlord_yaounde", "+237670100002", "Brigitte", "Atangana", False),
    "landlord_douala": ("landlord_douala", "+237670100003", "Joseph", "Ekwalla", False),
    "landlord_west": ("landlord_west", "+237670100004", "Martine", "Fotso", False),
    "agent": ("agent", "+237670100005", "Aïcha", "Njoya", True),
    "caretaker": ("caretaker", "+237670100006", "Jean", "Ngwa", False),
}

# Each hostel: owner key, listed by (agent key or None), name, (quarter, town), university, property type,
# amenities, description, room types. A room type: (name, unit type, occupancy, beds, price, period, size,
# private bathroom, furnished, photos key, description, room codes).
HOSTELS = [
    ("landlord_buea", None, "Molyko Heights Residence", ("Molyko", "Buea"), "University of Buea", "STUDIO_COMPLEX",
     ["BOREHOLE_WATER_TANK", "WIFI_READY", "FENCED_COMPOUND", "SECURITY_24_7", "BACKUP_GENERATOR"],
     "Gated student residence five minutes' walk from the University of Buea main gate. Borehole water, prepaid "
     "electricity meters, a backup generator for exams and a caretaker on site day and night.",
     [
         ("Studio with kitchenette", "STUDIO", "PER_UNIT", 1, 65000, "MONTH", 22, True, True, "studio",
          "Tiled studio with a kitchenette, a private shower and toilet, a bed, desk and wardrobe. Light and water on prepaid meters.",
          ["S-01", "S-02", "S-03", "S-04", "S-05", "S-06"]),
         ("Self-contain, private bathroom", "SELF_CONTAIN", "PER_UNIT", 1, 45000, "MONTH", 16, True, False, "self_contain",
          "Single room with its own shower and toilet. Shared outdoor cooking veranda.",
          ["C-01", "C-02", "C-03", "C-04"]),
     ]),
    ("landlord_yaounde", "agent", "Résidence Les Palmiers", ("Ngoa-Ekellé", "Yaoundé"), "University of Yaoundé I", "BLOCK",
     ["WIFI_READY", "FENCED_COMPOUND", "SECURITY_24_7", "BOREHOLE_WATER_TANK"],
     "Three-storey block on the Ngoa-Ekellé hill, walking distance to UY1 lecture halls and the polytechnic. "
     "Quiet study room, Wi-Fi in common areas and a guard at the gate.",
     [
         ("Shared room, 2 beds", "SHARED_ROOM", "PER_BED", 2, 18000, "MONTH", 18, False, True, "shared",
          "Bright twin room with two beds, two desks and lockable wardrobes. Shared bathrooms on each floor.",
          ["A-101", "A-102", "A-103", "A-104", "A-105"]),
         ("Self-contain, private bathroom", "SELF_CONTAIN", "PER_UNIT", 1, 40000, "MONTH", 15, True, True, "self_contain",
          "Furnished single room with a private shower and toilet.",
          ["B-201", "B-202", "B-203"]),
         ("One-bedroom apartment", "ONE_BED_APARTMENT", "PER_UNIT", 1, 420000, "SEMESTER", 38, True, True, "apartment",
          "Separate bedroom and living room, kitchen and bathroom. Ideal for postgraduates or two friends sharing.",
          ["C-301", "C-302"]),
     ]),
    ("landlord_douala", None, "Campus Cité Ange Raphaël", ("Ange Raphaël", "Douala"), "University of Douala", "SELF_CONTAIN_COMPOUND",
     ["FENCED_COMPOUND", "BACKUP_GENERATOR", "BOREHOLE_WATER_TANK"],
     "Self-contain compound behind the University of Douala campus at Ange Raphaël, close to taxis on the main road.",
     [
         ("Self-contain with balcony", "SELF_CONTAIN", "PER_UNIT", 1, 55000, "MONTH", 20, True, False, "self_contain",
          "Self-contain with a private bathroom and a small balcony overlooking the compound.",
          ["1A", "1B", "1C", "2A", "2B"]),
         ("Studio, furnished", "STUDIO", "PER_UNIT", 1, 700000, "YEAR", 24, True, True, "studio",
          "Furnished studio rented for the academic year, paid once. Air-conditioned, with kitchenette.",
          ["3A", "3B"]),
     ]),
    ("landlord_west", None, "Foto Student Lodge", ("Foto", "Dschang"), "University of Dschang", "MIXED",
     ["BOREHOLE_WATER_TANK", "FENCED_COMPOUND"],
     "Family-run lodge in Foto, a short moto ride from the University of Dschang. Installments accepted.",
     [
         ("Shared room, 3 beds", "SHARED_ROOM", "PER_BED", 3, 12000, "MONTH", 20, False, True, "shared",
          "Spacious room shared by three students, with a desk each. Shared bathrooms and a common kitchen.",
          ["F1", "F2", "F3"]),
         ("Self-contain", "SELF_CONTAIN", "PER_UNIT", 1, 30000, "MONTH", 14, True, False, "self_contain",
          "Simple self-contain with a private toilet and shower.",
          ["F4", "F5", "F6", "F7"]),
     ]),
    ("landlord_west", "agent", "Bambili Hilltop Hostel", ("Bambili", "Bamenda"), "University of Bamenda", "BLOCK",
     ["WIFI_READY", "FENCED_COMPOUND", "SECURITY_24_7"],
     "Hostel block on the Bambili hill near the University of Bamenda, with Wi-Fi and a guarded gate.",
     [
         ("Self-contain, private bathroom", "SELF_CONTAIN", "PER_UNIT", 1, 35000, "MONTH", 15, True, True, "self_contain",
          "Furnished self-contain with a private bathroom.",
          ["H-1", "H-2", "H-3", "H-4"]),
         ("Shared room, 2 beds", "SHARED_ROOM", "PER_BED", 2, 15000, "MONTH", 17, False, True, "shared",
          "Twin room, shared bathroom on the corridor.",
          ["H-5", "H-6", "H-7"]),
     ]),
    ("landlord_buea", None, "Dang University Residence", ("Dang", "Ngaoundéré"), "University of Ngaoundéré", "STUDIO_COMPLEX",
     ["BOREHOLE_WATER_TANK", "SOLAR_POWER", "FENCED_COMPOUND"],
     "Studios with solar backup in Dang, opposite the University of Ngaoundéré campus.",
     [
         ("Studio", "STUDIO", "PER_UNIT", 1, 50000, "MONTH", 20, True, True, "studio",
          "Furnished studio with kitchenette and a private bathroom; solar lighting when the grid is down.",
          ["D-1", "D-2", "D-3", "D-4", "D-5"]),
     ]),
]


class Command(BaseCommand):
    help = "Create realistic demo student hostels (room types, rooms, photos, managers). --reset to recreate, --remove to delete."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Remove the demo hostels first, then create them again.")
        parser.add_argument("--remove", action="store_true", help="Remove the demo hostels and their users only.")

    def handle(self, *args, reset=False, remove=False, **options):
        from identity.models import User
        if reset or remove:
            removed = remove_demo_hostels()
            self.stdout.write(f"Removed {removed} demo hostel(s) and their demo users.")
            if remove:
                return
        elif User.objects.filter(username__startswith=PREFIX).exists():
            self.stdout.write(self.style.WARNING("Demo hostels already exist; run with --reset to recreate them."))
            return
        count = create_demo_hostels()
        self.stdout.write(self.style.SUCCESS(f"Created {count} demo hostels."))


def remove_demo_hostels() -> int:
    from identity.models import User
    from notifications.models import Notification
    from student_hostels.models import HostelManagementContract, ManagerProfile, OwnerProfile, StudentHostel
    from transactions.models import Booking

    users = User.objects.filter(username__startswith=PREFIX)
    with transaction.atomic():
        hostels = list(StudentHostel.objects.filter(owner__in=users))
        room_type_ids = [rt.pk for hostel in hostels for rt in hostel.room_types.all()]
        Booking.objects.filter(target_content_type="student_hostels.HostelRoomType", target_id__in=room_type_ids).delete()
        HostelManagementContract.objects.filter(hostel__in=hostels).delete()
        for hostel in hostels:
            hostel.delete()
        ManagerProfile.objects.filter(account_user__in=users).delete()
        OwnerProfile.objects.filter(account_user__in=users).delete()
        Notification.objects.filter(recipient__in=users).delete()
        users.delete()
    return len(hostels)


@transaction.atomic
def create_demo_hostels() -> int:
    from geo.models import Quarter
    from identity.models import AgentProfile, User
    from notifications.models import Notification
    from property.models import PropertyAssetPhoto
    from student_hostels.agents import assign_manager, list_hostel_for_landlord
    from student_hostels.management import add_institution, create_semester, create_unit
    from student_hostels.models import OwnerProfile, OwnerType, Semester
    from student_hostels.room_types import add_room_type_photo, assign_unit_to_room_type, save_room_type
    from student_hostels.services import create_student_hostel

    quarters = {}
    for hostel_row in HOSTELS:
        quarter_name, town = hostel_row[3]
        found = Quarter.objects.filter(name=quarter_name, village_or_district__name=town).first()
        if found is None:
            raise CommandError(f"Quarter {quarter_name} ({town}) is missing: run seed_cameroon_geography first.")
        quarters[(quarter_name, town)] = found

    users = {}
    for key, (suffix, phone, first, last, is_agent) in USERS.items():
        user = User.objects.create(username=PREFIX + suffix, phone=phone, first_name=first, last_name=last)
        user.set_unusable_password()
        user.save(update_fields=["password"])
        if is_agent:
            AgentProfile.objects.create(user=user, agent_commission_percent=Decimal("10"))
        users[key] = user

    today = timezone.localdate()
    year_start = today.replace(month=9, day=1) if today.month >= 9 else today.replace(year=today.year - 1, month=9, day=1)
    semester_name = f"{year_start.year}/{year_start.year + 1} academic year"

    for index, (owner_key, lister_key, name, place, university, property_type, amenities, description, room_types) in enumerate(HOSTELS):
        quarter = quarters[place]
        owner = users[owner_key]
        if lister_key:
            hostel = list_hostel_for_landlord(
                agent=users[lister_key], landlord_identifier=owner.username, quarter=quarter, property_type=property_type, name=name,
            )
        else:
            profile, _ = OwnerProfile.objects.get_or_create(account_user=owner, defaults={"owner_type": OwnerType.LANDLORD})
            hostel = create_student_hostel(owner_profile=profile, quarter=quarter, property_type=property_type)
            hostel.name = name
        hostel.description = f"{description}\n\n{DEMO_NOTE}"
        hostel.amenities = amenities
        hostel.save(update_fields=["name", "description", "amenities"])

        shift = index % len(EXTERIOR)
        for position, photo_id in enumerate(EXTERIOR[shift:] + EXTERIOR[:shift]):
            PropertyAssetPhoto.objects.create(property_asset=hostel, url=IMG.format(photo_id), media_type="PHOTO", is_primary=position == 0)

        institution = add_institution(hostel, university)
        if not Semester.objects.filter(institution=institution, name__iexact=semester_name).exists():
            create_semester(
                hostel, institution_id=institution.pk, name=semester_name, start_date=year_start,
                end_date=year_start.replace(year=year_start.year + 1, month=7, day=31), billing_due_date=year_start + timedelta(days=14),
            )

        for (rt_name, unit_type, occupancy, beds, price, period, size, private_bathroom, furnished, photos_key,
             rt_description, codes) in room_types:
            room_type = save_room_type(hostel, {
                "name": rt_name, "unit_type": unit_type, "occupancy_model": occupancy, "beds_per_room": beds,
                "price_xaf": str(price), "price_period": period, "size_sqm": str(size),
                "private_bathroom": private_bathroom, "furnished": furnished, "description": rt_description,
            })
            for photo_id in ROOM_PHOTOS[photos_key]:
                add_room_type_photo(room_type, IMG.format(photo_id))
            for code in codes:
                unit = create_unit(hostel, room_code=code, unit_type=unit_type, occupancy_model=occupancy,
                                   bed_capacity=beds if occupancy == "PER_BED" else 1)
                assign_unit_to_room_type(unit, room_type)

        if name == "Molyko Heights Residence":
            assign_manager(hostel, by=owner, identifier=users["caretaker"].username, scope="BOOKINGS_ONLY")

    # The "an agent listed your hostel" / "you can manage a hostel" messages were for the demo users: drop them.
    Notification.objects.filter(recipient__in=users.values()).delete()
    return len(HOSTELS)
