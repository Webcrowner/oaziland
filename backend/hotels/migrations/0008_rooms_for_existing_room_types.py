"""Gives hotel room types that were created before rooms were tracked at least one bookable room.

Availability is now counted from the rooms behind each room type. Hotels listed earlier have room types but no
rooms, which would make every one of them show as unavailable. Each such type gets one room, or as many as it has
open reservations if that is more, so reservations already made still fit; owners set the real number from their
hotel dashboard.
"""
from django.db import migrations
from django.utils import timezone


def give_existing_room_types_rooms(apps, schema_editor):
    RoomType = apps.get_model("hotels", "RoomType")
    Room = apps.get_model("hotels", "Room")
    Reservation = apps.get_model("hotels", "Reservation")
    today = timezone.localdate()
    for room_type in RoomType.objects.filter(hotel__isnull=False, rooms__isnull=True):
        open_reservations = Reservation.objects.filter(
            room_type=room_type, status__in=["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"], check_out__gte=today,
        ).count()
        taken = set(Room.objects.filter(hotel_id=room_type.hotel_id).values_list("room_number", flat=True))
        number = 101
        for _ in range(max(1, min(open_reservations, 50))):
            while str(number) in taken:
                number += 1
            Room.objects.create(hotel_id=room_type.hotel_id, room_type=room_type, room_number=str(number))
            taken.add(str(number))


class Migration(migrations.Migration):

    dependencies = [
        ("hotels", "0007_guest_house_rooms"),
    ]

    operations = [
        migrations.RunPython(give_existing_room_types_rooms, migrations.RunPython.noop),
    ]
