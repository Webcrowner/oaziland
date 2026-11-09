"""Hostel owners/managers and admins run rooms: set-up, placing students, ending and moving allocations."""
from datetime import date, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from geo.models import Country, Division, Quarter, Region, Subdivision, VillageOrDistrict
from identity.models import AdminProfile, User
from notifications.models import Notification
from student_hostels.models import (
    HostelManagementContract, HostelPropertyType, ManagementScope, ManagerProfile, ManagerType, OwnerProfile, OwnerType,
    RoomAllocation, RoomAllocationStatus, Waitlist,
)
from student_hostels.services import create_student_hostel
from trust_safety.models import AuditLog

URL = "/api/hostel-rooms/"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Ngoa-Ekelle")
    return Quarter.objects.create(village_or_district=village, name="Ngoa-Ekelle")


def make_user(name, phone, **extra):
    return User.objects.create(username=name, phone=phone, email=f"{name}@example.com", **extra)


@pytest.fixture
def owner(db):
    return make_user("hr_owner", "+237699920001", first_name="Olga", last_name="Owner")


@pytest.fixture
def hostel(owner, quarter):
    profile = OwnerProfile.objects.create(account_user=owner, owner_type=OwnerType.LANDLORD)
    return create_student_hostel(owner_profile=profile, quarter=quarter, property_type=HostelPropertyType.BLOCK)


@pytest.fixture
def admin(db):
    user = make_user("hr_admin", "+237699920002")
    AdminProfile.objects.create(user=user)
    return user


def board(user, hostel, **params):
    response = client_for(user).get(f"{URL}{hostel.pk}/", params)
    assert response.status_code == 200, response.data
    return response.data


def post(user, hostel, action, body):
    return client_for(user).post(f"{URL}{hostel.pk}/{action}/", body, format="json")


@pytest.fixture
def ready(owner, hostel):
    """A hostel with an institution, a current semester, a 2-bed shared room and a studio."""
    post(owner, hostel, "institutions", {"name": "University of Yaoundé I"})
    institution_id = board(owner, hostel)["institutions"][0]["id"]
    today = timezone.localdate()
    response = post(owner, hostel, "semesters", {
        "institution": institution_id, "name": "First semester", "start_date": str(today - timedelta(days=10)),
        "end_date": str(today + timedelta(days=100)), "billing_due_date": str(today),
    })
    assert response.status_code == 200, response.data
    assert post(owner, hostel, "rooms", {"room_code": "A-1", "unit_type": "SHARED_ROOM", "occupancy_model": "PER_BED", "bed_capacity": 2}).status_code == 200
    data = post(owner, hostel, "rooms", {"room_code": "S-1", "unit_type": "STUDIO", "occupancy_model": "PER_UNIT", "bed_capacity": 5}).data
    rooms = {room["room_code"]: room for room in data["rooms"]}
    return {"semester": data["semester_id"], "shared": rooms["A-1"]["id"], "studio": rooms["S-1"]["id"]}


# ---------------------------------------------------------------- who may manage

@pytest.mark.django_db
def test_owners_see_their_hostels_admins_see_all_and_strangers_nothing(owner, hostel, admin, quarter):
    other_owner = make_user("hr_other", "+237699920003")
    other = create_student_hostel(owner_profile=OwnerProfile.objects.create(account_user=other_owner, owner_type=OwnerType.LANDLORD), quarter=quarter, property_type=HostelPropertyType.BLOCK)

    assert [h["id"] for h in client_for(owner).get(URL).data["results"]] == [str(hostel.pk)]
    assert client_for(admin).get(URL).data["count"] == 2
    assert client_for(owner).get(f"{URL}{other.pk}/").status_code == 404
    assert post(owner, other, "institutions", {"name": "X"}).status_code == 404
    assert APIClient().get(URL).status_code == 401


