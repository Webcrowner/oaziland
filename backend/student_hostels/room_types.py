"""
student_hostels.room_types — room types: what students browse and book in a hostel ("Self-contain with
private bathroom — 40,000 XAF/month"), each with its own photos and price. The physical rooms (HostelUnits)
belong to a room type; availability is counted from them.

Booking a room type is capacity-aware: many students can hold places in the same room type at once, up to
the places free. (The generic booking lock in transactions.services locks a whole target, which would stop
every other student while one is paying.)
"""
import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import (
    MAX_PERIODS_PER_BOOKING, HostelPricePeriod, HostelRoomType, HostelRoomTypePhoto, HostelUnit, HostelUnitType,
    OccupancyModel, RoomAllocation, RoomAllocationStatus,
)

ROOM_TYPE_TARGET = "student_hostels.HostelRoomType"
MAX_NAME_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 2000
MAX_PHOTOS = 12
MAX_BEDS_PER_ROOM = 20
MAX_PRICE_XAF = Decimal("10000000")


class RoomTypeError(Exception):
    pass


# ---------------------------------------------------------------- owner set-up

def _clean_fields(data: dict) -> dict:
    name = " ".join(str(data.get("name") or "").split())
    if not name or len(name) > MAX_NAME_LENGTH:
        raise RoomTypeError(f"Give the room type a name of up to {MAX_NAME_LENGTH} characters, e.g. \"Self-contain with private bathroom\".")
    unit_type = str(data.get("unit_type") or "")
    occupancy = str(data.get("occupancy_model") or "")
    if unit_type not in HostelUnitType.values or occupancy not in OccupancyModel.values:
        raise RoomTypeError("Choose the kind of room and whether students rent a bed or the whole room.")
    try:
        beds = int(data.get("beds_per_room") or 1)
    except (TypeError, ValueError):
        beds = 0
    if occupancy == OccupancyModel.PER_UNIT and not data.get("beds_per_room"):
        beds = 1
    if not 1 <= beds <= MAX_BEDS_PER_ROOM:
        raise RoomTypeError(f"A room has between 1 and {MAX_BEDS_PER_ROOM} beds.")
    try:
        price = Decimal(str(data.get("price_xaf")))
    except (InvalidOperation, ValueError, TypeError):
        price = Decimal("-1")
    if not (price.is_finite() and Decimal("1") <= price <= MAX_PRICE_XAF) or price != price.to_integral_value():
        raise RoomTypeError("Enter the price in whole francs, from 1 XAF.")
    period = str(data.get("price_period") or HostelPricePeriod.MONTH)
    if period not in HostelPricePeriod.values:
        raise RoomTypeError("Choose whether the price is per month, per semester or per year.")
    size = data.get("size_sqm")
    if size in (None, ""):
        size = None
    else:
        try:
            size = Decimal(str(size))
        except (InvalidOperation, ValueError, TypeError):
            size = Decimal("0")
        if not (size.is_finite() and Decimal("1") <= size <= Decimal("1000")):
            raise RoomTypeError("Enter the room size in m², between 1 and 1000.")
    description = str(data.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION_LENGTH:
        raise RoomTypeError(f"Keep the description to {MAX_DESCRIPTION_LENGTH} characters.")
    return {
        "name": name, "unit_type": unit_type, "occupancy_model": occupancy, "beds_per_room": beds,
        "price_xaf": price, "price_period": period, "size_sqm": size,
        "private_bathroom": _flag(data.get("private_bathroom")), "furnished": _flag(data.get("furnished")),
        "description": description,
    }


def _flag(value) -> bool:
    return value is True or str(value).lower() in ("true", "1", "yes", "on")


def save_room_type(hostel, data: dict, room_type=None):
    """Creates a room type, or updates it. The rooms already under it follow its kind, letting and bed count
    as long as nobody has ever been housed in them."""
    fields = _clean_fields(data)
    if HostelRoomType.objects.filter(hostel=hostel, name__iexact=fields["name"]).exclude(pk=getattr(room_type, "pk", None)).exists():
        raise RoomTypeError("This hostel already has a room type with that name.")
    with transaction.atomic():
        if room_type is None:
            room_type = HostelRoomType.objects.create(hostel=hostel, **fields)
        else:
            layout_changed = any(getattr(room_type, key) != fields[key] for key in ("unit_type", "occupancy_model", "beds_per_room"))
            if layout_changed and RoomAllocation.objects.filter(unit__in=room_type.units.all()).exists():
                raise RoomTypeError("Students have been housed in rooms of this type, so its kind of room and beds can't change. Create a new room type instead.")
            for key, value in fields.items():
                setattr(room_type, key, value)
            room_type.save()
            if layout_changed:
                for unit in room_type.units.all():
                    _match_unit_to_type(unit, room_type)
    return room_type


def _match_unit_to_type(unit, room_type):
    from .models import BedSlot
    beds = room_type.beds_per_room if room_type.occupancy_model == OccupancyModel.PER_BED else 1
    unit.unit_type, unit.occupancy_model, unit.bed_capacity = room_type.unit_type, room_type.occupancy_model, beds
    unit.save(update_fields=["unit_type", "occupancy_model", "bed_capacity"])
    unit.bed_slots.all().delete()
    if room_type.occupancy_model == OccupancyModel.PER_BED:
        BedSlot.objects.bulk_create(BedSlot(unit=unit, bed_number=n) for n in range(1, beds + 1))


def set_room_type_active(room_type, active: bool):
    room_type.is_active = bool(active)
    room_type.save(update_fields=["is_active"])


def delete_room_type(room_type):
    if room_type.units.exists():
        raise RoomTypeError("Move or delete the rooms of this type first, or hide it instead.")
    if _all_bookings(room_type).exists():
        raise RoomTypeError("Students have booked this room type, so it is kept for the record. Hide it instead.")
    room_type.delete()


def add_room_type_photo(room_type, url: str):
    url = str(url or "").strip()
    if not url.startswith(("http://", "https://")) or len(url) > 500:
        raise RoomTypeError("Upload the photo first.")
    if room_type.photos.count() >= MAX_PHOTOS:
        raise RoomTypeError(f"A room type can have up to {MAX_PHOTOS} photos.")
    position = (room_type.photos.order_by("-position").values_list("position", flat=True).first() or 0) + 1
    return HostelRoomTypePhoto.objects.create(room_type=room_type, url=url, position=position)


def remove_room_type_photo(room_type, photo_id):
    deleted, _ = HostelRoomTypePhoto.objects.filter(room_type=room_type, pk=photo_id).delete()
    if not deleted:
        raise RoomTypeError("That photo was not found on this room type.")


def room_type_for(hostel, room_type_id):
    try:
        room_type_id = uuid.UUID(str(room_type_id))
    except (TypeError, ValueError):
        room_type_id = None
    room_type = HostelRoomType.objects.filter(hostel=hostel, pk=room_type_id).first() if room_type_id else None
    if room_type is None:
        raise RoomTypeError("Choose one of this hostel's room types.")
    return room_type


# ---------------------------------------------------------------- availability

def _places_in(unit) -> int:
    return unit.bed_capacity if unit.occupancy_model == OccupancyModel.PER_BED else 1


def _all_bookings(room_type):
    from transactions.models import Booking
    return Booking.objects.filter(target_content_type=ROOM_TYPE_TARGET, target_id=room_type.pk)


def _live_bookings(room_type, now=None):
    """Bookings holding a place: an unpaid hold still within its time, or a paid booking not yet finished."""
    from transactions.models import BookingStatus
    now = now or timezone.now()
    holding = Q(status__in=(BookingStatus.PENDING, BookingStatus.PAYMENT_PROCESSING), hold_expires_at__gt=now)
    paid = Q(status__in=(BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN))
    return _all_bookings(room_type).filter(holding | paid)


def availability(room_type, now=None) -> dict:
    """{"total": places in its rooms, "available": places a student can book now}. A place is taken by a
    student housed in it for a semester that hasn't ended, or by a live booking (paid bookings keep their
    place until the owner completes them on move-in, so a booked place is never sold twice)."""
    today = timezone.localdate(now) if now else timezone.localdate()
    units = list(room_type.units.all())
    total = sum(_places_in(unit) for unit in units)
    housed = RoomAllocation.objects.filter(
        unit__in=units, status=RoomAllocationStatus.ACTIVE, semester__end_date__gte=today,
    )
    if room_type.occupancy_model == OccupancyModel.PER_BED:
        taken = housed.count()
    else:
        taken = housed.values("unit_id").distinct().count()
    taken += _live_bookings(room_type, now).count()
    return {"total": total, "available": max(total - taken, 0)}


# ---------------------------------------------------------------- booking

def reserve_room_type(*, requester, room_type_id, periods):
    """Holds one place in a room type for HOLD_TTL_SECONDS while the student pays. The price is the room
    type's own price times the number of periods; nothing about the amount comes from the student."""
    from transactions.models import Booking, BookingStatus, BookingType
    from transactions.services import HOLD_TTL_SECONDS, InventoryConflictError

    try:
        room_type_id = uuid.UUID(str(room_type_id))
    except (TypeError, ValueError):
        raise RoomTypeError("That room was not found.") from None
    try:
        periods = int(periods if periods not in (None, "") else 1)
    except (TypeError, ValueError):
        periods = 0

    with transaction.atomic():
        # Locking the room type row serialises bookings of it, so the last free place can't be sold twice.
        room_type = HostelRoomType.objects.select_for_update().select_related("hostel").filter(
            pk=room_type_id, is_active=True,
        ).first()
        if room_type is None:
            raise RoomTypeError("That room was not found or is no longer offered.")
        if room_type.hostel.owner_id == requester.id:
            raise RoomTypeError("You can't book a room in your own hostel.")
        most = MAX_PERIODS_PER_BOOKING[room_type.price_period]
        if not 1 <= periods <= most:
            raise RoomTypeError(f"You can pay for between 1 and {most} periods at once.")
        if availability(room_type)["available"] < 1:
            raise InventoryConflictError("This room type is fully booked right now.")
        return Booking.objects.create(
            booking_type=BookingType.HOSTEL_SEMESTER, target_content_type=ROOM_TYPE_TARGET, target_id=room_type.pk,
            requester=requester, status=BookingStatus.PENDING, amount_xaf=room_type.price_xaf * periods,
            idempotency_key=str(uuid.uuid4()), hold_expires_at=timezone.now() + timezone.timedelta(seconds=HOLD_TTL_SECONDS),
        )


# ---------------------------------------------------------------- what students see

def public_room_types(hostel) -> list[dict]:
    rows = []
    room_types = hostel.room_types.filter(is_active=True).prefetch_related("photos", "units")
    for room_type in room_types:
        counts = availability(room_type)
        rows.append({
            "id": str(room_type.pk), "name": room_type.name, "unit_type": room_type.unit_type,
            "occupancy_model": room_type.occupancy_model, "beds_per_room": room_type.beds_per_room,
            "price_xaf": str(room_type.price_xaf), "price_period": room_type.price_period,
            "max_periods": MAX_PERIODS_PER_BOOKING[room_type.price_period],
            "size_sqm": str(room_type.size_sqm) if room_type.size_sqm is not None else None,
            "private_bathroom": room_type.private_bathroom, "furnished": room_type.furnished,
            "description": room_type.description,
            "photos": [{"id": photo.pk, "url": photo.url} for photo in room_type.photos.all()],
            "total_places": counts["total"], "available_places": counts["available"],
        })
    return rows


def owner_room_types(hostel) -> list[dict]:
    rows = []
    for room_type in hostel.room_types.prefetch_related("photos", "units").order_by("name"):
        counts = availability(room_type)
        rows.append({
            "id": str(room_type.pk), "name": room_type.name, "unit_type": room_type.unit_type,
            "occupancy_model": room_type.occupancy_model, "beds_per_room": room_type.beds_per_room,
            "price_xaf": str(room_type.price_xaf), "price_period": room_type.price_period,
            "size_sqm": str(room_type.size_sqm) if room_type.size_sqm is not None else None,
            "private_bathroom": room_type.private_bathroom, "furnished": room_type.furnished,
            "description": room_type.description, "is_active": room_type.is_active,
            "photos": [{"id": photo.pk, "url": photo.url} for photo in room_type.photos.all()],
            "rooms": sorted(unit.room_code for unit in room_type.units.all()),
            "total_places": counts["total"], "available_places": counts["available"],
        })
    return rows


def assign_unit_to_room_type(unit, room_type):
    """Puts a physical room under a room type (or none). Its kind, letting and beds then follow the type."""
    if room_type is not None and unit.room_type_id != room_type.pk:
        if RoomAllocation.objects.filter(unit=unit).exists() and any(
            getattr(unit, key) != value for key, value in (
                ("unit_type", room_type.unit_type), ("occupancy_model", room_type.occupancy_model),
                ("bed_capacity", room_type.beds_per_room if room_type.occupancy_model == OccupancyModel.PER_BED else 1),
            )
        ):
            raise RoomTypeError("Students have been housed in this room, so it can only join a room type with the same kind of room and beds.")
    unit.room_type = room_type
    unit.save(update_fields=["room_type"])
    if room_type is not None and not RoomAllocation.objects.filter(unit=unit).exists():
        _match_unit_to_type(unit, room_type)
    return unit


def unit_in(hostel, unit_id):
    try:
        unit_id = uuid.UUID(str(unit_id))
    except (TypeError, ValueError):
        unit_id = None
    unit = HostelUnit.objects.filter(building_id=hostel.building_ptr_id, pk=unit_id).first() if unit_id else None
    if unit is None:
        raise RoomTypeError("That room was not found in this hostel.")
    return unit
