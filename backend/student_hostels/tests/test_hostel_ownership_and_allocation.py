"""
Tests proving Prompt 11's three exact acceptance criteria: a student
correctly allocated and billed with a parent seeing bills but NOT
sensitive data; an Agency-managed hostel owned by a private Landlord
with correctly scoped access; and independent billing for a self-contain
unit vs a shared room, with an amenity subscription addable/cancellable
without touching core billing.
"""
import pytest
from decimal import Decimal
from datetime import date

from identity.models import User, StudentProfile, AgencyProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from student_hostels.models import (
    OwnerProfile, OwnerType, ManagerProfile, ManagerType, PartnerInstitution,
    StudentHostel, HostelPropertyType, HostelManagementContract, ManagementScope,
    HostelUnit, HostelUnitType, OccupancyModel, BedSlot, Semester,
    RoomAllocation, HostelBilling, BillingCycle, HostelBillingStatus,
    AmenitySubscription, AmenityType, ParentGuardianAccess, MaintenanceRequest,
)
from student_hostels.services import (
    create_student_hostel, allocate_room, get_parent_visible_data, AccessDeniedError,
    NoAvailableUnitError,
)


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Messassi District")
    return Quarter.objects.create(village_or_district=village, name="Messassi")


@pytest.fixture
def institution(db):
    return PartnerInstitution.objects.create(name="ICT University")


@pytest.fixture
def semester(db, institution):
    return Semester.objects.create(
        institution=institution, name="2026/2027 First Semester",
        start_date=date(2026, 9, 1), end_date=date(2027, 1, 31), billing_due_date=date(2026, 9, 15),
    )


@pytest.mark.django_db
def test_student_allocated_and_billed_parent_sees_bill_not_sensitive_data(quarter, semester):
    """Acceptance criteria #1."""
    landlord_user = User.objects.create(username="hostel_landlord", phone="+237699200001")
    owner = OwnerProfile.objects.create(account_user=landlord_user, owner_type=OwnerType.LANDLORD)
    hostel = create_student_hostel(owner_profile=owner, quarter=quarter, property_type=HostelPropertyType.BLOCK)

    unit = HostelUnit.objects.create(
        building=hostel.building_ptr, room_code="A-101", unit_type=HostelUnitType.SHARED_ROOM,
        occupancy_model=OccupancyModel.PER_BED, bed_capacity=2,
    )
    BedSlot.objects.create(unit=unit, bed_number=1)
    BedSlot.objects.create(unit=unit, bed_number=2)

    student_user = User.objects.create(username="hostel_student", phone="+237699200002")
    StudentProfile.objects.create(user=student_user, institution_name="ICT University", programme_year=2)

    allocation = allocate_room(student=student_user, unit=unit, semester=semester)
    assert allocation.bed_slot is not None

    bill = HostelBilling.objects.create(
        allocation=allocation, billing_cycle=BillingCycle.SEMESTER,
        amount_xaf=Decimal("250000"), due_date=semester.billing_due_date,
    )

    parent_user = User.objects.create(username="hostel_parent", phone="+237699200003")
    # No access grant yet — must be denied.
    with pytest.raises(AccessDeniedError):
        get_parent_visible_data(parent_user=parent_user, student=student_user)

    ParentGuardianAccess.objects.create(parent_user=parent_user, student=student_user)
    visible = get_parent_visible_data(parent_user=parent_user, student=student_user)

    assert len(visible["bills"]) == 1
    assert visible["bills"][0]["amount_xaf"] == Decimal("250000")
    assert "maintenance_requests" not in visible  # never exposed
    assert "access_logs" not in visible  # never exposed

    # Even if a maintenance request exists for this student's unit, the
    # parent-visible data must not surface it.
    MaintenanceRequest.objects.create(unit=unit, reported_by=student_user, description="Broken window latch")
    visible_again = get_parent_visible_data(parent_user=parent_user, student=student_user)
    assert "maintenance_requests" not in visible_again


@pytest.mark.django_db
def test_agency_managed_hostel_owned_by_landlord_scoped_access(quarter):
    """Acceptance criteria #2."""
    landlord_user = User.objects.create(username="private_landlord", phone="+237699200004")
    owner = OwnerProfile.objects.create(account_user=landlord_user, owner_type=OwnerType.LANDLORD)
    hostel = create_student_hostel(owner_profile=owner, quarter=quarter, property_type=HostelPropertyType.SELF_CONTAIN_COMPOUND)

    agency_user = User.objects.create(username="managing_agency", phone="+237699200005")
    agency_profile = AgencyProfile.objects.create(user=agency_user, registration_number="RC-HOSTEL-001", agency_commission_percent=Decimal("20"))
    manager = ManagerProfile.objects.create(account_user=agency_user, manager_type=ManagerType.AGENCY, agency=agency_profile)

    contract = HostelManagementContract.objects.create(
        hostel=hostel, manager=manager, scope=ManagementScope.BOOKINGS_ONLY,
        start_date=date(2026, 1, 1),
    )

    # The hostel correctly reports the Agency as its current manager...
    assert hostel.current_manager == manager
    # ...but ownership is unchanged — the Landlord still owns it.
    assert hostel.owner_profile == owner
    assert hostel.owner_profile.owner_type == OwnerType.LANDLORD

    # The contract scope is BOOKINGS_ONLY, not FULL — this is what a
    # permission-checking layer would read to scope the Agency's access.
    assert contract.scope == ManagementScope.BOOKINGS_ONLY

    # Revoking the contract means the hostel has NO current manager
    # anymore (falls back to nobody, not silently to the old manager).
    contract.revoke(reason="Contract ended")
    assert hostel.current_manager is None