@pytest.mark.django_db
def test_a_manager_with_a_booking_contract_can_manage_but_not_a_maintenance_one(owner, hostel):
    manager_user = make_user("hr_manager", "+237699920004")
    manager = ManagerProfile.objects.create(account_user=manager_user, manager_type=ManagerType.STAFF)
    contract = HostelManagementContract.objects.create(hostel=hostel, manager=manager, scope=ManagementScope.MAINTENANCE_ONLY, start_date=date(2026, 1, 1))
    assert client_for(manager_user).get(f"{URL}{hostel.pk}/").status_code == 404

    contract.scope = ManagementScope.BOOKINGS_ONLY
    contract.save()
    assert client_for(manager_user).get(f"{URL}{hostel.pk}/").status_code == 200

    contract.revoke("Left")
    assert client_for(manager_user).get(f"{URL}{hostel.pk}/").status_code == 404


# ---------------------------------------------------------------- set-up

@pytest.mark.django_db
def test_setting_up_institutions_semesters_and_rooms(owner, hostel, ready):
    data = board(owner, hostel)

    assert [i["name"] for i in data["institutions"]] == ["University of Yaoundé I"]
    assert data["semesters"][0]["name"] == "First semester" and data["semester_id"] == ready["semester"]
    rooms = {room["room_code"]: room for room in data["rooms"]}
    assert [p["bed"] for p in rooms["A-1"]["places"]] == [1, 2]
    assert [p["bed"] for p in rooms["S-1"]["places"]] == [None]  # a studio is let whole, whatever capacity was typed
    assert data["hostel"]["rooms"] == 2 and data["hostel"]["places"] == 3


@pytest.mark.django_db
def test_set_up_input_is_checked(owner, hostel, ready):
    institution = board(owner, hostel)["institutions"][0]["id"]
    bad_semesters = [
        {"institution": institution, "name": "Bad", "start_date": "2026-09-01", "end_date": "2026-08-01", "billing_due_date": "2026-08-01"},
        {"institution": institution, "name": "Bad", "start_date": "2026-09-01", "end_date": "2027-01-31", "billing_due_date": "2027-03-01"},
        {"institution": institution, "name": "First semester", "start_date": "2026-09-01", "end_date": "2027-01-31", "billing_due_date": "2026-09-15"},
        {"institution": 99999, "name": "Bad", "start_date": "2026-09-01", "end_date": "2027-01-31", "billing_due_date": "2026-09-15"},
        {"institution": institution, "name": "Bad", "start_date": "not-a-date", "end_date": "2027-01-31", "billing_due_date": "2026-09-15"},
    ]
    for body in bad_semesters:
        assert post(owner, hostel, "semesters", body).status_code == 400, body
    bad_rooms = [
        {"room_code": "a-1", "unit_type": "SHARED_ROOM", "occupancy_model": "PER_BED", "bed_capacity": 2},
        {"room_code": "B-1", "unit_type": "CASTLE", "occupancy_model": "PER_BED", "bed_capacity": 2},
        {"room_code": "B-1", "unit_type": "SHARED_ROOM", "occupancy_model": "PER_BED", "bed_capacity": 0},
        {"room_code": "B-1", "unit_type": "SHARED_ROOM", "occupancy_model": "PER_BED", "bed_capacity": 21},
        {"room_code": "", "unit_type": "SHARED_ROOM", "occupancy_model": "PER_BED", "bed_capacity": 2},
    ]
    for body in bad_rooms:
        assert post(owner, hostel, "rooms", body).status_code == 400, body
    assert post(owner, hostel, "institutions", {"name": "  "}).status_code == 400


# ---------------------------------------------------------------- placing students

@pytest.mark.django_db
def test_placing_a_student_by_username_or_phone_fills_a_bed_and_tells_them(owner, hostel, ready):
    amina = make_user("hr_amina", "+237699920010")
    boris = make_user("hr_boris", "+237699920011")

    assert post(owner, hostel, "allocate", {"student": "hr_amina", "unit": ready["shared"], "semester": ready["semester"]}).status_code == 200
    data = post(owner, hostel, "allocate", {"student": "+237699920011", "unit": ready["shared"], "semester": ready["semester"]}).data

    beds = next(r for r in data["rooms"] if r["room_code"] == "A-1")["places"]
    assert [p["allocation"]["student"]["username"] for p in beds] == ["hr_amina", "hr_boris"]
    assert beds[0]["allocation"]["allocated_by"] == "hr_owner"
    assert data["hostel"]["housed_now"] == 2
    assert Notification.objects.filter(recipient=amina, notification_type="ROOM_ALLOCATION").exists()
    assert Notification.objects.filter(recipient=boris, notification_type="ROOM_ALLOCATION").exists()


