"""
Tests for the real Admin Console API — a genuine gap this closes:
VerificationRequest could be created, ContentReport could be filed,
and DisputeCase already had real service-layer resolution logic — but
NOTHING ever exposed any of it over HTTP for an admin to actually act on.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, AdminProfile
from engagement.models import VerificationRequest, VerificationRequestType, VerificationRequestStatus
from trust_safety.models import ContentReport, ReportReason, ReportStatus, UserWarning
from social.models import Post
from transactions.models import Booking, BookingType, BookingStatus, PaymentEscrow, EscrowStatus
from property_management.models import DisputeCase, DisputeStatus


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def admin_user(db):
    user = User.objects.create(username="console_admin", phone="+237699444401")
    AdminProfile.objects.create(user=user, permissions=[])
    return user


@pytest.fixture
def regular_user(db):
    return User.objects.create(username="console_regular_user", phone="+237699444402")


@pytest.mark.django_db
def test_admin_console_summary_requires_admin_role(admin_user, regular_user):
    admin_response = _auth_client(admin_user).get("/api/admin/console-summary/")
    assert admin_response.status_code == 200
    assert "open_content_reports" in admin_response.data

    regular_response = _auth_client(regular_user).get("/api/admin/console-summary/")
    assert regular_response.status_code == 403

    anon_response = APIClient().get("/api/admin/console-summary/")
    assert anon_response.status_code == 401


@pytest.mark.django_db
def test_verification_request_approve_and_reject_flow(admin_user):
    requester = User.objects.create(username="console_verification_requester", phone="+237699444403")
    import uuid
    request_a = VerificationRequest.objects.create(requester=requester, request_type=VerificationRequestType.IDENTITY_VERIFICATION, subject_content_type="identity.User", subject_id=uuid.uuid4())
    request_b = VerificationRequest.objects.create(requester=requester, request_type=VerificationRequestType.BUSINESS_VERIFICATION, subject_content_type="identity.User", subject_id=uuid.uuid4())

    client = _auth_client(admin_user)
    list_response = client.get("/api/admin/verification-requests/")
    assert list_response.data["count"] == 2

    approve_response = client.post(f"/api/admin/verification-requests/{request_a.id}/approve/")
    assert approve_response.status_code == 200
    assert approve_response.data["status"] == VerificationRequestStatus.APPROVED

    reject_response = client.post(f"/api/admin/verification-requests/{request_b.id}/reject/", {"reason": "Documents unclear"})
    assert reject_response.status_code == 200
    assert reject_response.data["status"] == VerificationRequestStatus.REJECTED

    # Both resolved requests correctly drop out of the pending queue.
    final_list = client.get("/api/admin/verification-requests/")
    assert final_list.data["count"] == 0


@pytest.mark.django_db
def test_content_report_resolve_with_and_without_a_strike(admin_user):
    reporter = User.objects.create(username="console_reporter", phone="+237699444404")
    offender = User.objects.create(username="console_offender", phone="+237699444405")
    post = Post.objects.create(author=offender, caption="A reported post")

    report_dismissed = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.OTHER, target_post=post)
    report_actioned = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.HARASSMENT, target_post=post)

    client = _auth_client(admin_user)

    dismiss_response = client.post(f"/api/admin/content-reports/{report_dismissed.id}/resolve/", {"action_taken": "No violation found."})
    assert dismiss_response.status_code == 200
    assert dismiss_response.data["status"] == ReportStatus.DISMISSED
    assert UserWarning.objects.filter(subject=offender).count() == 0

    strike_response = client.post(f"/api/admin/content-reports/{report_actioned.id}/resolve/", {"action_taken": "Harassment confirmed.", "issue_strike": True})
    assert strike_response.status_code == 200
    assert strike_response.data["status"] == ReportStatus.REVIEWED
    assert UserWarning.objects.filter(subject=offender).count() == 1  # a real strike was actually issued


@pytest.mark.django_db
def test_content_report_resolve_requires_action_taken(admin_user):
    reporter = User.objects.create(username="console_reporter_2", phone="+237699444406")
    offender = User.objects.create(username="console_offender_2", phone="+237699444407")
    post = Post.objects.create(author=offender, caption="Another reported post")
    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.OTHER, target_post=post)

    response = _auth_client(admin_user).post(f"/api/admin/content-reports/{report.id}/resolve/", {})
    assert response.status_code == 400


@pytest.mark.django_db
def test_dispute_respond_and_resolve_flow(admin_user):
    from django.utils import timezone
    from datetime import timedelta

    payer = User.objects.create(username="console_dispute_payer", phone="+237699444408")
    booking = Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id="00000000-0000-0000-0000-000000000000", requester=payer, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("100000"), idempotency_key="console-dispute-1")
    escrow = PaymentEscrow.objects.create(booking=booking, gross_amount_xaf=Decimal("100000"), platform_fee_xaf=Decimal("3000"), payee_amount_xaf=Decimal("97000"), status=EscrowStatus.DISPUTED, provider="MTN_MOMO")
    now = timezone.now()
    dispute = DisputeCase.objects.create(escrow=escrow, raised_by=payer, reason="Property not as described.", created_at=now, response_due_at=now + timedelta(hours=48), resolution_due_at=now + timedelta(days=7))

    client = _auth_client(admin_user)
    list_response = client.get("/api/admin/dispute-cases/")
    assert list_response.data["count"] == 1

    respond_response = client.post(f"/api/admin/dispute-cases/{dispute.id}/respond/")
    assert respond_response.status_code == 200
    assert respond_response.data["status"] == DisputeStatus.ADMIN_RESPONDED

    resolve_response = client.post(f"/api/admin/dispute-cases/{dispute.id}/resolve/", {"outcome": "REFUND", "notes": "Confirmed misrepresentation, refunding the guest."})
    assert resolve_response.status_code == 200
    assert resolve_response.data["status"] == DisputeStatus.RESOLVED

    escrow.refresh_from_db()
    assert escrow.status == EscrowStatus.REFUNDED


@pytest.mark.django_db
def test_admin_property_listing_pending_and_reject(admin_user):
    from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
    from property.models import PropertyAsset, Listing, ListingStatus, ListingType

    country, _ = Country.objects.get_or_create(iso_code="CM", defaults={"name": "Cameroon"})
    region = Region.objects.create(country=country, name="Centre_Admin_Test")
    division = Division.objects.create(name="Mfoundi_Admin_Test", region=region)
    subdiv = Subdivision.objects.create(name="Yaounde_1_Admin_Test", division=division)
    village = VillageOrDistrict.objects.create(name="Yaounde_V_Admin_Test", subdivision=subdiv)
    quarter = Quarter.objects.create(name="Bastos_Admin_Test", village_or_district=village)

    owner = User.objects.create(username="console_owner", phone="+237699444491")
    asset = PropertyAsset.objects.create(owner=owner, quarter=quarter, type="HOUSE", finish_level="MODERN")
    listing = Listing.objects.create(property_asset=asset, listed_by=owner, listing_type=ListingType.RENT, price_xaf=Decimal("150000"), status=ListingStatus.PENDING_REVIEW)

    client = _auth_client(admin_user)
    pending_resp = client.get("/api/listings/pending/")
    assert pending_resp.status_code == 200
    assert any(item["id"] == str(listing.id) for item in pending_resp.data["results"])

    reject_resp = client.post(f"/api/listings/{listing.id}/reject/")
    assert reject_resp.status_code == 200
    listing.refresh_from_db()
    assert listing.status == ListingStatus.REJECTED


@pytest.mark.django_db
def test_admin_welfare_alerts_flow(admin_user):
    from student_hostels.models import WelfareAlert, WelfareAlertReason

    student = User.objects.create(username="welfare_student", phone="+237699444492")
    alert = WelfareAlert.objects.create(student=student, reason=WelfareAlertReason.PAYMENT_DISTRESS, details="Student unable to pay semester fee.")

    client = _auth_client(admin_user)
    list_resp = client.get("/api/admin/welfare-alerts/")
    assert list_resp.status_code == 200
    assert list_resp.data["count"] >= 1

    resolve_resp = client.post(f"/api/admin/welfare-alerts/{alert.id}/resolve/")
    assert resolve_resp.status_code == 200
    assert resolve_resp.data["resolved_at"] is not None
    alert.refresh_from_db()
    assert alert.resolved_at is not None


@pytest.mark.django_db
def test_admin_user_management_flow(admin_user):
    from identity.models import AccountStatus

    user = User.objects.create(username="audited_user", phone="+237699444493")
    client = _auth_client(admin_user)

    list_resp = client.get("/api/admin/users/")
    assert list_resp.status_code == 200
    assert any(u["username"] == "audited_user" for u in list_resp.data["results"])

    suspend_resp = client.post(f"/api/admin/users/{user.id}/toggle-suspend/", {"suspend": True, "days": 15})
    assert suspend_resp.status_code == 200
    user.refresh_from_db()
    assert user.account_status == AccountStatus.SUSPENDED
    assert user.suspended_until is not None

    strike_resp = client.post(f"/api/admin/users/{user.id}/issue-strike/", {"reason": "REPEATED_VIOLATION"})
    assert strike_resp.status_code == 200
    assert strike_resp.data["strike_number"] == 1


@pytest.mark.django_db
def test_admin_can_identify_and_filter_users_by_their_real_role(admin_user):
    """The real gap this closes: the admin console could suspend/warn
    ANY user, but had no way to tell what kind of user they were, or
    filter the list down to just agents, just drivers, etc."""
    from identity.models import AgentProfile, LandlordProfile, StudentProfile

    plain_user = User.objects.create(username="role_filter_plain", phone="+237699444494")
    agent_user = User.objects.create(username="role_filter_agent", phone="+237699444495")
    AgentProfile.objects.create(user=agent_user, agent_commission_percent=10)
    landlord_user = User.objects.create(username="role_filter_landlord", phone="+237699444496")
    LandlordProfile.objects.create(user=landlord_user)
    student_user = User.objects.create(username="role_filter_student", phone="+237699444497")
    StudentProfile.objects.create(user=student_user)

    client = _auth_client(admin_user)

    agent_only = client.get("/api/admin/users/?role=agent")
    assert agent_only.status_code == 200
    agent_usernames = {u["username"] for u in agent_only.data["results"]}
    assert agent_usernames == {"role_filter_agent"}
    assert agent_only.data["results"][0]["is_agent"] is True

    landlord_only = client.get("/api/admin/users/?role=landlord")
    assert {u["username"] for u in landlord_only.data["results"]} == {"role_filter_landlord"}

    regular_only = client.get("/api/admin/users/?role=regular")
    regular_usernames = {u["username"] for u in regular_only.data["results"]}
    assert "role_filter_plain" in regular_usernames
    assert "role_filter_agent" not in regular_usernames
    assert "role_filter_landlord" not in regular_usernames
    assert "role_filter_student" not in regular_usernames


@pytest.mark.django_db
def test_admin_can_assign_multiple_roles_to_the_same_user(admin_user):
    """The real gap this closes: an admin could see that roles are
    stored as independent profile tables (a user CAN be an Agent and a
    Landlord at once), but had no way to actually GRANT an additional
    role — only Django admin/direct DB access could. Confirms a single
    user ends up with several roles simultaneously, and that removing
    one role never disturbs the others."""
    user = User.objects.create(username="multi_role_user", phone="+237699444498")
    client = _auth_client(admin_user)

    resp1 = client.post(f"/api/admin/users/{user.id}/assign-role/", {"role": "landlord"})
    assert resp1.status_code == 200
    assert resp1.data["is_landlord"] is True
    assert resp1.data["is_agent"] is False

    resp2 = client.post(f"/api/admin/users/{user.id}/assign-role/", {"role": "agent", "commission_percent": "7.5"})
    assert resp2.status_code == 200
    assert resp2.data["is_landlord"] is True
    assert resp2.data["is_agent"] is True

    resp3 = client.post(f"/api/admin/users/{user.id}/assign-role/", {"role": "technician"})
    assert resp3.status_code == 200
    assert resp3.data["is_landlord"] is True
    assert resp3.data["is_agent"] is True
    assert resp3.data["is_technician"] is True

    # Assigning the same role twice is idempotent, not an error or a duplicate row.
    from identity.models import LandlordProfile
    resp_dup = client.post(f"/api/admin/users/{user.id}/assign-role/", {"role": "landlord"})
    assert resp_dup.status_code == 200
    assert LandlordProfile.objects.filter(user=user).count() == 1

    unknown_resp = client.post(f"/api/admin/users/{user.id}/assign-role/", {"role": "not_a_real_role"})
    assert unknown_resp.status_code == 400

    # Removing one role leaves the others untouched.
    remove_resp = client.post(f"/api/admin/users/{user.id}/remove-role/", {"role": "agent"})
    assert remove_resp.status_code == 200
    assert remove_resp.data["is_agent"] is False
    assert remove_resp.data["is_landlord"] is True
    assert remove_resp.data["is_technician"] is True


@pytest.mark.django_db
def test_admin_can_grant_admin_role_which_also_sets_is_staff(admin_user):
    user = User.objects.create(username="future_admin_user", phone="+237699444499")
    client = _auth_client(admin_user)

    resp = client.post(f"/api/admin/users/{user.id}/assign-role/", {"role": "admin"})
    assert resp.status_code == 200
    assert resp.data["is_admin"] is True
    user.refresh_from_db()
    assert user.is_staff is True

    remove_resp = client.post(f"/api/admin/users/{user.id}/remove-role/", {"role": "admin"})
    assert remove_resp.status_code == 200
    assert remove_resp.data["is_admin"] is False
    user.refresh_from_db()
    assert user.is_staff is False