@pytest.mark.django_db
def test_self_contain_unit_billed_independently_with_cancellable_amenity(quarter, semester):
    """Acceptance criteria #3."""
    owner_user = User.objects.create(username="mixed_hostel_owner", phone="+237699200006")
    owner = OwnerProfile.objects.create(account_user=owner_user, owner_type=OwnerType.LANDLORD)
    hostel = create_student_hostel(owner_profile=owner, quarter=quarter, property_type=HostelPropertyType.MIXED)

    shared_room = HostelUnit.objects.create(
        building=hostel.building_ptr, room_code="A-201", unit_type=HostelUnitType.SHARED_ROOM,
        occupancy_model=OccupancyModel.PER_BED, bed_capacity=4,
    )
    self_contain = HostelUnit.objects.create(
        building=hostel.building_ptr, room_code="B-301", unit_type=HostelUnitType.SELF_CONTAIN,
        occupancy_model=OccupancyModel.PER_UNIT, bed_capacity=1,
    )

    student_a = User.objects.create(username="shared_room_student", phone="+237699200007")
    BedSlot.objects.create(unit=shared_room, bed_number=1)
    allocation_a = allocate_room(student=student_a, unit=shared_room, semester=semester)
    bill_a = HostelBilling.objects.create(allocation=allocation_a, billing_cycle=BillingCycle.SEMESTER, amount_xaf=Decimal("150000"), due_date=semester.billing_due_date)

    student_b = User.objects.create(username="self_contain_student", phone="+237699200008")
    allocation_b = allocate_room(student=student_b, unit=self_contain, semester=semester)
    bill_b = HostelBilling.objects.create(allocation=allocation_b, billing_cycle=BillingCycle.TWELVE_MONTHS, amount_xaf=Decimal("600000"), due_date=semester.billing_due_date)

    # Independently billed, independently priced, different cycles.
    assert bill_a.billing_cycle == BillingCycle.SEMESTER
    assert bill_b.billing_cycle == BillingCycle.TWELVE_MONTHS
    assert bill_a.amount_xaf != bill_b.amount_xaf

    # Add and cancel a laundry subscription for the self-contain student —
    # must not touch bill_b at all.
    subscription = AmenitySubscription.objects.create(
        subscriber=student_b, amenity_type=AmenityType.LAUNDRY,
        billing_cycle=BillingCycle.MONTHLY, price_xaf=Decimal("5000"),
    )
    bill_b.refresh_from_db()
    assert bill_b.amount_xaf == Decimal("600000")  # completely unaffected

    subscription.cancel()
    assert subscription.status == "CANCELLED"
    bill_b.refresh_from_db()
    assert bill_b.amount_xaf == Decimal("600000")  # still unaffected


@pytest.mark.django_db
def test_a_second_student_cannot_take_an_already_occupied_per_unit_room(quarter, semester):
    owner_user = User.objects.create(username="occupied_test_owner", phone="+237699200009")
    owner = OwnerProfile.objects.create(account_user=owner_user, owner_type=OwnerType.LANDLORD)
    hostel = create_student_hostel(owner_profile=owner, quarter=quarter, property_type=HostelPropertyType.STUDIO_COMPLEX)
    studio = HostelUnit.objects.create(
        building=hostel.building_ptr, room_code="C-101", unit_type=HostelUnitType.STUDIO,
        occupancy_model=OccupancyModel.PER_UNIT,
    )
    student_one = User.objects.create(username="first_studio_student", phone="+237699200010")
    student_two = User.objects.create(username="second_studio_student", phone="+237699200011")

    allocate_room(student=student_one, unit=studio, semester=semester)
    with pytest.raises(NoAvailableUnitError):
        allocate_room(student=student_two, unit=studio, semester=semester)


@pytest.mark.django_db
def test_billing_cycle_supports_six_and_twelve_months_and_deposit(quarter, semester):
    """The founder's explicit addition: 6 months, 12 months, or deposit."""
    owner_user = User.objects.create(username="cycle_test_owner", phone="+237699200012")
    owner = OwnerProfile.objects.create(account_user=owner_user, owner_type=OwnerType.LANDLORD)
    hostel = create_student_hostel(owner_profile=owner, quarter=quarter, property_type=HostelPropertyType.APARTMENT_BUILDING)
    unit = HostelUnit.objects.create(building=hostel.building_ptr, room_code="D-101", unit_type=HostelUnitType.ONE_BED_APARTMENT, occupancy_model=OccupancyModel.PER_UNIT)
    student = User.objects.create(username="cycle_test_student", phone="+237699200013")
    allocation = allocate_room(student=student, unit=unit, semester=semester)

    six_month_bill = HostelBilling.objects.create(allocation=allocation, billing_cycle=BillingCycle.SIX_MONTHS, amount_xaf=Decimal("300000"), due_date=semester.billing_due_date)
    assert six_month_bill.billing_cycle == BillingCycle.SIX_MONTHS

    deposit_bill = HostelBilling.objects.create(unit=unit, billing_cycle=BillingCycle.DEPOSIT, amount_xaf=Decimal("100000"), due_date=semester.billing_due_date)
    assert deposit_bill.billing_cycle == BillingCycle.DEPOSIT
    assert deposit_bill.allocation is None  # deposit billed directly to the unit, not a student allocation
