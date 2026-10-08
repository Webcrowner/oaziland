"""Tests for the Admin Console summary aggregation."""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from social.models import Post
from trust_safety.models import ContentReport, ReportReason
from trust_safety.services import get_admin_console_summary
from engagement.models import VerificationRequest, VerificationRequestType
from engagement.services import submit_verification_request
from property_management.services import open_dispute
from transactions.models import Booking, BookingType, BookingStatus, PaymentEscrow, EscrowStatus


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_admin_console_summary_aggregates_all_queues(quarter):
    reporter = User.objects.create(username="admin_console_reporter", phone="+237699993004")
    author = User.objects.create(username="admin_console_author", phone="+237699993005")
    post = Post.objects.create(author=author, caption="Test post")
    ContentReport.objects.create(reported_by=reporter, reason=ReportReason.SCAM_SUSPECTED, target_post=post)

    submit_verification_request(requester=author, request_type=VerificationRequestType.IDENTITY_VERIFICATION, subject=post)

    landlord = User.objects.create(username="admin_console_landlord", phone="+237699993006")
    guest = User.objects.create(username="admin_console_guest", phone="+237699993007")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    booking = Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id, requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("100000"), idempotency_key="admin-console-test")
    escrow = PaymentEscrow.objects.create(booking=booking, gross_amount_xaf=Decimal("100000"), platform_fee_xaf=Decimal("3000"), payee_amount_xaf=Decimal("97000"), status=EscrowStatus.HELD, provider="MTN_MOMO")
    open_dispute(escrow=escrow, raised_by=guest, reason="Not as described")

    summary = get_admin_console_summary()
    assert summary["open_content_reports"] == 1
    assert summary["pending_verification_requests"] == 1
    assert summary["open_dispute_cases"] == 1


@pytest.mark.django_db
def test_flagged_users_count_reflects_real_suspended_and_warned_users(quarter):
    """Real gap this closes: the admin console's 'users needing
    attention' badge was previously just a client-side count over
    whichever single page of users happened to be loaded — wrong the
    moment there were more users than fit on one page. This is a real
    DB aggregate instead."""
    from identity.models import AccountStatus
    from trust_safety.services import issue_strike_and_apply_consequences

    User.objects.create(username="flagged_summary_active", phone="+237699993008")
    suspended = User.objects.create(username="flagged_summary_suspended", phone="+237699993009", account_status=AccountStatus.SUSPENDED)
    warned = User.objects.create(username="flagged_summary_warned", phone="+237699993010")
    admin = User.objects.create(username="flagged_summary_admin", phone="+237699993011")
    issue_strike_and_apply_consequences(subject=warned, reason="TEST", issued_by=admin)

    summary = get_admin_console_summary()
    assert summary["flagged_users_count"] == 2
    assert suspended.account_status == AccountStatus.SUSPENDED
