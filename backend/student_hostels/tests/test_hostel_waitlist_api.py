"""Tests for the real hostel-waitlist API and the admin "end allocation"
action that closes the loop into the auto-reallocation engine — Prompt
11's 'join a waitlist, get auto-notified or auto-allocated when a
matching unit frees up' had fully built ranking/reallocation logic, but
nothing ever let a student join a waitlist, and nothing ever let an
allocation actually end to free up a unit."""
import pytest
from datetime import date
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, AdminProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from student_hostels.models import (
    OwnerProfile, OwnerType, PartnerInstitution, StudentHostel, HostelPropertyType,
    HostelUnit, HostelUnitType, OccupancyModel, BedSlot, Semester, RoomAllocation,
    RoomAllocationStatus, Waitlist,
)
from student_hostels.services import create_student_hostel, allocate_room


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Messassi District")
    return Quarter.objects.create(village_or_district=village, name="Messassi")


@pytest.fixture
def semester(db):
    institution = PartnerInstitution.objects.create(name="ICT University")
    return Semester.objects.create(
        institution=institution, name="2026/2027 First Semester",
        start_date=date(2026, 9, 1), end_date=date(2027, 1, 31), billing_due_date=date(2026, 9, 15),
    )


@pytest.fixture
def hostel_and_unit(quarter):
    landlord_user = User.objects.create(username="waitlist_hostel_landlord", phone="+237699997001")
    owner = OwnerProfile.objects.create(account_user=landlord_user, owner_type=OwnerType.LANDLORD)
    hostel = create_student_hostel(owner_profile=owner, quarter=quarter, property_type=HostelPropertyType.BLOCK)
    unit = HostelUnit.objects.create(
        building=hostel.building_ptr, room_code="W-1", unit_type=HostelUnitType.SELF_CONTAIN,
        occupancy_model=OccupancyModel.PER_UNIT,
    )
    return hostel, unit


@pytest.mark.django_db
def test_student_can_join_hostel_waitlist_via_api(hostel_and_unit, semester):
    hostel, _unit = hostel_and_unit
    student = User.objects.create(username="waitlist_hostel_student", phone="+237699997002")

    response = _auth_client(student).post("/api/my-hostel-waitlist/", {
        "hostel": str(hostel.id), "desired_unit_type": "SELF_CONTAIN", "semester": semester.id,
    })

    assert response.status_code == 201
    assert Waitlist.objects.filter(student=student, hostel=hostel, semester=semester).exists()


@pytest.mark.django_db
def test_browsing_a_hostels_real_semesters_without_a_raw_id(hostel_and_unit, semester):
    """The real gap this closes: joining the waitlist needed a real
    Semester id, but nothing ever let a student discover which
    semesters actually apply to a given hostel — a raw numeric id was
    the only way in."""
    hostel, _unit = hostel_and_unit
    hostel.institution_partnerships.add(semester.institution)

    response = APIClient().get(f"/api/student-hostels/{hostel.id}/semesters/")

    assert response.status_code == 200
    assert any(s["id"] == semester.id for s in response.data)


@pytest.mark.django_db
def test_ending_an_allocation_auto_fills_it_from_the_waitlist(hostel_and_unit, semester):
    hostel, unit = hostel_and_unit
    current_student = User.objects.create(username="waitlist_current_student", phone="+237699997003")
    waiting_student = User.objects.create(username="waitlist_waiting_student", phone="+237699997004")
    admin_user = User.objects.create(username="waitlist_admin", phone="+237699997005")
    AdminProfile.objects.create(user=admin_user, permissions=[])

    allocation = allocate_room(student=current_student, unit=unit, semester=semester)
    _auth_client(waiting_student).post("/api/my-hostel-waitlist/", {
        "hostel": str(hostel.id), "desired_unit_type": "SELF_CONTAIN", "semester": semester.id,
    })

    response = _auth_client(admin_user).post(f"/api/admin/room-allocations/{allocation.id}/end/")
    assert response.status_code == 200

    allocation.refresh_from_db()
    assert allocation.status == RoomAllocationStatus.ENDED
    assert RoomAllocation.objects.filter(student=waiting_student, unit=unit, semester=semester).exists()
    assert Waitlist.objects.get(student=waiting_student).fulfilled_at is not None
