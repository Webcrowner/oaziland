"""
hotels.room_types — a hotel's (or guest house's) room types: what guests browse and book on its page ("Deluxe double with balcony —
45,000 XAF/night"), each with its own photos, price and a number of physical rooms (Rooms) behind it.

Availability is counted per night: a room type is free for a stay when, on every night of it, fewer of its rooms
are taken than it has. A reservation awaiting payment holds its room for PAYMENT_HOLD_MINUTES so two guests can't
pay for the last room at once; after that the hold lapses and the room is offered again.
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import (
    Reservation, ReservationStatus, Room, RoomCategory, RoomStatus, RoomType, RoomTypePhoto,
)

MAX_NAME_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 2000
MAX_PHOTOS = 12
MAX_CAPACITY = 20
MAX_ROOMS_PER_TYPE = 500
MAX_AMENITIES = 30
MAX_RATE_XAF = Decimal("10000000")
MAX_NIGHTS = 60
MAX_DAYS_AHEAD = 365
PAYMENT_HOLD_MINUTES = 15
UNSELLABLE_ROOM_STATUSES = (RoomStatus.OUT_OF_ORDER, RoomStatus.OUT_OF_SERVICE)


class RoomTypeError(Exception):
    pass


def place_field(place) -> str:
    """The RoomType/Room/Reservation field that points at this place: "hotel" or "guest_house"."""
    from .models import Hotel
    return "hotel" if isinstance(place, Hotel) else "guest_house"


class RoomTypeUnavailableError(RoomTypeError):
    pass


# ---------------------------------------------------------------- owner set-up

def _flag(value) -> bool:
    return value is True or str(value).lower() in ("true", "1", "yes", "on")


def _clean_fields(data: dict) -> dict:
    name = " ".join(str(data.get("name") or "").split())
    if not name or len(name) > MAX_NAME_LENGTH:
        raise RoomTypeError(f"Give the room type a name of up to {MAX_NAME_LENGTH} characters, e.g. \"Deluxe double with balcony\".")
    category = str(data.get("category") or RoomCategory.STANDARD)
    if category not in RoomCategory.values:
        raise RoomTypeError("Choose the category of room.")
    try:
        capacity = int(data.get("capacity") or 0)
    except (TypeError, ValueError):
        capacity = 0
    if not 1 <= capacity <= MAX_CAPACITY:
        raise RoomTypeError(f"A room sleeps between 1 and {MAX_CAPACITY} guests.")
    try:
        rate = Decimal(str(data.get("base_rate_xaf")))
    except (InvalidOperation, ValueError, TypeError):
        rate = Decimal("-1")
    if not (rate.is_finite() and Decimal("1") <= rate <= MAX_RATE_XAF) or rate != rate.to_integral_value():
        raise RoomTypeError("Enter the nightly rate in whole francs, from 1 XAF.")
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
    bed_setup = " ".join(str(data.get("bed_setup") or "").split())
    if len(bed_setup) > MAX_NAME_LENGTH:
        raise RoomTypeError(f"Keep the bed set-up to {MAX_NAME_LENGTH} characters.")
    description = str(data.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION_LENGTH:
        raise RoomTypeError(f"Keep the description to {MAX_DESCRIPTION_LENGTH} characters.")
    raw_amenities = data.get("amenities") or []
    if isinstance(raw_amenities, str):
        raw_amenities = raw_amenities.split(",")
    if not isinstance(raw_amenities, (list, tuple)):
        raise RoomTypeError("List the room's amenities.")
    amenities = []
    for item in raw_amenities:
        item = " ".join(str(item or "").split())[:60]
        if item and item.lower() not in (a.lower() for a in amenities):
            amenities.append(item)
    if len(amenities) > MAX_AMENITIES:
        raise RoomTypeError(f"List up to {MAX_AMENITIES} amenities.")
    return {
        "name": name, "category": category, "capacity": capacity, "base_rate_xaf": rate, "size_sqm": size,
        "bed_setup": bed_setup, "description": description, "amenities": amenities,
    }


def _room_count_from(data: dict):
    if data.get("room_count") in (None, ""):
        return None
    try:
        count = int(data.get("room_count"))
    except (TypeError, ValueError):
        count = -1
    if not 0 <= count <= MAX_ROOMS_PER_TYPE:
        raise RoomTypeError(f"A room type has between 0 and {MAX_ROOMS_PER_TYPE} rooms.")
    return count


def save_room_type(place, data: dict, room_type=None):
    """Creates a room type of a hotel or guest house, or updates it; "room_count" (optional) sets how many
    physical rooms it has."""
    fields = _clean_fields(data)
    room_count = _room_count_from(data)
    link = {place_field(place): place}
    if RoomType.objects.filter(**link, name__iexact=fields["name"]).exclude(pk=getattr(room_type, "pk", None)).exists():
        raise RoomTypeError("There is already a room type with that name here.")
    with transaction.atomic():
        if room_type is None:
            room_type = RoomType.objects.create(**link, **fields)
        else:
            room_type = RoomType.objects.select_for_update().get(pk=room_type.pk)
            for key, value in fields.items():
                setattr(room_type, key, value)
            room_type.save()
        if room_count is not None:
            set_room_count(room_type, room_count)
    return room_type


def _peak_future_bookings(room_type) -> int:
    today = timezone.localdate()
    reservations = list(_live_reservations(room_type).filter(check_out__gt=today).values_list("check_in", "check_out"))
    peak = 0
    for night in {max(ci, today) + timedelta(days=d) for ci, co in reservations for d in range((co - max(ci, today)).days)}:
        peak = max(peak, sum(1 for ci, co in reservations if ci <= night < co))
    return peak


def set_room_count(room_type, count: int):
    """Adds numbered rooms (101, 102...) or removes spare ones until the room type has `count` rooms. Rooms a guest
    has stayed in are kept for the record, and the count can't drop below what's already booked on any night."""
    current = list(room_type.rooms.order_by("-room_number"))
    if count > len(current):
        link = {"hotel": room_type.hotel, "guest_house": room_type.guest_house}
        place_key = "hotel" if room_type.hotel_id else "guest_house"
        taken = set(Room.objects.filter(**{place_key: link[place_key]}).values_list("room_number", flat=True))
        number = 101
        for _ in range(count - len(current)):
            while str(number) in taken:
                number += 1
            Room.objects.create(**link, room_type=room_type, room_number=str(number))
            taken.add(str(number))
    elif count < len(current):
        if count < _peak_future_bookings(room_type):
            raise RoomTypeError("Guests have already booked more rooms of this type than that on some nights.")
        removable = [r for r in current if r.status != RoomStatus.OCCUPIED and not r.assignments.exists()]
        to_remove = len(current) - count
        if len(removable) < to_remove:
            raise RoomTypeError("Some of these rooms have hosted guests, so they are kept. Mark them out of service instead.")
        Room.objects.filter(pk__in=[r.pk for r in removable[:to_remove]]).delete()


def set_room_type_active(room_type, active: bool):
    room_type.is_active = bool(active)
    room_type.save(update_fields=["is_active"])


def delete_room_type(room_type):
    if room_type.reservations.exists():
        raise RoomTypeError("Guests have booked this room type, so it is kept for the record. Hide it instead.")
    with transaction.atomic():
        if Room.objects.filter(room_type=room_type, assignments__isnull=False).exists():
            raise RoomTypeError("Some of these rooms have hosted guests, so the room type is kept. Hide it instead.")
        room_type.rooms.all().delete()
        room_type.delete()


def add_room_type_photo(room_type, url: str):
    url = str(url or "").strip()
    if not url.startswith(("http://", "https://")) or len(url) > 500:
        raise RoomTypeError("Upload the photo first.")
    if room_type.photos.count() >= MAX_PHOTOS:
        raise RoomTypeError(f"A room type can have up to {MAX_PHOTOS} photos.")
    position = (room_type.photos.order_by("-position").values_list("position", flat=True).first() or 0) + 1
    return RoomTypePhoto.objects.create(room_type=room_type, url=url, position=position)


def remove_room_type_photo(room_type, photo_id):
    try:
        photo_id = int(photo_id)
    except (TypeError, ValueError):
        photo_id = None
    deleted, _ = RoomTypePhoto.objects.filter(room_type=room_type, pk=photo_id).delete() if photo_id else (0, None)
    if not deleted:
        raise RoomTypeError("That photo was not found on this room type.")


def room_type_for(place, room_type_id):
    try:
        room_type_id = uuid.UUID(str(room_type_id))
    except (TypeError, ValueError):
        room_type_id = None
    room_type = RoomType.objects.filter(**{place_field(place): place}, pk=room_type_id).first() if room_type_id else None
    if room_type is None:
        raise RoomTypeError("Choose one of the room types here.")
    return room_type


# ---------------------------------------------------------------- stays and availability

def parse_stay(check_in, check_out, today=None):
    """The dates a guest asks for, as dates: from today, at most MAX_DAYS_AHEAD ahead, 1 to MAX_NIGHTS nights."""
    today = today or timezone.localdate()
    try:
        check_in = check_in if isinstance(check_in, date) else date.fromisoformat(str(check_in))
        check_out = check_out if isinstance(check_out, date) else date.fromisoformat(str(check_out))
    except (TypeError, ValueError):
        raise RoomTypeError("Choose your check-in and check-out dates.")
    if check_in < today:
        raise RoomTypeError("Check-in can't be in the past.")
    if check_in > today + timedelta(days=MAX_DAYS_AHEAD):
        raise RoomTypeError(f"Bookings open up to {MAX_DAYS_AHEAD} days ahead.")
    nights = (check_out - check_in).days
    if nights < 1:
        raise RoomTypeError("Check-out must be after check-in.")
    if nights > MAX_NIGHTS:
        raise RoomTypeError(f"Book up to {MAX_NIGHTS} nights at a time.")
    return check_in, check_out


def _live_reservations(room_type, now=None, exclude_id=None):
    now = now or timezone.now()
    qs = Reservation.objects.filter(room_type=room_type).filter(
        Q(status__in=[ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN])
        | Q(status=ReservationStatus.PENDING_PAYMENT, created_at__gte=now - timedelta(minutes=PAYMENT_HOLD_MINUTES))
    )
    return qs.exclude(pk=exclude_id) if exclude_id else qs


def sellable_rooms(room_type) -> int:
    return room_type.rooms.exclude(status__in=UNSELLABLE_ROOM_STATUSES).count()


def _channel_blocked(room_type, check_in: date, check_out: date) -> bool:
    """A guest house night blocked by a booking on another channel (Airbnb, Booking.com...) closes the whole house."""
    if not room_type.guest_house_id:
        return False
    from guest_houses.models import ChannelBlockedDate
    return ChannelBlockedDate.objects.filter(guest_house_id=room_type.guest_house_id, date__gte=check_in, date__lt=check_out).exists()


def rooms_free(room_type, check_in: date, check_out: date, exclude_id=None) -> int:
    """How many rooms of this type are free on every night from check_in to check_out."""
    total = sellable_rooms(room_type)
    if total == 0 or _channel_blocked(room_type, check_in, check_out):
        return 0
    overlapping = list(_live_reservations(room_type, exclude_id=exclude_id).filter(
        check_in__lt=check_out, check_out__gt=check_in,
    ).values_list("check_in", "check_out"))
    peak = 0
    night = check_in
    while night < check_out and peak < total:
        peak = max(peak, sum(1 for ci, co in overlapping if ci <= night < co))
        night += timedelta(days=1)
    return max(total - peak, 0)


def ensure_listed(room_type, *, guests: int):
    """Raises unless guests may book this room type online at all, and it sleeps `guests`."""
    place = room_type.place
    # Hotels are reviewed before guests can book them; guest houses have no review step, only take-downs.
    if not room_type.is_active or place.deleted_at is not None or (room_type.hotel_id and not place.verified):
        raise RoomTypeUnavailableError("This room type isn't open for booking right now.")
    if not 1 <= guests <= room_type.capacity:
        raise RoomTypeError(f"This room sleeps 1 to {room_type.capacity} guests.")


def ensure_free(room_type, check_in: date, check_out: date, exclude_id=None):
    """Raises unless a room of this type is free for the stay. Call with the room type row locked."""
    if rooms_free(room_type, check_in, check_out, exclude_id=exclude_id) < 1:
        raise RoomTypeUnavailableError("No room of this type is free for those dates. Try other dates or another room type.")


def quote(room_type, check_in: date, check_out: date) -> dict:
    from .services import compute_dynamic_rate
    pricing = compute_dynamic_rate(room_type=room_type, check_in=check_in, check_out=check_out, occupancy_rate=Decimal("0.5"))
    return {
        "nights": pricing["num_nights"],
        "subtotal_xaf": str(pricing["subtotal_xaf"]),
        "length_of_stay_discount_xaf": str(pricing["length_of_stay_discount_xaf"]),
        "last_minute_adjustment_applied": pricing["last_minute_adjustment_applied"],
        "total_xaf": str(pricing["total_xaf"]),
    }


def stay_options(place, check_in: date, check_out: date) -> list[dict]:
    """Each bookable room type of the place with how many rooms are free for the stay and what it would cost."""
    options = []
    for room_type in place.room_types.filter(is_active=True).select_related("hotel", "guest_house"):
        free = rooms_free(room_type, check_in, check_out)
        options.append({"room_type": str(room_type.id), "rooms_free": free, **quote(room_type, check_in, check_out)})
    return options


# ---------------------------------------------------------------- what the API shows

def _photos(room_type) -> list[dict]:
    return [{"id": p.id, "url": p.url} for p in room_type.photos.all()]


def room_type_data(room_type, *, for_owner=False) -> dict:
    rooms = list(room_type.rooms.all())
    data = {
        "id": str(room_type.id), "name": room_type.display_name, "category": room_type.category,
        "capacity": room_type.capacity, "base_rate_xaf": str(room_type.base_rate_xaf),
        "amenities": room_type.amenities or [], "bed_setup": room_type.bed_setup,
        "size_sqm": str(room_type.size_sqm) if room_type.size_sqm is not None else None,
        "description": room_type.description, "photos": _photos(room_type),
        "room_count": sum(1 for r in rooms if r.status not in UNSELLABLE_ROOM_STATUSES),
    }
    if for_owner:
        data["is_active"] = room_type.is_active
        data["total_rooms"] = len(rooms)
    return data


def room_types_data(place, *, for_owner=False) -> list[dict]:
    room_types = sorted(place.room_types.all(), key=lambda r: (r.base_rate_xaf, r.display_name))
    return [room_type_data(r, for_owner=for_owner) for r in room_types if for_owner or r.is_active]


def from_price(place):
    rates = [r.base_rate_xaf for r in place.room_types.all() if r.is_active]
    return str(min(rates)) if rates else None