@pytest.mark.django_db
def test_allocation_rules(owner, hostel, ready, admin):
    for i in range(3):
        make_user(f"hr_s{i}", f"+23769992002{i}")
    post(owner, hostel, "allocate", {"student": "hr_s0", "unit": ready["shared"], "semester": ready["semester"]})
    post(owner, hostel, "allocate", {"student": "hr_s1", "unit": ready["shared"], "semester": ready["semester"]})

    assert post(owner, hostel, "allocate", {"student": "hr_s2", "unit": ready["shared"], "semester": ready["semester"]}).data["detail"] == "This room is full for that semester."
    assert "already has a room" in post(owner, hostel, "allocate", {"student": "hr_s0", "unit": ready["studio"], "semester": ready["semester"]}).data["detail"]
    assert post(owner, hostel, "allocate", {"student": "nobody", "unit": ready["studio"], "semester": ready["semester"]}).status_code == 400
    assert post(owner, hostel, "allocate", {"student": "hr_admin", "unit": ready["studio"], "semester": ready["semester"]}).status_code == 400
    assert post(owner, hostel, "allocate", {"student": "hr_s2", "unit": ready["studio"], "semester": 99999}).status_code == 400
    assert post(owner, hostel, "allocate", {"student": "hr_s2", "unit": "not-a-uuid", "semester": ready["semester"]}).status_code == 400
    assert RoomAllocation.objects.filter(status=RoomAllocationStatus.ACTIVE).count() == 2


@pytest.mark.django_db
def test_placing_a_waitlisted_student_by_hand_closes_their_waitlist_entry(owner, hostel, ready):
    from student_hostels.models import Semester
    student = make_user("hr_wait", "+237699920030")
    entry = Waitlist.objects.create(student=student, hostel=hostel, desired_unit_type="STUDIO", semester=Semester.objects.get(pk=ready["semester"]))
    assert board(owner, hostel)["waitlist"][0]["student"]["username"] == "hr_wait"

    post(owner, hostel, "allocate", {"student": "hr_wait", "unit": ready["studio"], "semester": ready["semester"]})

    entry.refresh_from_db()
    assert entry.fulfilled_at is not None and board(owner, hostel)["waitlist"] == []


@pytest.mark.django_db
def test_ending_needs_a_reason_and_the_freed_bed_goes_to_the_waitlist(owner, hostel, ready):
    from student_hostels.models import Semester
    leaving = make_user("hr_leaving", "+237699920040")
    waiting = make_user("hr_waiting", "+237699920041")
    semester = Semester.objects.get(pk=ready["semester"])
    post(owner, hostel, "allocate", {"student": "hr_leaving", "unit": ready["shared"], "semester": ready["semester"]})
    allocation = RoomAllocation.objects.get(student=leaving)
    Waitlist.objects.create(student=waiting, hostel=hostel, desired_unit_type="SHARED_ROOM", semester=semester)

    assert post(owner, hostel, "end-allocation", {"allocation": str(allocation.pk)}).status_code == 400
    response = post(owner, hostel, "end-allocation", {"allocation": str(allocation.pk), "reason": "Graduated early"})

    assert response.status_code == 200, response.data
    allocation.refresh_from_db()
    assert allocation.status == RoomAllocationStatus.ENDED and allocation.end_reason == "Graduated early" and allocation.ended_by == owner
    # The same bed, in the same semester, goes to the next student (this used to fail on a uniqueness rule).
    replacement = RoomAllocation.objects.get(student=waiting, status=RoomAllocationStatus.ACTIVE)
    assert replacement.bed_slot_id == allocation.bed_slot_id and replacement.allocated_by is None
    assert "Graduated early" in Notification.objects.get(recipient=leaving, title="Your room allocation has ended").message
    assert Notification.objects.filter(recipient=waiting, title="You have a room").exists()
    assert post(owner, hostel, "end-allocation", {"allocation": str(allocation.pk), "reason": "Again"}).status_code == 400


