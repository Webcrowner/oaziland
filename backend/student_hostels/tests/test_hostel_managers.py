"""Who runs a hostel besides its owner: agents listing for a landlord, and anyone the owner gives access."""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from identity.models import AgentProfile
from marketplace.tests.test_marketplace_api import _verify
from notifications.models import Notification
from student_hostels.models import StudentHostel
from student_hostels.tests.test_hostel_rooms import board, client_for, hostel, make_user, owner, post, quarter  # noqa: F401

URL = "/api/student-hostels/"


@pytest.fixture
def agent(db):
    user = _verify(make_user("hm_agent", "+237699940001", first_name="Aïcha", last_name="Njoya"))
    AgentProfile.objects.create(user=user, agent_commission_percent=Decimal("10"))
    return user


@pytest.fixture
def landlord(db):
    return make_user("hm_landlord", "+237699940002", first_name="Paul", last_name="Mbarga")


def list_for(agent, quarter, landlord_identifier, **extra):
    return client_for(agent).post(URL, {
        "quarter": str(quarter.pk), "name": "Résidence Les Palmiers", "property_type": "BLOCK", "landlord": landlord_identifier, **extra,
    }, format="json")


@pytest.mark.django_db
def test_an_agent_lists_a_hostel_owned_by_the_landlord_and_manages_it(agent, landlord, quarter):
    response = list_for(agent, quarter, landlord.phone)

    assert response.status_code == 201, response.data
    hostel = StudentHostel.objects.get(pk=response.data["id"])
    assert hostel.owner == landlord and hostel.listed_by == agent  # the landlord owns it and is paid for bookings
    assert response.data["lister_role"] == "AGENT" and response.data["listed_by_name"] == "Aïcha Njoya"
    assert Notification.objects.filter(recipient=landlord, notification_type="HOSTEL_LISTED_FOR_YOU").exists()

    # The agent runs it: sets up a room type and adds hostel photos.
    assert post(agent, hostel, "room-types", {
        "name": "Studio", "unit_type": "STUDIO", "occupancy_model": "PER_UNIT", "price_xaf": "50000", "price_period": "MONTH",
    }).status_code == 200
    photo = client_for(agent).post(f"{URL}{hostel.pk}/add-photo/", {"url": "https://cdn.example.com/h.jpg"}, format="json")
    assert photo.status_code == 201
    # ...but can't hand out access: only the owner can.
    assert post(agent, hostel, "add-manager", {"identifier": "+237699940099"}).status_code == 400


@pytest.mark.django_db
def test_only_agents_list_for_someone_else_and_the_landlord_must_have_an_account(agent, landlord, quarter):
    plain = _verify(make_user("hm_plain", "+237699940003"))
    assert list_for(plain, quarter, landlord.phone).status_code == 400
    assert list_for(agent, quarter, "+237600000000").status_code == 400
    assert not StudentHostel.objects.exists()


@pytest.mark.django_db
def test_an_owner_gives_any_user_access_and_can_remove_it(owner, hostel):
    caretaker = make_user("hm_caretaker", "+237699940004", first_name="Jean", last_name="Caretaker")

    response = post(owner, hostel, "add-manager", {"identifier": caretaker.username, "scope": "BOOKINGS_ONLY"})

    assert response.status_code == 200, response.data
    [row] = response.data["managers"]
    assert (row["name"], row["manager_type"], row["scope"], row["can_revoke"]) == ("Jean Caretaker", "STAFF", "BOOKINGS_ONLY", True)
    assert Notification.objects.filter(recipient=caretaker, notification_type="HOSTEL_ACCESS_GRANTED").exists()
    # The caretaker now runs the hostel's rooms (it appears in their list and its board opens)...
    listed = client_for(caretaker).get("/api/hostel-rooms/").data["results"]
    assert [h["id"] for h in listed] == [str(hostel.pk)]
    assert board(caretaker, hostel)["managers"][0]["can_revoke"] is False
    # ...until the owner removes them.
    assert post(owner, hostel, "remove-manager", {"contract": row["contract"]}).status_code == 200
    assert client_for(caretaker).get(f"/api/hostel-rooms/{hostel.pk}/").status_code == 404
    assert Notification.objects.filter(recipient=caretaker, notification_type="HOSTEL_ACCESS_REMOVED").exists()


@pytest.mark.django_db
def test_adding_a_manager_is_checked(owner, hostel):
    stranger = make_user("hm_stranger", "+237699940005")
    assert post(owner, hostel, "add-manager", {"identifier": "nobody-here"}).status_code == 400
    assert post(owner, hostel, "add-manager", {"identifier": owner.username}).status_code == 400
    assert post(owner, hostel, "add-manager", {"identifier": stranger.username, "scope": "BILLING_ONLY"}).status_code == 400
    assert post(owner, hostel, "add-manager", {"identifier": stranger.username}).status_code == 200
    assert post(owner, hostel, "add-manager", {"identifier": stranger.username}).status_code == 400  # already a manager
    assert APIClient().post(f"/api/hostel-rooms/{hostel.pk}/add-manager/", {"identifier": "x"}).status_code in (401, 403)
