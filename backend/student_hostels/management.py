"""
student_hostels.management — running a hostel's rooms: who may do it, setting up partner institutions,
semesters and rooms (with their beds), and placing students in rooms.

The hostel's owner, or a manager on an active FULL or BOOKINGS_ONLY contract, manages their own hostels;
a platform admin can manage any hostel. Allocation still goes through services.allocate_room (bed matching)
and end_room_allocation (which hands a freed place to the top of the waitlist).
"""
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import (
    BedSlot, HostelUnit, HostelUnitType, ManagementScope, OccupancyModel, PartnerInstitution, RoomAllocation,
    RoomAllocationStatus, Semester, StudentHostel, Waitlist,
)
from .services import NoAvailableUnitError, _notify_student, allocate_room, end_room_allocation, rank_waitlist_for_unit_type

MAX_BEDS_PER_ROOM = 20
MAX_REASON_LENGTH = 300
BOOKING_SCOPES = (ManagementScope.FULL, ManagementScope.BOOKINGS_ONLY)


class HostelManagementError(Exception):
    pass


# ---------------------------------------------------------------- who may manage

def _is_admin(user) -> bool:
    return bool(user and user.is_authenticated and hasattr(user, "admin_profile"))


def hostels_managed_by(user):
    """Every hostel this person may run rooms for: all of them for an admin, otherwise the ones they own or manage."""
    today = timezone.localdate()
    qs = StudentHostel.objects.select_related("quarter", "owner")
    if _is_admin(user):
        return qs
    managed = Q(
        management_contracts__manager__account_user=user, management_contracts__revoked_at__isnull=True,
        management_contracts__scope__in=BOOKING_SCOPES,
    ) & (Q(management_contracts__end_date__isnull=True) | Q(management_contracts__end_date__gte=today))
    return qs.filter(Q(owner=user) | managed).distinct()


def can_manage(user, hostel) -> bool:
    return hostels_managed_by(user).filter(pk=hostel.pk).exists()


def hostel_label(hostel) -> str:
    owner = hostel.owner.full_name or hostel.owner.username
    return f"{hostel.quarter.name} \u00b7 {owner}"


# ---------------------------------------------------------------- set-up

def add_institution(hostel, name: str):
    name = " ".join((name or "").split())
    if not name:
        raise HostelManagementError("Enter the institution's name.")
    if len(name) > 200:
        raise HostelManagementError("The institution's name must be 200 characters or fewer.")
    institution = PartnerInstitution.objects.filter(name__iexact=name).first() or PartnerInstitution.objects.create(name=name)
    hostel.institution_partnerships.add(institution)
    return institution


def remove_institution(hostel, institution):
    in_use = RoomAllocation.objects.filter(
        unit__building_id=hostel.building_ptr_id, semester__institution=institution, status=RoomAllocationStatus.ACTIVE,
    ).exists()
    if in_use:
        raise HostelManagementError("Students are housed under this institution's semesters. End those allocations first.")
    hostel.institution_partnerships.remove(institution)


def create_semester(hostel, *, institution_id, name: str, start_date, end_date, billing_due_date):
    institution = hostel.institution_partnerships.filter(pk=institution_id).first()
    if institution is None:
        raise HostelManagementError("Add the institution to this hostel first.")
    name = " ".join((name or "").split())
    if not name or len(name) > 100:
        raise HostelManagementError("Give the semester a name of up to 100 characters.")
    if end_date <= start_date:
        raise HostelManagementError("The semester must end after it starts.")
    if not (start_date - timedelta(days=90) <= billing_due_date <= end_date):
        raise HostelManagementError("The billing date must fall between 90 days before the start and the end of the semester.")
    if Semester.objects.filter(institution=institution, name__iexact=name).exists():
        raise HostelManagementError("This institution already has a semester with that name.")
    return Semester.objects.create(
        institution=institution, name=name, start_date=start_date, end_date=end_date, billing_due_date=billing_due_date,
    )


def create_unit(hostel, *, room_code: str, unit_type: str, occupancy_model: str, bed_capacity: int):
    room_code = (room_code or "").strip()
    if not room_code or len(room_code) > 50:
        raise HostelManagementError("Give the room a code of up to 50 characters, e.g. A-101.")
    if unit_type not in HostelUnitType.values or occupancy_model not in OccupancyModel.values:
        raise HostelManagementError("Choose a room type and how it is let.")
    if occupancy_model == OccupancyModel.PER_UNIT:
        bed_capacity = 1
    if not isinstance(bed_capacity, int) or not 1 <= bed_capacity <= MAX_BEDS_PER_ROOM:
        raise HostelManagementError(f"A room has between 1 and {MAX_BEDS_PER_ROOM} beds.")
    if HostelUnit.objects.filter(building_id=hostel.building_ptr_id, room_code__iexact=room_code).exists():
        raise HostelManagementError("This hostel already has a room with that code.")
    with transaction.atomic():
        unit = HostelUnit.objects.create(
            building_id=hostel.building_ptr_id, room_code=room_code, unit_type=unit_type,
            occupancy_model=occupancy_model, bed_capacity=bed_capacity,
        )
        if occupancy_model == OccupancyModel.PER_BED:
            BedSlot.objects.bulk_create(BedSlot(unit=unit, bed_number=n) for n in range(1, bed_capacity + 1))
    return unit


