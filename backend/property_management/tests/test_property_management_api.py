"""
Tests for the real property_management API — closing several genuine
gaps at once: maintenance tracking, tenant screening, agent safety
check-ins, and lease creation all had real service functions with
no way to reach them. Most importantly: open_dispute() was never
called anywhere in the real codebase before this.
"""
import pytest
from decimal import Decimal
from datetime import date, timedelta
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.models import Booking, BookingType, BookingStatus, PaymentEscrow, EscrowStatus, PaymentProvider


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def house(db, quarter):
    landlord = User.objects.create(username="pm_landlord", phone="+237699666601")
    return landlord, House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")


# ---------------------------------------------------------------------
# The most critical piece: opening a dispute — this literally could
# not be done by any real user before this fix.
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_the_bookings_own_requester_can_open_a_real_dispute(house):
    landlord, target_house = house
    guest = User.objects.create(username="pm_dispute_guest", phone="+237699666602")
    listing = Listing.objects.create(property_asset=target_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("80000"), idempotency_key="dispute-test-1",
    )
    PaymentEscrow.objects.create(booking=booking, gross_amount_xaf=Decimal("80000"), payee_amount_xaf=Decimal("76000"), provider=PaymentProvider.MTN_MOMO)

    client = _auth_client(guest)
    response = client.post(f"/api/bookings/{booking.id}/open-dispute/", {"reason": "The property did not match the listing description."})

    assert response.status_code == 201
    booking.escrow.refresh_from_db()
    assert booking.escrow.status == EscrowStatus.DISPUTED


@pytest.mark.django_db
def test_only_the_bookings_own_requester_can_open_a_dispute(house):
    landlord, target_house = house
    guest = User.objects.create(username="pm_dispute_guest2", phone="+237699666603")
    stranger = User.objects.create(username="pm_dispute_stranger", phone="+237699666604")
    listing = Listing.objects.create(property_asset=target_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("80000"), idempotency_key="dispute-test-2",
    )
    PaymentEscrow.objects.create(booking=booking, gross_amount_xaf=Decimal("80000"), payee_amount_xaf=Decimal("76000"), provider=PaymentProvider.MTN_MOMO)

    response = _auth_client(stranger).post(f"/api/bookings/{booking.id}/open-dispute/", {"reason": "Not my booking."})

    assert response.status_code == 403


# ---------------------------------------------------------------------
# Maintenance requests
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_creating_a_maintenance_request_and_adding_real_costs(house):
    landlord, target_house = house
    client = _auth_client(landlord)

    create_response = client.post("/api/maintenance-requests/", {
        "property_asset": str(target_house.id), "category": "EMERGENCY", "description": "Burst pipe in the kitchen.",
    })
    assert create_response.status_code == 201
    request_id = create_response.data["id"]

    cost_response = client.post(f"/api/maintenance-requests/{request_id}/add-cost/", {"amount_xaf": "15000", "note": "Plumber call-out fee"})
    assert cost_response.status_code == 201

    detail = client.get(f"/api/maintenance-requests/{request_id}/")
    assert Decimal(detail.data["cost_estimate_xaf"]) == Decimal("15000")
    assert len(detail.data["cost_entries"]) == 1


@pytest.mark.django_db
def test_closing_a_maintenance_request(house):
    landlord, target_house = house
    client = _auth_client(landlord)
    create_response = client.post("/api/maintenance-requests/", {"property_asset": str(target_house.id), "category": "ROUTINE", "description": "Repaint the fence."})
    request_id = create_response.data["id"]

    close_response = client.post(f"/api/maintenance-requests/{request_id}/close/")

    assert close_response.status_code == 200
    assert close_response.data["status"] == "CLOSED"


