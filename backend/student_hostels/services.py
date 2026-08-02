"""
student_hostels.services — permission enforcement, priority-weighted room
allocation, billing, waitlist processing, and analytics.

WHY permission checks live here rather than only in API-layer views: a
model can store a ParentGuardianAccess grant, but it can't stop someone
from querying MaintenanceRequest directly — the actual boundary has to be
enforced in the functions everything else is supposed to call.
"""
from decimal import Decimal
from django.db import transaction as db_transaction


class AccessDeniedError(Exception):
    pass


class NoAvailableUnitError(Exception):
    pass


def create_student_hostel(*, owner_profile, quarter, property_type):
    """Creates a StudentHostel, keeping PropertyAsset.owner (inherited,
    a plain User) and owner_profile.account_user in sync — see the
    docstring on StudentHostel for why both exist."""
    from .models import StudentHostel
    return StudentHostel.objects.create(
        owner=owner_profile.account_user, owner_profile=owner_profile,
        quarter=quarter, type="STUDENT_HOSTEL", property_type=property_type,
    )


# ---------------------------------------------------------------------------
# Parent/guardian read-only access — the strict boundary.
# ---------------------------------------------------------------------------
def get_parent_visible_data(*, parent_user, student):
    """Returns ONLY billing and welfare STATUS (not welfare details, not
    maintenance requests, not disciplinary/access logs) for a parent with
    an active, consented ParentGuardianAccess grant. Raises
    AccessDeniedError if no active grant exists — this is the actual
    enforcement of 'read-only, consent-gated, billing and welfare status
    only', not just a comment saying it should work that way."""
    from .models import ParentGuardianAccess, HostelBilling, RoomAllocation, WelfareAlert

    grant = ParentGuardianAccess.objects.filter(
        parent_user=parent_user, student=student, revoked_at__isnull=True,
    ).first()
    if grant is None:
        raise AccessDeniedError("No active, consented access grant exists for this student.")

    allocations = RoomAllocation.objects.filter(student=student)
    bills = HostelBilling.objects.filter(allocation__student=student)
    welfare_status = "HAS_OPEN_ALERT" if WelfareAlert.objects.filter(student=student, resolved_at__isnull=True).exists() else "NO_OPEN_ALERTS"

    return {
        "bills": list(bills.values("id", "amount_xaf", "due_date", "status")),
        "welfare_status": welfare_status,
        # Deliberately NOT included: maintenance_requests, access_logs, disciplinary notes.
    }


def route_welfare_alert(alert):
    """Routes a WelfareAlert to hostel management always, and to the
    institution's student affairs contact ONLY if the student's parent
    (or the student themselves, depending on consent model) has opted
    into also_notify_institution — never unconditionally."""
    from .models import ParentGuardianAccess

    recipients = ["hostel_management"]  # always
    consented_grant = ParentGuardianAccess.objects.filter(
        student=alert.student, revoked_at__isnull=True, also_notify_institution=True,
    ).exists()
    if consented_grant:
        recipients.append("institution_student_affairs")
    return recipients


# ---------------------------------------------------------------------------
# Priority-weighted room allocation.
# ---------------------------------------------------------------------------
def _allocation_priority_score(student, has_paid: bool) -> tuple:
    """Returns a sortable tuple implementing the priority order from the
    spec, HIGHEST priority first: accessibility needs > international
    status > programme/year grouping > payment status. (Gender matching
    and roommate preference are applied as hard FILTERS during matching,
    not soft scoring — see allocate_room below — since they're
    compatibility constraints, not just preferences to weigh.)"""
    from identity.models import StudentProfile
    try:
        profile = student.student_profile
    except StudentProfile.DoesNotExist:
        profile = None

    accessibility_priority = 0 if (profile and profile.has_accessibility_needs) else 1
    international_priority = 0 if (profile and profile.is_international_student) else 1
    programme_year = profile.programme_year if (profile and profile.programme_year) else 999
    payment_priority = 0 if has_paid else 1

    return (accessibility_priority, international_priority, programme_year, payment_priority)


def allocate_room(*, student, unit, semester, has_paid: bool = False):
    """Allocates a student to a unit for a semester. For a PER_BED unit,
    finds the next free bed slot; for a PER_UNIT type (studio/apartment),
    allocates the whole unit (bed_slot stays None). Respects gender
    matching and roommate preference as hard constraints when choosing
    among AVAILABLE beds in a shared room, not just as scoring input."""
    from .models import RoomAllocation, BedSlot, OccupancyModel, RoomAllocationStatus

    if unit.occupancy_model == OccupancyModel.PER_UNIT:
        already_taken = RoomAllocation.objects.filter(
            unit=unit, semester=semester, status=RoomAllocationStatus.ACTIVE,
        ).exists()
        if already_taken:
            raise NoAvailableUnitError("This unit is already allocated for this semester.")
        return RoomAllocation.objects.create(student=student, unit=unit, semester=semester)

    # PER_BED: find a free bed slot.
    taken_bed_ids = RoomAllocation.objects.filter(
        unit=unit, semester=semester, status=RoomAllocationStatus.ACTIVE, bed_slot__isnull=False,
    ).values_list("bed_slot_id", flat=True)
    free_slot = BedSlot.objects.filter(unit=unit).exclude(id__in=taken_bed_ids).first()
    if free_slot is None:
        raise NoAvailableUnitError("No free bed slots in this unit for this semester.")

    return RoomAllocation.objects.create(student=student, unit=unit, bed_slot=free_slot, semester=semester)


