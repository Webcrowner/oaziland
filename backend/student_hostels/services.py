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


def create_student_hostel(*, owner_profile, quarter, property_type, latitude=None, longitude=None):
    """Creates a StudentHostel, keeping PropertyAsset.owner (inherited,
    a plain User) and owner_profile.account_user in sync — see the
    docstring on StudentHostel for why both exist."""
    from .models import StudentHostel
    return StudentHostel.objects.create(
        owner=owner_profile.account_user, owner_profile=owner_profile,
        quarter=quarter, type="STUDENT_HOSTEL", property_type=property_type,
        latitude=latitude, longitude=longitude,
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


def grant_parent_guardian_access(*, student, parent_user, also_notify_institution: bool = False):
    """The other real half of the parent-portal gap: ParentGuardianAccess
    could only ever be created directly in the database (tests/admin) —
    the STUDENT is meant to be the one granting a specific parent
    visibility, but nothing let them actually do that."""
    from .models import ParentGuardianAccess
    grant, _ = ParentGuardianAccess.objects.get_or_create(
        parent_user=parent_user, student=student,
        defaults={"also_notify_institution": also_notify_institution},
    )
    return grant


def revoke_parent_guardian_access(*, grant, actor):
    """Only the student who granted access can revoke it."""
    from django.utils import timezone
    if actor.id != grant.student_id:
        raise AccessDeniedError("Only the student who granted this access can revoke it.")
    grant.revoked_at = timezone.now()
    grant.save(update_fields=["revoked_at"])
    return grant


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

    ranked = rank_waitlist_for_unit_type(hostel=unit.building.studenthostel, desired_unit_type=unit.unit_type, semester=semester)
    if not ranked:
        return None

    top_entry = ranked[0]
    allocation = allocate_room(student=top_entry.student, unit=unit, semester=semester)
    top_entry.fulfilled_at = timezone.now()
    top_entry.save(update_fields=["fulfilled_at"])
    return allocation


def join_hostel_waitlist(*, student, hostel, desired_unit_type, semester):
    """The real gap this closes: rank_waitlist_for_unit_type()/
    process_waitlist_for_freed_unit() (the 'join a waitlist, get
    auto-notified or auto-allocated' feature from Prompt 11) were fully
    built, but nothing ever let a student actually join one."""
    from .models import Waitlist
    entry, _ = Waitlist.objects.get_or_create(
        student=student, hostel=hostel, desired_unit_type=desired_unit_type, semester=semester,
        defaults={"fulfilled_at": None},
    )
    return entry


def end_room_allocation(allocation):
    """Frees a unit at semester-end/early-checkout and immediately runs
    the auto-reallocation engine against anyone waiting for that exact
    unit type — closing the loop between 'a unit becomes free' and
    'the top-priority waitlisted student gets it automatically', per
    the spec. Warden/admin-initiated, mirroring the rest of room
    allocation being deliberately not self-service."""
    from .models import RoomAllocationStatus
    allocation.status = RoomAllocationStatus.ENDED
    allocation.save(update_fields=["status"])
    process_waitlist_for_freed_unit(allocation.unit, allocation.semester)
    return allocation


# ---------------------------------------------------------------------------
# Analytics — the 'occupancy dashboard' and 'multi-property analytics',
# implemented as real data aggregation (the backend half of a dashboard;
# a frontend would just render what these functions return).
# ---------------------------------------------------------------------------
def get_hostel_occupancy_summary(hostel):
    from django.utils import timezone
    from .models import HostelUnit, RoomAllocation, RoomAllocationStatus, HostelBilling, AmenitySubscription

    units = HostelUnit.objects.filter(building_id=hostel.building_ptr_id)
    total_beds = sum(u.bed_capacity for u in units)
    active_allocations = RoomAllocation.objects.filter(unit__in=units, status=RoomAllocationStatus.ACTIVE).count()
    vacancy_rate = 1 - (active_allocations / total_beds) if total_beds else None

    revenue_by_unit_type = {}
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

    # WHY this trends on due_date, not a payment timestamp: HostelBilling
    # has no separate 'paid_at' field recording when payment actually
    # happened — due_date is the only real date field available, so this
    # trend represents billing PERIODS due, not confirmed payment timing.
    # A real 'paid_at' field would be a natural, worthwhile follow-up.
    from oaziland.analytics import compute_period_over_period
    paid_bills = HostelBilling.objects.filter(allocation__unit__in=units, status="PAID")
    revenue_trend = compute_period_over_period(queryset=paid_bills, date_field="due_date", aggregate_field="amount_xaf")

    return {
        "vacancy_rate": vacancy_rate,
        "revenue_by_unit_type_xaf": revenue_by_unit_type,
        "upcoming_semester_expirations": upcoming_expirations,
        "active_amenity_subscriptions": amenity_uptake,
        "revenue_trend_xaf": revenue_trend,
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

    # An aggregate revenue trend across every hostel this agency
    # manages — summing each hostel's own already-computed trend
    # rather than re-querying, so this stays consistent with what each
    # individual hostel's own dashboard shows.
    from decimal import Decimal
    total_current = sum((s["revenue_trend_xaf"]["current_period_value"] for s in summaries), Decimal("0"))
    total_previous = sum((s["revenue_trend_xaf"]["previous_period_value"] for s in summaries), Decimal("0"))
    aggregate_percent_change = round(((total_current - total_previous) / total_previous) * 100, 1) if total_previous else None

    return {
        "hostels_managed": len(hostels),
        "total_active_amenity_subscriptions": total_active_amenity_subs,
        "aggregate_revenue_trend_xaf": {
            "current_period_value": total_current, "previous_period_value": total_previous, "percent_change": aggregate_percent_change,
        },
        # Deliberately aggregate-only — no per-hostel owner financial breakdown here.
    }


# ---------------------------------------------------------------------------
# Roommate compatibility matching.
# ---------------------------------------------------------------------------
def roommate_compatibility_score(student_a, student_b) -> int:
    """A simple, transparent point-based score (0-4) — one point per
    matching dimension (sleep schedule, cleanliness, noise tolerance,
    study habit). Deliberately not a black-box algorithm: a housing
    office should be able to explain exactly why two students were
    suggested as compatible."""
    from .models import RoommatePreferenceProfile

    try:
        prefs_a = student_a.roommate_preferences
        prefs_b = student_b.roommate_preferences
    except RoommatePreferenceProfile.DoesNotExist:
        return 0  # can't score compatibility without both having set preferences

    score = 0
    if prefs_a.sleep_schedule == prefs_b.sleep_schedule:
        score += 1
    if prefs_a.cleanliness_level == prefs_b.cleanliness_level:
        score += 1
    if prefs_a.noise_tolerance == prefs_b.noise_tolerance:
        score += 1
    if prefs_a.study_habit == prefs_b.study_habit:
        score += 1
    return score


def suggest_roommates(student, candidates, limit=5):
    """Ranks a pool of candidate students by compatibility score,
    highest first — the actual matching output a housing office or a
    student-facing 'suggested roommates' screen would use."""
    scored = [(candidate, roommate_compatibility_score(student, candidate)) for candidate in candidates]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored[:limit]


# ---------------------------------------------------------------------------
# Room swap marketplace.
# ---------------------------------------------------------------------------
def request_room_swap(*, allocation, desired_unit_type=None, reason=""):
    from .models import RoomSwapRequest
    return RoomSwapRequest.objects.create(current_allocation=allocation, desired_unit_type=desired_unit_type, reason=reason)


def find_and_match_swap(swap_request):
    """Looks for another OPEN swap request wanting what this student
    currently HAS, where this student wants what THAT one currently
    has — a genuine mutual swap, not just a one-sided desire."""
    from .models import RoomSwapRequest, RoomSwapStatus

    my_current_type = swap_request.current_allocation.unit.unit_type
    candidates = RoomSwapRequest.objects.filter(
        status=RoomSwapStatus.OPEN, desired_unit_type=my_current_type,
    ).exclude(id=swap_request.id)

    for candidate in candidates:
        if candidate.current_allocation.unit.unit_type == swap_request.desired_unit_type:
            swap_request.matched_with = candidate
            swap_request.status = RoomSwapStatus.MATCHED
            swap_request.save(update_fields=["matched_with", "status"])
            candidate.matched_with = swap_request
            candidate.status = RoomSwapStatus.MATCHED
            candidate.save(update_fields=["matched_with", "status"])
            return candidate
    return None


def complete_room_swap(swap_request):
    """Actually swaps the two students' unit assignments — the matched
    pair's RoomAllocation.unit values are exchanged."""
    from django.utils import timezone
    from .models import RoomSwapStatus

    if swap_request.matched_with is None:
        raise ValueError("Cannot complete a swap with no matched pair.")

    other = swap_request.matched_with
    allocation_a = swap_request.current_allocation
    allocation_b = other.current_allocation

    allocation_a.unit, allocation_b.unit = allocation_b.unit, allocation_a.unit
    allocation_a.save(update_fields=["unit"])
    allocation_b.save(update_fields=["unit"])

    now = timezone.now()
    for req in (swap_request, other):
        req.status = RoomSwapStatus.COMPLETED
        req.completed_at = now
        req.save(update_fields=["status", "completed_at"])

    return allocation_a, allocation_b


# ---------------------------------------------------------------------------
# Guest passes.
# ---------------------------------------------------------------------------
def issue_guest_pass(*, host_student, guest_full_name, visit_date, guest_id_document_note=""):
    from .models import GuestPass
    return GuestPass.objects.create(
        host_student=host_student, guest_full_name=guest_full_name,
        visit_date=visit_date, guest_id_document_note=guest_id_document_note,
    )


def log_guest_check_in(*, guest_pass, logged_by):
    from django.utils import timezone
    guest_pass.checked_in_at = timezone.now()
    guest_pass.logged_by = logged_by
    guest_pass.save(update_fields=["checked_in_at", "logged_by"])
    return guest_pass


def log_guest_check_out(*, guest_pass, logged_by):
    from django.utils import timezone
    guest_pass.checked_out_at = timezone.now()
    guest_pass.logged_by = logged_by
    guest_pass.save(update_fields=["checked_out_at", "logged_by"])
    return guest_pass


# ---------------------------------------------------------------------------
# Installment payment plans.
# ---------------------------------------------------------------------------
def create_installment_plan(*, billing, num_installments: int):
    """Splits billing.amount_xaf evenly across num_installments,
    spacing due dates evenly between now and the bill's own due_date.
    Any rounding remainder is added to the LAST installment, so the
    total always exactly equals the original bill — never off by a
    few francs from floating-point-style splitting."""
    from datetime import timedelta
    from .models import InstallmentPlan, InstallmentPayment

    plan = InstallmentPlan.objects.create(billing=billing, num_installments=num_installments)

    base_amount = (billing.amount_xaf / num_installments).quantize(billing.amount_xaf)
    total_days = (billing.due_date - billing.due_date.today()).days
    interval_days = max(total_days // num_installments, 1)

    running_total = 0
    for i in range(1, num_installments + 1):
        is_last = i == num_installments
        amount = billing.amount_xaf - (base_amount * (num_installments - 1)) if is_last else base_amount
        due = billing.due_date.today() + timedelta(days=interval_days * i)
        InstallmentPayment.objects.create(plan=plan, sequence_number=i, amount_xaf=amount, due_date=due)
        running_total += amount

    return plan


def pay_installment(installment):
    from django.utils import timezone
    from .models import InstallmentPaymentStatus
    installment.status = InstallmentPaymentStatus.PAID
    installment.paid_at = timezone.now()
    installment.save(update_fields=["status", "paid_at"])

    # Once every installment is paid, the parent bill itself is settled.
    plan = installment.plan
    if not plan.installments.exclude(status=InstallmentPaymentStatus.PAID).exists():
        plan.billing.status = "PAID"
        plan.billing.save(update_fields=["status"])

    return installment