# ---------------------------------------------------------------------
# Tenant screening — the consent-gated flow
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_screening_report_requires_real_tenant_consent_first():
    landlord = User.objects.create(username="pm_screen_landlord", phone="+237699666605")
    tenant = User.objects.create(username="pm_screen_tenant", phone="+237699666606")
    landlord_client = _auth_client(landlord)

    create_response = landlord_client.post("/api/tenant-screenings/", {"prospective_tenant": str(tenant.id)})
    assert create_response.status_code == 201
    screening_id = create_response.data["id"]

    # Cannot generate a report before consent.
    premature_report = landlord_client.post(f"/api/tenant-screenings/{screening_id}/generate-report/")
    assert premature_report.status_code == 400

    # Only the tenant themselves can grant consent.
    landlord_consent_attempt = landlord_client.post(f"/api/tenant-screenings/{screening_id}/consent/")
    assert landlord_consent_attempt.status_code == 403

    tenant_consent = _auth_client(tenant).post(f"/api/tenant-screenings/{screening_id}/consent/")
    assert tenant_consent.status_code == 200

    real_report = landlord_client.post(f"/api/tenant-screenings/{screening_id}/generate-report/")
    assert real_report.status_code == 200
    assert "completed_bookings" in real_report.data


@pytest.mark.django_db
def test_only_the_landlord_or_the_tenant_can_see_a_screening_request():
    landlord = User.objects.create(username="pm_screen_privacy_landlord", phone="+237699666607")
    tenant = User.objects.create(username="pm_screen_privacy_tenant", phone="+237699666608")
    stranger = User.objects.create(username="pm_screen_privacy_stranger", phone="+237699666609")
    _auth_client(landlord).post("/api/tenant-screenings/", {"prospective_tenant": str(tenant.id)})

    stranger_view = _auth_client(stranger).get("/api/tenant-screenings/")
    tenant_view = _auth_client(tenant).get("/api/tenant-screenings/")

    assert stranger_view.data["count"] == 0
    assert tenant_view.data["count"] == 1


# ---------------------------------------------------------------------
# Agent safety check-ins
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_starting_and_checking_out_of_a_real_safety_check_in(house):
    _landlord, target_house = house
    agent = User.objects.create(username="pm_safety_agent", phone="+237699666610")
    client = _auth_client(agent)

    start_response = client.post("/api/safety-check-ins/", {
        "property_asset": str(target_house.id), "emergency_contact_name": "Marie Ngassa",
        "emergency_contact_phone": "+237699000000", "expected_duration_minutes": 60,
    })
    assert start_response.status_code == 201
    assert start_response.data["status"] == "ACTIVE"
    check_in_id = start_response.data["id"]

    checkout_response = client.post(f"/api/safety-check-ins/{check_in_id}/check-out/")
    assert checkout_response.status_code == 200
    assert checkout_response.data["status"] == "CHECKED_OUT"


@pytest.mark.django_db
def test_checking_out_twice_is_rejected_cleanly(house):
    _landlord, target_house = house
    agent = User.objects.create(username="pm_safety_double_agent", phone="+237699666611")
    client = _auth_client(agent)
    start_response = client.post("/api/safety-check-ins/", {
        "emergency_contact_name": "Marie Ngassa", "emergency_contact_phone": "+237699000000", "expected_duration_minutes": 60,
    })
    check_in_id = start_response.data["id"]
    client.post(f"/api/safety-check-ins/{check_in_id}/check-out/")

    second_checkout = client.post(f"/api/safety-check-ins/{check_in_id}/check-out/")

    assert second_checkout.status_code == 400


# ---------------------------------------------------------------------
# Lease creation
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_creating_a_lease_immediately_schedules_real_renewal_reminders(house):
    landlord, target_house = house
    guest = User.objects.create(username="pm_lease_guest_api", phone="+237699666612")
    listing = Listing.objects.create(property_asset=target_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.COMPLETED, amount_xaf=Decimal("80000"), idempotency_key="lease-api-test-1",
    )
    client = _auth_client(guest)

    response = client.post("/api/leases/", {
        "booking": str(booking.id), "start_date": str(date.today()), "end_date": str(date.today() + timedelta(days=365)),
    })

    assert response.status_code == 201
    from property_management.models import LeaseRenewalReminder
    assert LeaseRenewalReminder.objects.filter(lease_id=response.data["id"]).count() == 3