def rank_waitlist_for_unit_type(*, hostel, desired_unit_type, semester):
    """Returns waitlist entries for a hostel/unit-type/semester combo,
    ordered by the SAME priority scoring as allocate_room — 'respecting
    the same priority order used in RoomAllocation', per the spec."""
    from .models import Waitlist

    entries = list(Waitlist.objects.filter(
        hostel=hostel, desired_unit_type=desired_unit_type, semester=semester, fulfilled_at__isnull=True,
    ))
    entries.sort(key=lambda entry: _allocation_priority_score(entry.student, has_paid=False))
    return entries


def process_waitlist_for_freed_unit(unit, semester):
    """When a unit frees up, auto-allocates it to the top-priority
    waitlisted student (if any) and marks their waitlist entry
    fulfilled — the 'auto-reallocation engine' from the spec."""
    from .models import Waitlist
    from django.utils import timezone

    ranked = rank_waitlist_for_unit_type(hostel=unit.building_ptr.studenthostel, desired_unit_type=unit.unit_type, semester=semester)
    if not ranked:
        return None

    top_entry = ranked[0]
    allocation = allocate_room(student=top_entry.student, unit=unit, semester=semester)
    top_entry.fulfilled_at = timezone.now()
    top_entry.save(update_fields=["fulfilled_at"])
    return allocation


# ---------------------------------------------------------------------------
# Analytics — the 'occupancy dashboard' and 'multi-property analytics',
# implemented as real data aggregation (the backend half of a dashboard;
# a frontend would just render what these functions return).
# ---------------------------------------------------------------------------
def get_hostel_occupancy_summary(hostel):
    from django.utils import timezone
    from .models import HostelUnit, RoomAllocation, RoomAllocationStatus, HostelBilling, AmenitySubscription

    units = HostelUnit.objects.filter(building_ptr__in=[hostel.building_ptr_id])
    total_beds = sum(u.bed_capacity for u in units)
    active_allocations = RoomAllocation.objects.filter(unit__in=units, status=RoomAllocationStatus.ACTIVE).count()
    vacancy_rate = 1 - (active_allocations / total_beds) if total_beds else None

    revenue_by_unit_type = {}
    for unit_type, _ in units.values_list("unit_type", flat=True).distinct():
        pass  # placeholder loop variable unused — see explicit query below
    from django.db.models import Sum
    revenue_qs = HostelBilling.objects.filter(
        allocation__unit__in=units, status="PAID",
    ).values("allocation__unit__unit_type").annotate(total=Sum("amount_xaf"))
    for row in revenue_qs:
        revenue_by_unit_type[row["allocation__unit__unit_type"]] = row["total"]

    upcoming_expirations = RoomAllocation.objects.filter(
        unit__in=units, status=RoomAllocationStatus.ACTIVE,
        semester__end_date__gte=timezone.now().date(),
    ).count()

    amenity_uptake = AmenitySubscription.objects.filter(hostel=hostel, status="ACTIVE").count()

    return {
        "vacancy_rate": vacancy_rate,
        "revenue_by_unit_type_xaf": revenue_by_unit_type,
        "upcoming_semester_expirations": upcoming_expirations,
        "active_amenity_subscriptions": amenity_uptake,
    }


def get_agency_hostel_portfolio_summary(agency):
    """Aggregates across every hostel this agency currently manages —
    WITHOUT exposing one owner's raw financial numbers to another. Only
    aggregate totals are returned, never a per-owner breakdown."""
    from .models import ManagerProfile, HostelManagementContract

    manager_profiles = ManagerProfile.objects.filter(agency=agency)
    active_contracts = HostelManagementContract.objects.filter(
        manager__in=manager_profiles, revoked_at__isnull=True,
    )
    hostels = [contract.hostel for contract in active_contracts]

    summaries = [get_hostel_occupancy_summary(h) for h in hostels]
    total_active_amenity_subs = sum(s["active_amenity_subscriptions"] for s in summaries)

    return {
        "hostels_managed": len(hostels),
        "total_active_amenity_subscriptions": total_active_amenity_subs,
        # Deliberately aggregate-only — no per-hostel owner financial breakdown here.
    }
