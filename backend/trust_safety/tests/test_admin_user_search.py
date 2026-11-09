"""Admin user search and the per-user overview."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from identity.models import AdminProfile, KYCProfile, VerificationStatus
from monetization.models import Wallet, WithdrawalRequest, WithdrawalStatus
from trust_safety.models import ContentReport, ReportReason, UserWarning, WarningReason

User = get_user_model()


def make_user(username, phone, **extra):
    return User.objects.create_user(username=username, email=f"{username}@example.com", phone=phone, password="x-Strong-pass-1", **extra)


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def admin(db):
    user = make_user("search_admin", "+237699200001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def people(db):
    amina = make_user("amina.t", "+237699200101", first_name="Amina", last_name="Tchoumi")
    paul = make_user("paulo", "+237699200102", first_name="Paul", last_name="Mbarga")
    KYCProfile.objects.create(
        user=paul, legal_full_name="Paul Roger Mbarga Etoundi", date_of_birth="1990-01-01",
        national_id_number="ID-paul", residential_address="Yaoundé", kyc_status=VerificationStatus.VERIFIED,
    )
    return amina, paul


def names(response):
    return sorted(row["username"] for row in response.data["results"])


# ---------------------------------------------------------------- search

@pytest.mark.django_db
def test_search_matches_username_name_phone_email_and_legal_name(admin, people):
    client = client_for(admin)

    assert names(client.get("/api/admin/users/?q=amina")) == ["amina.t"]
    assert names(client.get("/api/admin/users/?q=Tchoumi")) == ["amina.t"]
    assert names(client.get("/api/admin/users/?q=%2B237699200102")) == ["paulo"]
    assert names(client.get("/api/admin/users/?q=paulo@example")) == ["paulo"]
    assert names(client.get("/api/admin/users/?q=Etoundi")) == ["paulo"]  # legal name from the ID check
    assert names(client.get("/api/admin/users/?q=nobody-by-this-name")) == []


@pytest.mark.django_db
def test_search_is_case_insensitive_and_every_word_must_match(admin, people):
    client = client_for(admin)

    assert names(client.get("/api/admin/users/?q=PAUL%20mbarga")) == ["paulo"]
    assert names(client.get("/api/admin/users/?q=paul%20tchoumi")) == []


@pytest.mark.django_db
def test_search_combines_with_the_status_and_role_filters(admin, people):
    amina, paul = people
    paul.account_status = "SUSPENDED"
    paul.save()
    client = client_for(admin)

    assert names(client.get("/api/admin/users/?q=a&account_status=SUSPENDED")) == ["paulo"]
    assert names(client.get("/api/admin/users/?q=a&role=admin")) == ["search_admin"]


@pytest.mark.django_db
def test_a_blank_search_returns_everyone_and_a_kyc_join_does_not_duplicate_rows(admin, people):
    client = client_for(admin)

    assert client.get("/api/admin/users/?q=%20%20").data["count"] == 3
    assert client.get("/api/admin/users/?q=paul").data["count"] == 1


# ---------------------------------------------------------------- overview

@pytest.mark.django_db
def test_overview_is_admin_only(admin, people):
    amina, paul = people

    assert client_for(amina).get(f"/api/admin/users/{paul.id}/overview/").status_code == 403
    assert APIClient().get(f"/api/admin/users/{paul.id}/overview/").status_code in (401, 403)
    assert client_for(admin).get(f"/api/admin/users/{paul.id}/overview/").status_code == 200


@pytest.mark.django_db
def test_overview_of_a_fresh_account_is_all_zeros_not_errors(admin, people):
    amina, _ = people

    data = client_for(admin).get(f"/api/admin/users/{amina.id}/overview/").data

    assert data["user"]["username"] == "amina.t"
    assert data["kyc"]["status"] == "NONE" and data["kyc"]["legal_name"] == ""
    assert data["wallet"] == {"balance_xaf": "0.00", "pending_withdrawals": 0, "paid_out_xaf": "0.00"}
    assert set(data["activity"].values()) == {0}
    assert data["reports"] == {"filed": 0, "against_open": 0, "against_total": 0}
    assert data["strikes"] == [] and data["last_seen_at"] is None


@pytest.mark.django_db
def test_overview_collects_identity_money_reports_and_strikes(admin, people):
    amina, paul = people
    wallet = Wallet.objects.create(owner=paul, balance_xaf=Decimal("42000"))
    WithdrawalRequest.objects.create(wallet=wallet, amount_xaf=Decimal("10000"), status=WithdrawalStatus.PENDING)
    WithdrawalRequest.objects.create(wallet=wallet, amount_xaf=Decimal("25000"), status=WithdrawalStatus.PAID_OUT)
    ContentReport.objects.create(reported_by=amina, reason=ReportReason.USER_BEHAVIOR, target_user=paul)
    ContentReport.objects.create(reported_by=amina, reason=ReportReason.OTHER, target_user=paul, status="DISMISSED")
    ContentReport.objects.create(reported_by=paul, reason=ReportReason.OTHER, target_user=amina)
    UserWarning.issue_next_strike(paul, WarningReason.ADMIN_REVIEWED_REPORT, issued_by=admin)

    data = client_for(admin).get(f"/api/admin/users/{paul.id}/overview/").data

    assert data["kyc"]["status"] == "VERIFIED" and data["kyc"]["legal_name"] == "Paul Roger Mbarga Etoundi"
    assert data["wallet"] == {"balance_xaf": "42000.00", "pending_withdrawals": 1, "paid_out_xaf": "25000.00"}
    assert data["reports"] == {"filed": 1, "against_open": 1, "against_total": 2}
    assert [(s["number"], s["reason"], s["issued_by"]) for s in data["strikes"]] == [(1, "ADMIN_REVIEWED_REPORT", "search_admin")]
    assert data["user"]["strikes_count"] == 1


@pytest.mark.django_db
def test_overview_of_an_unknown_user_is_404(admin):
    assert client_for(admin).get("/api/admin/users/00000000-0000-0000-0000-000000000000/overview/").status_code == 404


@pytest.mark.django_db
def test_looking_at_an_overview_does_not_write_an_audit_entry(admin, people):
    from trust_safety.models import AuditLog

    client_for(admin).get(f"/api/admin/users/{people[1].id}/overview/")

    assert AuditLog.objects.count() == 0