@pytest.mark.django_db
def test_a_stranger_cannot_create_a_lease_on_someone_elses_booking(house):
    """The real IDOR this closes: any authenticated user could previously
    pass ANY booking id to /api/leases/ and create a lease against a
    booking that wasn't theirs."""
    landlord, target_house = house
    guest = User.objects.create(username="pm_lease_guest_idor", phone="+237699666613")
    stranger = User.objects.create(username="pm_lease_stranger", phone="+237699666614")
    listing = Listing.objects.create(property_asset=target_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.COMPLETED, amount_xaf=Decimal("80000"), idempotency_key="lease-api-test-2",
    )

    response = _auth_client(stranger).post("/api/leases/", {
        "booking": str(booking.id), "start_date": str(date.today()), "end_date": str(date.today() + timedelta(days=365)),
    })

    assert response.status_code == 403
    from property_management.models import Lease
    assert not Lease.objects.filter(booking=booking).exists()


@pytest.mark.django_db
def test_a_lease_cannot_be_created_for_a_booking_that_isnt_completed(house):
    landlord, target_house = house
    guest = User.objects.create(username="pm_lease_guest_notcomplete", phone="+237699666615")
    listing = Listing.objects.create(property_asset=target_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("80000"), idempotency_key="lease-api-test-3",
    )

    response = _auth_client(guest).post("/api/leases/", {
        "booking": str(booking.id), "start_date": str(date.today()), "end_date": str(date.today() + timedelta(days=365)),
    })

    assert response.status_code == 400


@pytest.mark.django_db
def test_dispute_mediation_chat_access_and_posting(house):
    from property_management.models import DisputeCase, DisputeMessage
    from transactions.models import PaymentEscrow, EscrowStatus, PaymentProvider
    from django.utils import timezone
    from datetime import timedelta

    landlord, target_house = house
    guest = User.objects.create(username="pm_dispute_chat_guest", phone="+237699666616")
    stranger = User.objects.create(username="pm_dispute_chat_stranger", phone="+237699666617")
    admin_user = User.objects.create(username="pm_dispute_chat_admin", phone="+237699666618", is_staff=True)
    listing = Listing.objects.create(property_asset=target_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("80000"), idempotency_key="dispute-chat-booking",
    )
    escrow = PaymentEscrow.objects.create(
        booking=booking, gross_amount_xaf=Decimal("80000"), platform_fee_xaf=Decimal("8000"), payee_amount_xaf=Decimal("72000"),
        provider=PaymentProvider.MTN_MOMO, status=EscrowStatus.DISPUTED,
    )
    now = timezone.now()
    dispute = DisputeCase.objects.create(
        escrow=escrow, raised_by=guest, reason="Plumbing leaking on arrival",
        created_at=now, response_due_at=now + timedelta(hours=48), resolution_due_at=now + timedelta(days=7),
    )

    # 1. Complainant (guest) can send a mediation message
    post_resp = _auth_client(guest).post(f"/api/disputes/{dispute.id}/messages/", {"text": "Water is leaking under the sink."})
    assert post_resp.status_code == 201
    assert post_resp.data["text"] == "Water is leaking under the sink."

    # 2. Respondent (landlord) can read and reply
    landlord_get = _auth_client(landlord).get(f"/api/disputes/{dispute.id}/messages/")
    assert landlord_get.status_code == 200
    assert len(landlord_get.data) == 1

    landlord_post = _auth_client(landlord).post(f"/api/disputes/{dispute.id}/messages/", {"text": "I will send a plumber today."})
    assert landlord_post.status_code == 201

    # 3. Admin can read and reply
    admin_get = _auth_client(admin_user).get(f"/api/disputes/{dispute.id}/messages/")
    assert admin_get.status_code == 200
    assert len(admin_get.data) == 2

    # 4. Unrelated stranger is rejected with 403
    stranger_resp = _auth_client(stranger).get(f"/api/disputes/{dispute.id}/messages/")
    assert stranger_resp.status_code == 403
