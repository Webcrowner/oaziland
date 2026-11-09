from decimal import Decimal
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from identity.models import AccountStatus, AdminProfile, KYCProfile, VerificationStatus
from trust_safety.models import AuditLog

User = get_user_model()


def make_user(username, **extra):
    return User.objects.create_user(
        username=username, email=f"{username}@example.com", phone=extra.pop("phone", f"+2376991{abs(hash(username)) % 100000:05d}"),
        password="x-Strong-pass-1", **extra,
    )


def make_admin(username, permissions=None):
    user = make_user(username)
    AdminProfile.objects.create(user=user, permissions=permissions or [])
    return user


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def boss(db):
    return make_admin("boss_admin")


@pytest.fixture
def limited(db):
    return make_admin("limited_admin", permissions=["moderation"])


@pytest.fixture
def member(db):
    return make_user("plain_member")


# ---------------------------------------------------------------- audit recording

@pytest.mark.django_db
def test_a_suspension_is_recorded_with_who_what_and_why(boss, member):
    res = client_for(boss).post(f"/api/admin/users/{member.id}/toggle-suspend/", {"suspend": True, "days": 14}, format="json")

    assert res.status_code == 200
    entry = AuditLog.objects.get()
    assert entry.actor == boss
    assert entry.actor_username == "boss_admin"
    assert entry.action == "admin-user/toggle_suspend"
    assert entry.target_label == "plain_member"
    assert entry.target_id == str(member.id)
    assert entry.status_code == 200
    assert entry.details == {"suspend": True, "days": 14}


@pytest.mark.django_db
def test_blocked_attempts_are_recorded_too(boss):
    res = client_for(boss).post(f"/api/admin/users/{boss.id}/toggle-suspend/", {"suspend": True, "days": 7}, format="json")

    assert res.status_code == 403
    entry = AuditLog.objects.get()
    assert entry.status_code == 403
    assert entry.succeeded is False
    assert entry.target_label == "boss_admin"


@pytest.mark.django_db
def test_only_whitelisted_fields_are_logged(boss, member):
    client_for(boss).post(
        f"/api/admin/users/{member.id}/issue-strike/",
        {"reason": "SCAM_ATTEMPT", "password": "hunter2", "token": "secret-token"}, format="json",
    )

    entry = AuditLog.objects.get()
    assert entry.details["reason"] == "SCAM_ATTEMPT"
    assert "password" not in entry.details and "token" not in entry.details
    assert "hunter2" not in str(entry.details)


@pytest.mark.django_db
def test_reads_and_non_admin_actions_are_not_logged(boss, member):
    client_for(boss).get("/api/admin/users/")
    client_for(member).post(f"/api/admin/users/{boss.id}/toggle-suspend/", {"suspend": True}, format="json")
    client_for(member).post("/api/auth/login/", {"username": "plain_member", "password": "x-Strong-pass-1"}, format="json")

    assert AuditLog.objects.count() == 0


@pytest.mark.django_db
def test_kyc_review_is_logged_with_the_person_named(boss, member):
    kyc = KYCProfile.objects.create(
        user=member, legal_full_name="Plain Member", date_of_birth="1990-01-01",
        national_id_number="ID-1", residential_address="Yaoundé", kyc_status=VerificationStatus.PENDING,
    )

    res = client_for(boss).post(f"/api/admin/kyc-reviews/{kyc.id}/reject/", {"reason": "Blurry photo"}, format="json")

    assert res.status_code == 200
    entry = AuditLog.objects.get()
    assert entry.action == "admin-kyc-review/reject"
    assert entry.target_label == "plain_member · Plain Member"
    assert entry.details["reason"] == "Blurry photo"


@pytest.mark.django_db
def test_audit_entries_cannot_be_edited(boss):
    entry = AuditLog.objects.create(actor=boss, actor_username="boss_admin", action="x/y", status_code=200)
    entry.action = "changed"

    with pytest.raises(PermissionError):
        entry.save()


# ---------------------------------------------------------------- safeguards

@pytest.mark.django_db
def test_an_admin_cannot_suspend_or_warn_themselves_or_another_admin(boss, member):
    other = make_admin("other_admin")
    client = client_for(boss)

    for target in (boss, other):
        assert client.post(f"/api/admin/users/{target.id}/toggle-suspend/", {"suspend": True, "days": 5}, format="json").status_code == 403
        assert client.post(f"/api/admin/users/{target.id}/issue-strike/", {"reason": "X"}, format="json").status_code == 403
    other.refresh_from_db()
    assert other.account_status == AccountStatus.ACTIVE
    assert other.warnings.count() == 0


@pytest.mark.django_db
@pytest.mark.parametrize("days", ["abc", 0, -3, 366, None, "12.5"])
def test_suspension_length_must_be_between_1_and_365_days(boss, member, days):
    res = client_for(boss).post(f"/api/admin/users/{member.id}/toggle-suspend/", {"suspend": True, "days": days}, format="json")

    assert res.status_code == 400
    member.refresh_from_db()
    assert member.account_status == AccountStatus.ACTIVE