def delete_unit(unit):
    if unit.allocations.exists():
        raise HostelManagementError("Students have been housed in this room, so it is kept for the record.")
    unit.delete()


# ---------------------------------------------------------------- placing students

def find_student(identifier: str):
    from identity.models import User

    identifier = (identifier or "").strip()
    if not identifier:
        return None
    return User.objects.filter(Q(username__iexact=identifier) | Q(phone=identifier), deleted_at__isnull=True).first()


def _semester_for(hostel, semester_id):
    semester = Semester.objects.filter(pk=semester_id, institution__partner_hostels=hostel).first()
    if semester is None:
        raise HostelManagementError("Choose one of this hostel's semesters.")
    return semester


def _unit_for(hostel, unit_id):
    unit = HostelUnit.objects.filter(pk=unit_id, building_id=hostel.building_ptr_id).first()
    if unit is None:
        raise HostelManagementError("Choose one of this hostel's rooms.")
    return unit


def allocate_student(hostel, *, student, unit_id, semester_id, by):
    """Puts a student in a room for a semester. The student keeps one room per semester; their waitlist entry
    for this hostel and semester, if any, is marked fulfilled."""
    if student is None:
        raise HostelManagementError("No account was found with that username or phone number.")
    if _is_admin(student):
        raise HostelManagementError("Administrator accounts cannot be given a room.")
    semester = _semester_for(hostel, semester_id)
    unit = _unit_for(hostel, unit_id)
    with transaction.atomic():
        already = RoomAllocation.objects.select_for_update().filter(
            student=student, semester=semester, status=RoomAllocationStatus.ACTIVE,
        ).select_related("unit").first()
        if already:
            raise HostelManagementError(f"This student already has a room this semester ({already.unit.room_code}). Move them instead.")
        try:
            allocation = allocate_room(student=student, unit=unit, semester=semester)
        except NoAvailableUnitError:
            raise HostelManagementError("This room is full for that semester.") from None
        RoomAllocation.objects.filter(pk=allocation.pk).update(allocated_by=by)
        Waitlist.objects.filter(student=student, hostel=hostel, semester=semester, fulfilled_at__isnull=True).update(fulfilled_at=timezone.now())
    allocation.refresh_from_db()
    _notify_student(student, "You have a room", f"You were given a place in {unit.room_code} for {semester.name}.", allocation)
    return allocation


def end_allocation(allocation, *, by, reason: str):
    reason = (reason or "").strip()
    if not reason:
        raise HostelManagementError("Say why the allocation is ending; the student will see it.")
    if len(reason) > MAX_REASON_LENGTH:
        raise HostelManagementError("The reason must be 300 characters or fewer.")
    with transaction.atomic():
        locked = RoomAllocation.objects.select_for_update().select_related("unit", "semester", "student").get(pk=allocation.pk)
        if locked.status != RoomAllocationStatus.ACTIVE:
            raise HostelManagementError("This allocation has already ended.")
        ended = end_room_allocation(locked, by=by, reason=reason)
    _notify_student(ended.student, "Your room allocation has ended", f"Your place in {ended.unit.room_code} for {ended.semester.name} has ended. Reason: {reason}", ended)
    return ended


def move_allocation(allocation, *, unit_id, by):
    """Moves a housed student to another room in the same hostel and semester; the room they leave goes to the waitlist."""
    with transaction.atomic():
        locked = RoomAllocation.objects.select_for_update().select_related("unit__building", "semester", "student").get(pk=allocation.pk)
        if locked.status != RoomAllocationStatus.ACTIVE:
            raise HostelManagementError("This allocation has already ended.")
        hostel = StudentHostel.objects.get(building_ptr_id=locked.unit.building_id)
        target = _unit_for(hostel, unit_id)
        if target.pk == locked.unit_id:
            raise HostelManagementError("The student is already in this room.")
        try:
            new = allocate_room(student=locked.student, unit=target, semester=locked.semester)
        except NoAvailableUnitError:
            raise HostelManagementError("That room is full for this semester.") from None
        RoomAllocation.objects.filter(pk=new.pk).update(allocated_by=by)
        end_room_allocation(locked, by=by, reason=f"Moved to {target.room_code}")
    new.refresh_from_db()
    _notify_student(locked.student, "You have moved room", f"You now have a place in {target.room_code} for {locked.semester.name}.", new)
    return new


