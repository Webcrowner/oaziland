"""Owners give staff limited access; staff work in a staff session that can never touch money, security or staff."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from identity.models import KYCProfile, StaffAccess, StaffActionLog, User, VerificationStatus
from identity.staff_access import check_staff_request
from marketplace.tests.test_marketplace_api import _auth_client
from notifications.models import Notification


def _verified(user):
    KYCProfile.objects.create(
        user=user, legal_full_name=user.username, date_of_birth="1990-01-01", national_id_number=f"SA-{user.username}",
        residential_address="x", kyc_status=VerificationStatus.VERIFIED,
    )
    return user


@pytest.fixture
def owner(db):
    return _verified(User.objects.create(username="sa_owner", phone="+237699550001", first_name="Olga", last_name="Owner"))


@pytest.fixture
def staff(db):
    return User.objects.create(username="sa_staff", phone="+237699550002", first_name="Sam", last_name="Staff")


def _invite(owner, staff, permissions=("listings", "messages"), **extra):
    response = _auth_client(owner).post("/api/staff-access/", {"identifier": staff.phone, "permissions": list(permissions), **extra}, format="json")
    assert response.status_code == 201, response.data
    return response.data["id"]


def _session(staff, grant_id):
    response = _auth_client(staff).post(f"/api/staff-access/{grant_id}/switch/")
    assert response.status_code == 200, response.data
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client, response.data


@pytest.mark.django_db
def test_invite_accept_switch_and_act_as_the_owner(owner, staff):
    grant_id = _invite(owner, staff, title="Property manager")
    assert Notification.objects.filter(recipient=staff, notification_type="STAFF_ACCESS").exists()
    assert _auth_client(staff).post(f"/api/staff-access/{grant_id}/switch/").status_code == 400  # not accepted yet

    assert _auth_client(staff).post(f"/api/staff-access/{grant_id}/accept/").data["status"] == "ACTIVE"
    assert Notification.objects.filter(recipient=owner, title="Staff invitation accepted").exists()

    client, session = _session(staff, grant_id)
    assert session["owner"]["username"] == "sa_owner" and session["permissions"] == ["listings", "messages"]
    me = client.get("/api/auth/me/")
    assert me.status_code == 200 and me.data["username"] == "sa_owner"
    info = client.get("/api/staff-access/session/").data
    assert info["active"] is True and info["staff"]["username"] == "sa_staff" and info["title"] == "Property manager"
    assert _auth_client(staff).get("/api/staff-access/session/").data == {"active": False}


@pytest.mark.django_db
def test_money_security_and_staff_management_are_never_allowed(owner, staff):
    grant_id = _invite(owner, staff, permissions=["listings", "messages", "bookings", "posts", "reviews", "earnings_view"])
    _auth_client(staff).post(f"/api/staff-access/{grant_id}/accept/")
    client, _ = _session(staff, grant_id)

    blocked = [
        ("post", "/api/wallet/withdraw/", {"amount_xaf": "1000"}), ("post", "/api/wallet/recharge/", {}),
        ("post", "/api/auth/change-password/", {}), ("patch", "/api/auth/me/", {"first_name": "Hacked"}),
        ("post", "/api/auth/kyc/", {}), ("post", "/api/account/deletion/", {}), ("post", "/api/data-exports/", {}),
        ("post", "/api/staff-access/", {"identifier": "x", "permissions": ["listings"]}),
        ("post", f"/api/staff-access/{grant_id}/switch/", {}), ("post", "/api/gifts/send/", {}),
        ("post", "/api/my-agency-dashboard/add-agent/", {}), ("get", "/api/admin/content-reports/", None),
        ("post", "/api/marketplace-orders/", {}), ("post", "/api/bookings/", {}),
        ("post", "/api/bookings/00000000-0000-0000-0000-000000000000/pay/", {}),
        ("post", "/api/marketplace-orders/1/confirm/", {}), ("post", "/api/service-requests/1/release/", {}),
    ]
    for method, path, body in blocked:
        response = getattr(client, method)(path, body, format="json") if body is not None else getattr(client, method)(path)
        assert response.status_code == 403, (method, path, response.status_code)
    owner.refresh_from_db()
    assert owner.first_name == "Olga"


@pytest.mark.django_db
def test_permissions_decide_what_staff_may_change():
    grant = StaffAccess(permissions=["listings", "reviews"])
    allowed = [("POST", "/api/listings/"), ("PATCH", "/api/listings/abc/"), ("POST", "/api/media/upload/"),
               ("GET", "/api/ratings/"), ("GET", "/api/search/"), ("GET", "/api/my-notifications/"), ("POST", "/api/my-notifications/mark-all-read/")]
    denied = [("POST", "/api/conversations/1/send/"), ("GET", "/api/conversations/"), ("POST", "/api/posts/"),
              ("POST", "/api/reviews/"), ("GET", "/api/wallet/"), ("POST", "/api/some-unknown-thing/")]
    for method, path in allowed:
        assert check_staff_request(grant, method, path) is None, (method, path)
    for method, path in denied:
        assert check_staff_request(grant, method, path) is not None, (method, path)


@pytest.mark.django_db
def test_staff_changes_are_logged_for_the_owner(owner, staff, settings):
    grant_id = _invite(owner, staff, permissions=["posts"])
    _auth_client(staff).post(f"/api/staff-access/{grant_id}/accept/")
    client, _ = _session(staff, grant_id)

    client.post("/api/posts/", {"caption": "New listing this week!", "post_type": "STANDARD"}, format="json")
    client.post("/api/wallet/withdraw/", {"amount_xaf": "1000"}, format="json")  # refused before the view, not logged as a change

    log = list(StaffActionLog.objects.filter(access_id=grant_id).values_list("method", "path"))
    assert ("POST", "/api/posts/") in log
    rows = _auth_client(owner).get(f"/api/staff-access/{grant_id}/activity/").data["results"]
    assert any(row["path"] == "/api/posts/" for row in rows)
    assert _auth_client(staff).get(f"/api/staff-access/{grant_id}/activity/").status_code == 403


@pytest.mark.django_db
def test_removing_or_expiring_access_ends_the_session_at_once(owner, staff):
    grant_id = _invite(owner, staff, permissions=["listings"])
    _auth_client(staff).post(f"/api/staff-access/{grant_id}/accept/")
    client, _ = _session(staff, grant_id)
    assert client.get("/api/auth/me/").status_code == 200

    assert _auth_client(owner).post(f"/api/staff-access/{grant_id}/remove/").data["status"] == "REVOKED"
    assert client.get("/api/auth/me/").status_code == 401
    assert Notification.objects.filter(recipient=staff, title="Your staff access was removed").exists()

    second = _invite(owner, staff, permissions=["listings"], expires_on=str(timezone.localdate()))
    _auth_client(staff).post(f"/api/staff-access/{second}/accept/")
    client, session = _session(staff, second)
    assert session["expires_in"] <= 24 * 3600
    StaffAccess.objects.filter(pk=second).update(expires_on=timezone.localdate() - timedelta(days=1))
    assert client.get("/api/auth/me/").status_code == 401


@pytest.mark.django_db
def test_invitations_are_checked(owner, staff):
    unverified = User.objects.create(username="sa_unverified", phone="+237699550003")
    assert _auth_client(unverified).post("/api/staff-access/", {"identifier": staff.phone, "permissions": ["listings"]}, format="json").status_code == 400
    for bad in (
        {"identifier": "nobody-here", "permissions": ["listings"]}, {"identifier": owner.phone, "permissions": ["listings"]},
        {"identifier": staff.phone, "permissions": []}, {"identifier": staff.phone, "permissions": ["withdraw_money"]},
        {"identifier": staff.phone, "permissions": ["listings"], "expires_on": "2000-01-01"},
    ):
        assert _auth_client(owner).post("/api/staff-access/", bad, format="json").status_code == 400, bad
    _invite(owner, staff)
    assert _auth_client(owner).post("/api/staff-access/", {"identifier": staff.username, "permissions": ["listings"]}, format="json").status_code == 400

    stranger = User.objects.create(username="sa_stranger", phone="+237699550004")
    grant_id = StaffAccess.objects.get(owner=owner).pk
    assert _auth_client(stranger).post(f"/api/staff-access/{grant_id}/accept/").status_code == 404
    assert _auth_client(owner).post(f"/api/staff-access/{grant_id}/accept/").status_code == 400  # only the invitee accepts


@pytest.mark.django_db
def test_the_owner_can_change_permissions_and_staff_can_leave(owner, staff):
    grant_id = _invite(owner, staff, permissions=["listings"])
    _auth_client(staff).post(f"/api/staff-access/{grant_id}/accept/")
    updated = _auth_client(owner).post(f"/api/staff-access/{grant_id}/update/", {"permissions": ["messages", "bookings"], "title": "Assistant"}, format="json")
    assert updated.data["permissions"] == ["messages", "bookings"] and updated.data["title"] == "Assistant"
    assert _auth_client(staff).post(f"/api/staff-access/{grant_id}/update/", {"permissions": ["listings"]}, format="json").status_code == 400

    overview = _auth_client(staff).get("/api/staff-access/").data
    assert overview["i_help"][0]["owner"]["username"] == "sa_owner" and overview["my_staff"] == []
    assert _auth_client(staff).post(f"/api/staff-access/{grant_id}/leave/").data["status"] == "REVOKED"
    assert Notification.objects.filter(recipient=owner, title="A staff member left").exists()
