"""Data exports are private and expire; account deletion can be requested, cancelled, held while money is open,
and reviewed by admins."""
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient

from compliance.models import DataExportRequest, DataExportRequestStatus
from compliance.services import expire_data_exports
from engagement.models import AccountDeletionRequest, AccountDeletionStatus
from engagement.services import process_due_account_deletions
from identity.models import AdminProfile, KYCProfile, User
from monetization.models import Wallet
from notifications.models import Notification
from trust_safety.models import AuditLog

PASSWORD = "Strong-Pass-123!"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture(autouse=True)
def remove_export_files():
    yield
    for export in DataExportRequest.objects.exclude(export_file=""):
        export.export_file.delete(save=False)


@pytest.fixture
def person(db):
    user = User.objects.create_user(username="pr_person", phone="+237699900001", email="pr@example.com", password=PASSWORD, first_name="Pat", last_name="Person")
    KYCProfile.objects.create(user=user, legal_full_name="Pat Person", date_of_birth=date(1990, 1, 1), national_id_number="PR-ID-1", residential_address="Bastos")
    user.refresh_from_db()
    return user


@pytest.fixture
def admin(db):
    user = User.objects.create_user(username="pr_admin", phone="+237699900002", email="pr_admin@example.com", password=PASSWORD)
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def limited_admin(db):
    user = User.objects.create_user(username="pr_limited", phone="+237699900003", email="pr_limited@example.com", password=PASSWORD)
    AdminProfile.objects.create(user=user, permissions=["reports"])
    return user


# ---------------------------------------------------------------- exports

@pytest.mark.django_db
def test_an_export_is_private_named_randomly_and_only_its_owner_can_download_it(person):
    created = client_for(person).post("/api/data-exports/")
    assert created.status_code == 201 and created.data["downloadable"] is True
    assert "export_file" not in created.data

    export = DataExportRequest.objects.get(pk=created.data["id"])
    stored = Path(export.export_file.path)
    assert str(person.id) not in export.export_file.name
    assert Path(settings.MEDIA_ROOT) not in stored.parents  # never under the publicly served media folder
    assert export.expires_at > timezone.now() + timedelta(days=6)

    download = client_for(person).get(f"/api/data-exports/{export.id}/download/")
    assert download.status_code == 200 and download["Content-Disposition"].startswith("attachment")
    assert b'"legal_full_name": "Pat Person"' in b"".join(download.streaming_content)
    export.refresh_from_db()
    assert export.downloaded_at is not None

    stranger = User.objects.create_user(username="pr_stranger", phone="+237699900004", email="pr_stranger@example.com", password=PASSWORD)
    assert client_for(stranger).get(f"/api/data-exports/{export.id}/download/").status_code == 404
    assert APIClient().get(f"/api/data-exports/{export.id}/download/").status_code == 401


@pytest.mark.django_db
def test_exports_cannot_be_requested_in_a_burst(person):
    client = client_for(person)
    assert client.post("/api/data-exports/").status_code == 201
    assert client.post("/api/data-exports/").status_code == 429
    assert DataExportRequest.objects.filter(user=person).count() == 1


@pytest.mark.django_db
def test_exports_cannot_be_edited_or_deleted_over_the_api(person):
    export_id = client_for(person).post("/api/data-exports/").data["id"]
    assert client_for(person).patch(f"/api/data-exports/{export_id}/", {"status": "FAILED"}, format="json").status_code == 405
    assert client_for(person).delete(f"/api/data-exports/{export_id}/").status_code == 405


@pytest.mark.django_db
def test_an_expired_export_is_deleted_and_can_no_longer_be_downloaded(person):
    export_id = client_for(person).post("/api/data-exports/").data["id"]
    export = DataExportRequest.objects.get(pk=export_id)
    path = Path(export.export_file.path)

    assert expire_data_exports(now=timezone.now() + timedelta(days=8)) == 1

    export.refresh_from_db()
    assert export.status == DataExportRequestStatus.EXPIRED and not export.export_file and not path.exists()
    assert client_for(person).get(f"/api/data-exports/{export_id}/download/").status_code == 410


# ---------------------------------------------------------------- deletion: the user's side

@pytest.mark.django_db
def test_requesting_deletion_needs_the_password_and_can_be_cancelled_then_requested_again(person):
    client = client_for(person)
    assert client.get("/api/account/deletion/").data["status"] == "NONE"
    assert client.post("/api/account/deletion/", {"password": "wrong"}, format="json").status_code == 400

    scheduled = client.post("/api/account/deletion/", {"confirmation": "pr_person", "password": PASSWORD, "reason": "Moving abroad"}, format="json")
    assert scheduled.status_code == 201 and scheduled.data["status"] == "REQUESTED" and scheduled.data["scheduled_for"]
    assert client.post("/api/account/deletion/", {"confirmation": "pr_person", "password": PASSWORD}, format="json").status_code == 400  # already scheduled
    assert Notification.objects.filter(recipient=person, notification_type="ACCOUNT_DELETION").count() == 1

    assert client.delete("/api/account/deletion/").data["status"] == "CANCELLED"
    assert client.delete("/api/account/deletion/").status_code == 400
    again = client.post("/api/account/deletion/", {"confirmation": "pr_person", "password": PASSWORD}, format="json")
    assert again.status_code == 201 and AccountDeletionRequest.objects.filter(user=person).count() == 1