# ---------------------------------------------------------------- what the screen shows

def _person(user):
    if user is None:
        return None
    return {"id": str(user.pk), "name": user.full_name or user.username, "username": user.username, "phone": user.phone}


def hostel_summary(hostel) -> dict:
    units = HostelUnit.objects.filter(building_id=hostel.building_ptr_id)
    places = sum(u.bed_capacity if u.occupancy_model == OccupancyModel.PER_BED else 1 for u in units)
    today = timezone.localdate()
    housed = RoomAllocation.objects.filter(
        unit__building_id=hostel.building_ptr_id, status=RoomAllocationStatus.ACTIVE,
        semester__start_date__lte=today, semester__end_date__gte=today,
    ).count()
    waiting = Waitlist.objects.filter(hostel=hostel, fulfilled_at__isnull=True).count()
    return {
        "id": str(hostel.pk), "label": hostel_label(hostel), "quarter": hostel.quarter.name, "owner": _person(hostel.owner),
        "rooms": units.count(), "places": places, "housed_now": housed, "waiting": waiting,
    }


def hostel_board(hostel, semester_id=None) -> dict:
    """Rooms and beds, with who holds each place in the chosen semester (the current one, or the latest, by default)."""
    institutions = list(hostel.institution_partnerships.order_by("name"))
    semesters = list(Semester.objects.filter(institution__in=institutions).select_related("institution").order_by("-start_date"))
    semester = next((s for s in semesters if str(s.pk) == str(semester_id)), None) if semester_id else None
    if semester is None and semesters:
        today = timezone.localdate()
        semester = next((s for s in semesters if s.start_date <= today <= s.end_date), semesters[0])

    allocations = {}
    if semester:
        for allocation in RoomAllocation.objects.filter(
            unit__building_id=hostel.building_ptr_id, semester=semester, status=RoomAllocationStatus.ACTIVE,
        ).select_related("student", "allocated_by"):
            allocations.setdefault(allocation.unit_id, []).append(allocation)

    def allocation_row(allocation):
        return {
            "id": str(allocation.pk), "student": _person(allocation.student), "allocated_at": allocation.allocated_at,
            "allocated_by": allocation.allocated_by.username if allocation.allocated_by else "",
        }

    rooms = []
    for unit in HostelUnit.objects.filter(building_id=hostel.building_ptr_id).prefetch_related("bed_slots").order_by("room_code"):
        held = allocations.get(unit.pk, [])
        if unit.occupancy_model == OccupancyModel.PER_BED:
            by_bed = {a.bed_slot_id: a for a in held}
            places = [
                {"bed": bed.bed_number, "allocation": allocation_row(by_bed[bed.pk]) if bed.pk in by_bed else None}
                for bed in sorted(unit.bed_slots.all(), key=lambda b: b.bed_number)
            ]
        else:
            places = [{"bed": None, "allocation": allocation_row(held[0]) if held else None}]
        rooms.append({
            "id": str(unit.pk), "room_code": unit.room_code, "unit_type": unit.unit_type, "occupancy_model": unit.occupancy_model,
            "places": places, "has_history": unit.allocations.exists(),
        })

    return {
        "hostel": hostel_summary(hostel),
        "institutions": [{"id": i.pk, "name": i.name} for i in institutions],
        "semesters": [
            {"id": s.pk, "name": s.name, "institution": s.institution.name, "start_date": s.start_date, "end_date": s.end_date,
             "billing_due_date": s.billing_due_date}
            for s in semesters
        ],
        "semester_id": semester.pk if semester else None,
        "rooms": rooms,
        "waitlist": waitlist_rows(hostel, semester) if semester else [],
    }


def waitlist_rows(hostel, semester) -> list[dict]:
    """Who is waiting for this hostel this semester, in the order the allocation engine would serve them."""
    housed = set(RoomAllocation.objects.filter(semester=semester, status=RoomAllocationStatus.ACTIVE).values_list("student_id", flat=True))
    rows = []
    for unit_type in Waitlist.objects.filter(hostel=hostel, semester=semester, fulfilled_at__isnull=True).values_list("desired_unit_type", flat=True).distinct():
        for position, entry in enumerate(rank_waitlist_for_unit_type(hostel=hostel, desired_unit_type=unit_type, semester=semester), start=1):
            rows.append({
                "id": str(entry.pk), "position": position, "desired_unit_type": entry.desired_unit_type, "joined_at": entry.joined_at,
                "student": _person(entry.student), "already_housed": entry.student_id in housed,
            })
    return sorted(rows, key=lambda r: (r["desired_unit_type"], r["position"]))
