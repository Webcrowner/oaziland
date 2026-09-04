"""
Tests proving Prompt 14's two literal acceptance criteria (a maintenance
request logged/costed/closed, and an overdue safety check-in triggering
a real alert) plus lease renewals, consent-gated tenant screening, and
dispute SLA handling.
"""
import pytest
from decimal import Decimal
from datetime import timedelta, date
from django.utils import timezone

from identity.models import User, AdminProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.models import Booking, BookingType, BookingStatus, PaymentEscrow, EscrowStatus
from property_management.models import (
    MaintenanceCategory, MaintenanceStatus, CheckInStatus, TenantScreeningStatus, DisputeStatus,
)
from property_management.services import (
    add_maintenance_cost, schedule_renewal_reminders, send_due_renewal_reminders,
    request_tenant_screening, tenant_grants_consent, generate_screening_report, ConsentRequiredError,
    start_safety_check_in, check_out_safely, process_overdue_check_ins, CheckInAlreadyClosedError,
    open_dispute, admin_respond_to_dispute, resolve_dispute,
)
from notifications.models import Notification


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def landlord(db):
    return User.objects.create(username="pm_landlord", phone="+237699500001")


@pytest.mark.django_db
def test_maintenance_request_logged_costed_and_closed(quarter, landlord):
    from property_management.models import MaintenanceRequest
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    request = MaintenanceRequest.objects.create(
        property_asset=house, reported_by=landlord, category=MaintenanceCategory.ROUTINE,
        description="Leaking kitchen tap",
    )
    assert request.status == MaintenanceStatus.REPORTED

    add_maintenance_cost(request=request, amount_xaf=Decimal("5000"), note="Plumber call-out fee")
    add_maintenance_cost(request=request, amount_xaf=Decimal("3000"), note="Replacement washer")
    request.refresh_from_db()
    assert request.cost_estimate_xaf == Decimal("8000")
    assert request.cost_entries.count() == 2

    request.close()
    assert request.status == MaintenanceStatus.CLOSED
    assert request.resolved_at is not None


@pytest.mark.django_db
def test_safety_check_in_overdue_triggers_a_real_alert(landlord):
    agent = User.objects.create(username="pm_agent", phone="+237699500002")
    admin_user = User.objects.create(username="pm_admin", phone="+237699500003")
    AdminProfile.objects.create(user=admin_user)

    check_in = start_safety_check_in(
        agent=agent, property_asset=None, emergency_contact_name="Marie Doe",
        emergency_contact_phone="+237670000111", expected_duration_minutes=-1,
    )
    assert check_in.status == CheckInStatus.ACTIVE

    alerted = process_overdue_check_ins()
    assert len(alerted) == 1
    check_in.refresh_from_db()
    assert check_in.status == CheckInStatus.ALERT_TRIGGERED

    external_alert = Notification.objects.filter(external_phone_number="+237670000111", notification_type="AGENT_SAFETY_ALERT")
    assert external_alert.exists()
    assert external_alert.first().delivered is True

    admin_alert = Notification.objects.filter(recipient=admin_user, notification_type="AGENT_SAFETY_ALERT")
    assert admin_alert.exists()


@pytest.mark.django_db
def test_checking_out_on_time_prevents_any_alert(landlord):
    agent = User.objects.create(username="ontime_agent", phone="+237699500004")
    check_in = start_safety_check_in(
        agent=agent, property_asset=None, emergency_contact_name="Jean Doe",
        emergency_contact_phone="+237670000222", expected_duration_minutes=60,
    )
    check_out_safely(check_in)
    check_in.refresh_from_db()
    assert check_in.status == CheckInStatus.CHECKED_OUT

    alerted = process_overdue_check_ins()
    assert len(alerted) == 0

    with pytest.raises(CheckInAlreadyClosedError):
        check_out_safely(check_in)


@pytest.mark.django_db
def test_tenant_screening_requires_explicit_tenant_consent(landlord):
    tenant = User.objects.create(username="pm_tenant", phone="+237699500005")
    other_user = User.objects.create(username="pm_impersonator", phone="+237699500006")

    screening = request_tenant_screening(landlord=landlord, prospective_tenant=tenant)
    assert screening.status == TenantScreeningStatus.PENDING_CONSENT

    with pytest.raises(ConsentRequiredError):
        generate_screening_report(screening)

    with pytest.raises(PermissionError):
        tenant_grants_consent(screening_request=screening, tenant=other_user)

    tenant_grants_consent(screening_request=screening, tenant=tenant)
    screening.refresh_from_db()
    assert screening.status == TenantScreeningStatus.CONSENTED

    summary = generate_screening_report(screening)
    assert "completed_bookings" in summary
    screening.refresh_from_db()
    assert screening.status == TenantScreeningStatus.COMPLETED


@pytest.mark.django_db
def test_lease_renewal_reminders_fire_at_the_right_milestones(quarter, landlord):
    from property_management.models import Lease
    guest = User.objects.create(username="pm_lease_guest", phone="+237699500007")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="lease-test-1",
    )
    lease_end = timezone.now().date() + timedelta(days=25)
    lease = Lease.objects.create(booking=booking, start_date=date.today(), end_date=lease_end)
    schedule_renewal_reminders(lease)

    sent = send_due_renewal_reminders(today=timezone.now().date())
    sent_milestones = sorted(r.days_before_end for r in sent)
    assert sent_milestones == [30, 60]

    guest_notifications = Notification.objects.filter(recipient=guest, notification_type="LEASE_RENEWAL_REMINDER")
    assert guest_notifications.count() == 2

    sent_again = send_due_renewal_reminders(today=timezone.now().date())
    assert len(sent_again) == 0


@pytest.mark.django_db
def test_dispute_case_sla_and_resolution(quarter, landlord):
    guest = User.objects.create(username="pm_dispute_guest", phone="+237699500008")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("100000"), idempotency_key="dispute-test-1",
    )
    escrow = PaymentEscrow.objects.create(
        booking=booking, gross_amount_xaf=Decimal("100000"), platform_fee_xaf=Decimal("3000"),
        payee_amount_xaf=Decimal("97000"), status=EscrowStatus.HELD, provider="MTN_MOMO",
    )

    dispute = open_dispute(escrow=escrow, raised_by=guest, reason="Property not as described")
    escrow.refresh_from_db()
    assert escrow.status == EscrowStatus.DISPUTED
    assert dispute.status == DisputeStatus.OPEN

    hours_to_respond = (dispute.response_due_at - dispute.created_at).total_seconds() / 3600
    days_to_resolve = (dispute.resolution_due_at - dispute.created_at).days
    assert round(hours_to_respond) == 48
    assert days_to_resolve == 7

    admin_respond_to_dispute(dispute)
    dispute.refresh_from_db()
    assert dispute.status == DisputeStatus.ADMIN_RESPONDED

    resolve_dispute(dispute=dispute, outcome="REFUND", notes="Confirmed guest's complaint was valid")
    dispute.refresh_from_db()
    escrow.refresh_from_db()
    assert dispute.status == DisputeStatus.RESOLVED
    assert escrow.status == EscrowStatus.REFUNDED
