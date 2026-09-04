"""
Tests for roommate matching, room swaps, guest passes, and installment
payment plans — the catalogue document's Part 2 dedicated-behavior items.
"""
import pytest
from decimal import Decimal
from datetime import date, timedelta

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from student_hostels.models import (
    OwnerProfile, OwnerType, StudentHostel, HostelPropertyType, HostelUnit, HostelUnitType,
    OccupancyModel, BedSlot, Semester, PartnerInstitution, RoomAllocation,
    RoommatePreferenceProfile, SleepSchedule, CleanlinessLevel, NoiseTolerance, StudyHabit,
    RoomSwapStatus, HostelBilling, BillingCycle, HostelBillingStatus,
)
from student_hostels.services import (
    create_student_hostel, allocate_room, roommate_compatibility_score, suggest_roommates,
    request_room_swap, find_and_match_swap, complete_room_swap,
    issue_guest_pass, log_guest_check_in, log_guest_check_out,
    create_installment_plan, pay_installment,
)


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Messassi District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Messassi")
    return Quarter.objects.create(village_or_district=village, name="Messassi")


@pytest.fixture
def hostel(db, quarter):
    owner_user = User.objects.create(username="part2_hostel_owner", phone="+237699990001")
    owner = OwnerProfile.objects.create(account_user=owner_user, owner_type=OwnerType.LANDLORD)
    return create_student_hostel(owner_profile=owner, quarter=quarter, property_type=HostelPropertyType.BLOCK)


@pytest.fixture
def semester(db):
    institution = PartnerInstitution.objects.create(name="ICT University")
    return Semester.objects.create(institution=institution, name="2026/2027 First Semester", start_date=date(2026, 9, 1), end_date=date(2027, 1, 31), billing_due_date=date(2026, 9, 15))


@pytest.mark.django_db
def test_roommate_compatibility_scoring(hostel):
    student_a = User.objects.create(username="roommate_a", phone="+237699990002")
    student_b = User.objects.create(username="roommate_b", phone="+237699990003")
    student_c = User.objects.create(username="roommate_c", phone="+237699990004")

    RoommatePreferenceProfile.objects.create(student=student_a, sleep_schedule=SleepSchedule.EARLY_BIRD, cleanliness_level=CleanlinessLevel.VERY_TIDY, noise_tolerance=NoiseTolerance.QUIET_PREFERRED, study_habit=StudyHabit.LIBRARY_ONLY)
    RoommatePreferenceProfile.objects.create(student=student_b, sleep_schedule=SleepSchedule.EARLY_BIRD, cleanliness_level=CleanlinessLevel.VERY_TIDY, noise_tolerance=NoiseTolerance.TOLERANT, study_habit=StudyHabit.IN_ROOM)
    RoommatePreferenceProfile.objects.create(student=student_c, sleep_schedule=SleepSchedule.NIGHT_OWL, cleanliness_level=CleanlinessLevel.RELAXED, noise_tolerance=NoiseTolerance.TOLERANT, study_habit=StudyHabit.IN_ROOM)

    score_ab = roommate_compatibility_score(student_a, student_b)  # matches on sleep + cleanliness = 2
    score_ac = roommate_compatibility_score(student_a, student_c)  # matches on nothing = 0
    assert score_ab == 2
    assert score_ac == 0

    suggestions = suggest_roommates(student_a, [student_b, student_c])
    assert suggestions[0][0] == student_b  # the more compatible one ranks first


@pytest.mark.django_db
def test_roommate_score_without_preferences_set_is_zero(hostel):
    student_a = User.objects.create(username="no_prefs_a", phone="+237699990005")
    student_b = User.objects.create(username="no_prefs_b", phone="+237699990006")
    assert roommate_compatibility_score(student_a, student_b) == 0


@pytest.mark.django_db
def test_mutual_room_swap_completes_correctly(hostel, semester):
    shared_room = HostelUnit.objects.create(building=hostel.building_ptr, room_code="A-1", unit_type=HostelUnitType.SHARED_ROOM, occupancy_model=OccupancyModel.PER_BED, bed_capacity=2)
    studio = HostelUnit.objects.create(building=hostel.building_ptr, room_code="B-1", unit_type=HostelUnitType.STUDIO, occupancy_model=OccupancyModel.PER_UNIT)
    BedSlot.objects.create(unit=shared_room, bed_number=1)

    student_in_room = User.objects.create(username="swap_student_room", phone="+237699990007")
    student_in_studio = User.objects.create(username="swap_student_studio", phone="+237699990008")

    allocation_room = allocate_room(student=student_in_room, unit=shared_room, semester=semester)
    allocation_studio = allocate_room(student=student_in_studio, unit=studio, semester=semester)

    swap_a = request_room_swap(allocation=allocation_room, desired_unit_type=HostelUnitType.STUDIO)
    swap_b = request_room_swap(allocation=allocation_studio, desired_unit_type=HostelUnitType.SHARED_ROOM)

    matched = find_and_match_swap(swap_a)
    assert matched == swap_b
    swap_a.refresh_from_db()
    assert swap_a.status == RoomSwapStatus.MATCHED

    complete_room_swap(swap_a)
    allocation_room.refresh_from_db()
    allocation_studio.refresh_from_db()
    assert allocation_room.unit == studio  # they actually swapped
    assert allocation_studio.unit == shared_room