@pytest.mark.django_db
def test_a_normal_suspension_and_reinstatement_still_work(boss, member):
    client = client_for(boss)

    assert client.post(f"/api/admin/users/{member.id}/toggle-suspend/", {"suspend": True, "days": 30}, format="json").status_code == 200
    member.refresh_from_db()
    assert member.account_status == AccountStatus.SUSPENDED

    assert client.post(f"/api/admin/users/{member.id}/toggle-suspend/", {"suspend": False}, format="json").status_code == 200
    member.refresh_from_db()
    assert member.account_status == AccountStatus.ACTIVE


@pytest.mark.django_db
def test_strike_reason_must_fit(boss, member):
    res = client_for(boss).post(f"/api/admin/users/{member.id}/issue-strike/", {"reason": "x" * 31}, format="json")

    assert res.status_code == 400
    assert member.warnings.count() == 0


@pytest.mark.django_db
def test_only_a_full_access_admin_can_grant_the_admin_role(boss, limited, member):
    denied = client_for(limited).post(f"/api/admin/users/{member.id}/assign-role/", {"role": "admin"}, format="json")
    assert denied.status_code == 403
    assert not AdminProfile.objects.filter(user=member).exists()

    allowed = client_for(boss).post(f"/api/admin/users/{member.id}/assign-role/", {"role": "admin"}, format="json")
    assert allowed.status_code == 200
    assert AdminProfile.objects.filter(user=member).exists()


@pytest.mark.django_db
def test_a_limited_admin_can_still_grant_ordinary_roles(limited, member):
    res = client_for(limited).post(f"/api/admin/users/{member.id}/assign-role/", {"role": "landlord"}, format="json")

    assert res.status_code == 200


@pytest.mark.django_db
def test_admin_role_removal_is_protected(boss, limited):
    other = make_admin("other_admin")

    assert client_for(boss).post(f"/api/admin/users/{boss.id}/remove-role/", {"role": "admin"}, format="json").status_code == 403
    assert client_for(limited).post(f"/api/admin/users/{other.id}/remove-role/", {"role": "admin"}, format="json").status_code == 403
    assert AdminProfile.objects.count() == 3

    assert client_for(boss).post(f"/api/admin/users/{other.id}/remove-role/", {"role": "admin"}, format="json").status_code == 200
    assert not AdminProfile.objects.filter(user=other).exists()


@pytest.mark.django_db
def test_the_last_administrator_can_never_be_removed(boss):
    other = make_admin("other_admin")
    AdminProfile.objects.filter(user=other).delete()  # only `boss` is left

    res = client_for(boss).post(f"/api/admin/users/{boss.id}/remove-role/", {"role": "admin"}, format="json")

    assert res.status_code == 403
    assert AdminProfile.objects.filter(user=boss).exists()


@pytest.mark.django_db
def test_users_list_marks_the_callers_own_row(boss, member):
    rows = client_for(boss).get("/api/admin/users/").data["results"]

    by_name = {row["username"]: row for row in rows}
    assert by_name["boss_admin"]["is_self"] is True
    assert by_name["plain_member"]["is_self"] is False


@pytest.mark.django_db
def test_console_summary_tells_the_ui_whether_the_caller_is_full_access(boss, limited):
    assert client_for(boss).get("/api/admin/console-summary/").data["is_super_admin"] is True
    assert client_for(limited).get("/api/admin/console-summary/").data["is_super_admin"] is False


# ---------------------------------------------------------------- the log endpoint

@pytest.mark.django_db
def test_audit_log_is_for_full_access_admins_only(boss, limited, member):
    assert client_for(boss).get("/api/admin/audit-log/").status_code == 200
    assert client_for(limited).get("/api/admin/audit-log/").status_code == 403
    assert client_for(member).get("/api/admin/audit-log/").status_code == 403
    assert APIClient().get("/api/admin/audit-log/").status_code in (401, 403)


@pytest.mark.django_db
def test_audit_log_cannot_be_changed_over_the_api(boss):
    entry = AuditLog.objects.create(actor=boss, actor_username="boss_admin", action="x/y", status_code=200)
    client = client_for(boss)

    assert client.delete(f"/api/admin/audit-log/{entry.id}/").status_code == 405
    assert client.patch(f"/api/admin/audit-log/{entry.id}/", {"action": "z"}, format="json").status_code == 405
    assert client.post("/api/admin/audit-log/", {"action": "z"}, format="json").status_code == 405


@pytest.mark.django_db
def test_audit_log_filters(boss, member):
    client = client_for(boss)
    client.post(f"/api/admin/users/{member.id}/toggle-suspend/", {"suspend": True, "days": 3}, format="json")
    client.post(f"/api/admin/users/{boss.id}/toggle-suspend/", {"suspend": True, "days": 3}, format="json")  # blocked

    def rows(query=""):
        data = client.get(f"/api/admin/audit-log/{query}").data
        return data["results"]

    assert len(rows()) == 2
    assert [r["target_label"] for r in rows("?outcome=failed")] == ["boss_admin"]
    assert [r["target_label"] for r in rows("?outcome=success")] == ["plain_member"]
    assert [r["target_label"] for r in rows("?q=plain")] == ["plain_member"]
    assert len(rows("?action=admin-user/toggle_suspend")) == 2
    assert rows("?actor=nobody") == []
    assert rows("?since=2999-01-01") == []
    assert len(rows("?since=2000-01-01&until=2999-12-31")) == 2
    assert rows()[0]["actor_username"] == "boss_admin"
    assert rows()[0]["details"]["days"] == 3