@pytest.mark.django_db
def test_the_username_must_be_typed_exactly_to_schedule_a_deletion(person):
    client = client_for(person)
    for typed in (None, "", "pr_perso", "PR_PERSON", "delete", "someone_else"):
        body = {"password": PASSWORD} if typed is None else {"confirmation": typed, "password": PASSWORD}
        response = client.post("/api/account/deletion/", body, format="json")
        assert response.status_code == 400 and "username" in response.data["detail"]
    assert not AccountDeletionRequest.objects.exists()

    # Surrounding spaces from a copy-paste are forgiven; the name itself must match exactly.
    assert client.post("/api/account/deletion/", {"confirmation": "  pr_person ", "password": PASSWORD}, format="json").status_code == 201


@pytest.mark.django_db
def test_a_french_client_gets_a_french_confirmation_error(person):
    response = client_for(person).post("/api/account/deletion/", {"confirmation": "x", "password": PASSWORD}, format="json", HTTP_ACCEPT_LANGUAGE="fr")
    assert response.status_code == 400 and response.json()["detail"].startswith("Saisissez exactement votre nom d'utilisateur")


@pytest.mark.django_db
def test_admins_cannot_delete_their_own_account_this_way(admin):
    response = client_for(admin).post("/api/account/deletion/", {"confirmation": "pr_admin", "password": PASSWORD}, format="json")
    assert response.status_code == 403 and not AccountDeletionRequest.objects.exists()


@pytest.mark.django_db
def test_money_on_the_account_holds_the_deletion_until_it_is_settled(person):
    Wallet.objects.create(owner=person, balance_xaf=Decimal("2500"))
    client = client_for(person)
    client.post("/api/account/deletion/", {"confirmation": "pr_person", "password": PASSWORD}, format="json")
    assert client.get("/api/account/deletion/").data["blockers"] == ["wallet_balance"]

    later = timezone.now() + timedelta(days=31)
    assert process_due_account_deletions(now=later) == []
    person.refresh_from_db()
    assert person.deleted_at is None

    Wallet.objects.filter(owner=person).update(balance_xaf=0)
    assert len(process_due_account_deletions(now=later)) == 1
    person.refresh_from_db()
    assert person.deleted_at is not None and person.is_active is False


@pytest.mark.django_db
def test_two_deleted_accounts_do_not_collide_and_cannot_sign_in(db):
    from compliance.services import complete_account_deletion
    first = User.objects.create_user(username="pr_one", phone="+237699900011", email="one@example.com", password=PASSWORD)
    second = User.objects.create_user(username="pr_two", phone="+237699900012", email="two@example.com", password=PASSWORD)

    complete_account_deletion(first)
    complete_account_deletion(second)  # previously failed: both got phone "" and email ""

    first.refresh_from_db()
    second.refresh_from_db()
    assert first.phone != second.phone and first.email is None and second.email is None
    login = APIClient().post("/api/auth/login/", {"username": "pr_one", "password": PASSWORD}, format="json")
    assert login.status_code in (400, 401)


@pytest.mark.django_db
def test_deleting_an_account_removes_its_export_files(person):
    from compliance.services import complete_account_deletion
    export_id = client_for(person).post("/api/data-exports/").data["id"]
    path = Path(DataExportRequest.objects.get(pk=export_id).export_file.path)

    complete_account_deletion(person)

    assert not path.exists() and DataExportRequest.objects.get(pk=export_id).status == DataExportRequestStatus.EXPIRED


@pytest.mark.django_db
def test_the_scheduled_command_runs_both_jobs(person):
    from io import StringIO
    from django.core.management import call_command
    client_for(person).post("/api/account/deletion/", {"confirmation": "pr_person", "password": PASSWORD}, format="json")
    AccountDeletionRequest.objects.filter(user=person).update(retention_expires_at=timezone.now() - timedelta(minutes=1))

    out = StringIO()
    call_command("process_privacy_requests", stdout=out)

    assert "Deleted 1 account(s)" in out.getvalue()
    person.refresh_from_db()
    assert person.deleted_at is not None


# ---------------------------------------------------------------- the admin side