@pytest.mark.django_db
def test_the_waitlist_skips_a_student_who_already_has_a_room(owner, hostel, ready):
    from student_hostels.models import Semester
    semester = Semester.objects.get(pk=ready["semester"])
    leaving = make_user("hr_l2", "+237699920050")
    housed = make_user("hr_h2", "+237699920051")
    next_in_line = make_user("hr_n2", "+237699920052")
    post(owner, hostel, "allocate", {"student": "hr_l2", "unit": ready["shared"], "semester": ready["semester"]})
    post(owner, hostel, "allocate", {"student": "hr_h2", "unit": ready["studio"], "semester": ready["semester"]})
    Waitlist.objects.create(student=housed, hostel=hostel, desired_unit_type="SHARED_ROOM", semester=semester)
    Waitlist.objects.create(student=next_in_line, hostel=hostel, desired_unit_type="SHARED_ROOM", semester=semester)

    post(owner, hostel, "end-allocation", {"allocation": str(RoomAllocation.objects.get(student=leaving).pk), "reason": "Left"})

    assert RoomAllocation.objects.filter(student=housed, status=RoomAllocationStatus.ACTIVE).count() == 1
    assert RoomAllocation.objects.filter(student=next_in_line, status=RoomAllocationStatus.ACTIVE).exists()


@pytest.mark.django_db
def test_moving_a_student_to_another_room(owner, hostel, ready):
    student = make_user("hr_mover", "+237699920060")
    post(owner, hostel, "allocate", {"student": "hr_mover", "unit": ready["shared"], "semester": ready["semester"]})
    old = RoomAllocation.objects.get(student=student)

    data = post(owner, hostel, "move-allocation", {"allocation": str(old.pk), "unit": ready["studio"]}).data

    old.refresh_from_db()
    assert old.status == RoomAllocationStatus.ENDED and old.end_reason == "Moved to S-1"
    studio = next(r for r in data["rooms"] if r["room_code"] == "S-1")
    assert studio["places"][0]["allocation"]["student"]["username"] == "hr_mover"
    new = RoomAllocation.objects.get(student=student, status=RoomAllocationStatus.ACTIVE)
    assert post(owner, hostel, "move-allocation", {"allocation": str(new.pk), "unit": ready["studio"]}).status_code == 400


@pytest.mark.django_db
def test_rooms_and_institutions_in_use_are_protected(owner, hostel, ready):
    make_user("hr_p", "+237699920070")
    post(owner, hostel, "allocate", {"student": "hr_p", "unit": ready["shared"], "semester": ready["semester"]})
    institution = board(owner, hostel)["institutions"][0]["id"]

    assert post(owner, hostel, "delete-room", {"unit": ready["shared"]}).status_code == 400
    assert post(owner, hostel, "remove-institution", {"institution": institution}).status_code == 400
    assert post(owner, hostel, "delete-room", {"unit": ready["studio"]}).status_code == 200
    assert [r["room_code"] for r in board(owner, hostel)["rooms"]] == ["A-1"]


@pytest.mark.django_db
def test_an_admin_can_step_in_and_it_is_audited_but_owner_actions_are_not(owner, hostel, ready, admin):
    make_user("hr_ad", "+237699920080")

    response = post(admin, hostel, "allocate", {"student": "hr_ad", "unit": ready["studio"], "semester": ready["semester"]})

    assert response.status_code == 200
    entry = AuditLog.objects.get(action="hostel-rooms/allocate")
    assert entry.actor_username == "hr_admin" and entry.details["student"] == "hr_ad" and "Ngoa-Ekelle" in entry.target_label
    assert not AuditLog.objects.filter(actor_username="hr_owner").exists()


@pytest.mark.django_db
def test_admins_can_search_hostels(admin, hostel):
    assert client_for(admin).get(URL, {"q": "olga"}).data["count"] == 1
    assert client_for(admin).get(URL, {"q": "nowhere"}).data["count"] == 0


@pytest.mark.django_db
def test_french_clients_get_french_errors(owner, hostel, ready):
    response = client_for(owner).post(f"{URL}{hostel.pk}/allocate/", {"student": "nobody", "unit": ready["studio"], "semester": ready["semester"]}, format="json", HTTP_ACCEPT_LANGUAGE="fr")
    assert response.status_code == 400 and response.json()["detail"].startswith("Aucun compte")