@pytest.mark.django_db
def test_guest_pass_check_in_and_out():
    student = User.objects.create(username="guest_host_student", phone="+237699990009")
    security_staff = User.objects.create(username="guest_security", phone="+237699990010")

    guest_pass = issue_guest_pass(host_student=student, guest_full_name="Jane Visitor", visit_date=date.today(), guest_id_document_note="National ID ****4821")
    assert guest_pass.checked_in_at is None

    log_guest_check_in(guest_pass=guest_pass, logged_by=security_staff)
    guest_pass.refresh_from_db()
    assert guest_pass.checked_in_at is not None
    assert guest_pass.logged_by == security_staff

    log_guest_check_out(guest_pass=guest_pass, logged_by=security_staff)
    guest_pass.refresh_from_db()
    assert guest_pass.checked_out_at is not None


@pytest.mark.django_db
def test_installment_plan_splits_evenly_and_totals_correctly(hostel, semester):
    unit = HostelUnit.objects.create(building=hostel.building_ptr, room_code="C-1", unit_type=HostelUnitType.SELF_CONTAIN, occupancy_model=OccupancyModel.PER_UNIT)
    student = User.objects.create(username="installment_student", phone="+237699990011")
    allocation = allocate_room(student=student, unit=unit, semester=semester)
    billing = HostelBilling.objects.create(allocation=allocation, billing_cycle=BillingCycle.SEMESTER, amount_xaf=Decimal("300000"), due_date=date.today() + timedelta(days=90))

    plan = create_installment_plan(billing=billing, num_installments=3)
    installments = list(plan.installments.all())

    assert len(installments) == 3
    total = sum(i.amount_xaf for i in installments)
    assert total == billing.amount_xaf  # exact total, no rounding loss


@pytest.mark.django_db
def test_paying_all_installments_settles_the_parent_bill(hostel, semester):
    unit = HostelUnit.objects.create(building=hostel.building_ptr, room_code="D-1", unit_type=HostelUnitType.SELF_CONTAIN, occupancy_model=OccupancyModel.PER_UNIT)
    student = User.objects.create(username="installment_student_2", phone="+237699990012")
    allocation = allocate_room(student=student, unit=unit, semester=semester)
    billing = HostelBilling.objects.create(allocation=allocation, billing_cycle=BillingCycle.SEMESTER, amount_xaf=Decimal("150000"), due_date=date.today() + timedelta(days=90))

    plan = create_installment_plan(billing=billing, num_installments=2)
    installments = list(plan.installments.all())

    pay_installment(installments[0])
    billing.refresh_from_db()
    assert billing.status == HostelBillingStatus.PENDING  # only 1 of 2 paid — not settled yet

    pay_installment(installments[1])
    billing.refresh_from_db()
    assert billing.status == "PAID"  # all installments paid — bill now settled


@pytest.mark.django_db
def test_hostel_occupancy_summary_includes_a_real_revenue_trend(hostel, semester):
    """Confirms the DateField-based trend (due_date, not a datetime
    field) actually works — the trickiest of the retrofitted trends."""
    from student_hostels.services import get_hostel_occupancy_summary
    unit = HostelUnit.objects.create(building=hostel.building_ptr, room_code="TREND-1", unit_type=HostelUnitType.SELF_CONTAIN, occupancy_model=OccupancyModel.PER_UNIT)
    student = User.objects.create(username="trend_hostel_student", phone="+237699888400")
    allocation = allocate_room(student=student, unit=unit, semester=semester)
    billing = HostelBilling.objects.create(allocation=allocation, billing_cycle=BillingCycle.SEMESTER, amount_xaf=Decimal("200000"), due_date=date.today(), status=HostelBillingStatus.PAID)

    summary = get_hostel_occupancy_summary(hostel)
    assert "revenue_trend_xaf" in summary
    assert summary["revenue_trend_xaf"]["current_period_value"] == Decimal("200000")