@pytest.mark.django_db
def test_admins_see_scheduled_and_blocked_deletions(admin, person):
    Wallet.objects.create(owner=person, balance_xaf=Decimal("2500"))
    client_for(person).post("/api/account/deletion/", {"confirmation": "pr_person", "password": PASSWORD, "reason": "Too many emails"}, format="json")
    client = client_for(admin)

    scheduled = client.get("/api/admin/account-deletions/").data["results"]
    assert len(scheduled) == 1 and scheduled[0]["user"]["username"] == "pr_person" and scheduled[0]["reason"] == "Too many emails"
    assert scheduled[0]["blockers"] == ["wallet_balance"]
    assert client.get("/api/admin/account-deletions/?state=blocked").data["count"] == 0  # not overdue yet

    AccountDeletionRequest.objects.filter(user=person).update(retention_expires_at=timezone.now() - timedelta(days=1))
    assert client.get("/api/admin/account-deletions/?state=blocked").data["count"] == 1
    assert client.get("/api/admin/account-deletions/?q=pat").data["count"] == 1
    assert client.get("/api/admin/account-deletions/?state=weird").status_code == 400
    assert client_for(person).get("/api/admin/account-deletions/").status_code == 403


@pytest.mark.django_db
def test_an_admin_can_stop_a_deletion_with_a_reason_the_user_sees(admin, person):
    client_for(person).post("/api/account/deletion/", {"confirmation": "pr_person", "password": PASSWORD}, format="json")
    item = AccountDeletionRequest.objects.get(user=person)
    client = client_for(admin)

    assert client.post(f"/api/admin/account-deletions/{item.id}/cancel/", {}, format="json").status_code == 400
    response = client.post(f"/api/admin/account-deletions/{item.id}/cancel/", {"reason": "Open court case on this account"}, format="json")

    assert response.status_code == 200 and response.data["status"] == "CANCELLED" and response.data["cancelled_by"] == "pr_admin"
    assert "court case" in Notification.objects.filter(recipient=person, title="Your account deletion was stopped").get().message
    state = client_for(person).get("/api/account/deletion/").data
    assert state["cancelled_by_team"] is True and state["cancellation_reason"] == "Open court case on this account"
    assert AuditLog.objects.filter(action="admin-account-deletion/cancel", status_code=200, target_label="pr_person").exists()


@pytest.mark.django_db
def test_only_a_full_access_admin_can_delete_early_and_never_while_money_is_open(admin, limited_admin, person):
    wallet = Wallet.objects.create(owner=person, balance_xaf=Decimal("100"))
    client_for(person).post("/api/account/deletion/", {"confirmation": "pr_person", "password": PASSWORD}, format="json")
    item = AccountDeletionRequest.objects.get(user=person)

    CONFIRM = {"confirmation": "pr_person"}
    assert client_for(limited_admin).post(f"/api/admin/account-deletions/{item.id}/complete/", CONFIRM, format="json").status_code == 403
    assert client_for(admin).post(f"/api/admin/account-deletions/{item.id}/complete/", CONFIRM, format="json").status_code == 400
    wallet.balance_xaf = 0
    wallet.save()
    # Without typing the account's username (or with the wrong one), nothing happens.
    assert client_for(admin).post(f"/api/admin/account-deletions/{item.id}/complete/").status_code == 400
    assert client_for(admin).post(f"/api/admin/account-deletions/{item.id}/complete/", {"confirmation": "PR_PERSON"}, format="json").status_code == 400
    person.refresh_from_db()
    assert person.deleted_at is None
    response = client_for(admin).post(f"/api/admin/account-deletions/{item.id}/complete/", CONFIRM, format="json")

    assert response.status_code == 200 and response.data["status"] == "COMPLETED" and response.data["user"]["phone"] == ""
    person.refresh_from_db()
    assert person.deleted_at is not None and not hasattr(person, "kyc_profile")
    assert client_for(admin).post(f"/api/admin/account-deletions/{item.id}/complete/", CONFIRM, format="json").status_code == 400


@pytest.mark.django_db
def test_admins_see_export_activity_but_never_the_file(admin, person):
    client_for(person).post("/api/data-exports/")

    rows = client_for(admin).get("/api/admin/data-exports/").data["results"]

    assert len(rows) == 1 and rows[0]["user"]["username"] == "pr_person" and rows[0]["status"] == "READY"
    assert "export_file" not in rows[0] and "url" not in str(rows[0]).lower()
    assert client_for(admin).get("/api/admin/data-exports/?state=expired").data["count"] == 0
    assert client_for(person).get("/api/admin/data-exports/").status_code == 403


@pytest.mark.django_db
def test_the_console_counts_scheduled_deletions(admin, person):
    client_for(person).post("/api/account/deletion/", {"confirmation": "pr_person", "password": PASSWORD}, format="json")
    assert client_for(admin).get("/api/admin/console-summary/").data["scheduled_account_deletions"] == 1
