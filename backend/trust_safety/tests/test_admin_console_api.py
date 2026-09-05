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
