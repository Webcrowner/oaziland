"""The admin Payments view: money by service, filters, stuck payments, and dispute context."""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from identity.models import AdminProfile, User
from marketplace.models import MarketplaceOrder, RideBooking
from marketplace.tests.test_marketplace_api import _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import _order, _pending_order, deal, fee_policy  # noqa: F401
from services.models import ServiceRequest
from transactions.models import Booking, BookingStatus, BookingType, EscrowStatus, PaymentEscrow
from trust_safety.models import AuditLog


@pytest.fixture
def admin(db):
    user = User.objects.create(username="pay_admin", phone="+237699870001")
    AdminProfile.objects.create(user=user)
    return user


def browse(admin, **params):
    response = _auth_client(admin).get("/api/admin/payments/", params)
    assert response.status_code == 200, response.data
    return response.data


def make_booking(requester, booking_type, content_type, target_id, *, amount="10000", status=BookingStatus.CONFIRMED, escrow=None, fee="500"):
    booking = Booking.objects.create(
        booking_type=booking_type, target_content_type=content_type, target_id=target_id, requester=requester,
        status=status, amount_xaf=Decimal(amount), idempotency_key=f"pay-{uuid.uuid4()}",
    )
    if escrow:
        PaymentEscrow.objects.create(
            booking=booking, gross_amount_xaf=Decimal(amount), platform_fee_xaf=Decimal(fee),
            payee_amount_xaf=Decimal(amount) - Decimal(fee), status=escrow, provider="MTN_MOMO", provider_reference=f"REF-{uuid.uuid4().hex[:8]}",
            refunded_amount_xaf=Decimal(amount) if escrow == EscrowStatus.REFUNDED else Decimal("0"),
        )
    return booking


@pytest.mark.django_db
def test_only_admins_can_see_payments(deal):
    seller, buyer, listing_id = deal
    for client in (_auth_client(buyer), _auth_client(seller)):
        assert client.get("/api/admin/payments/").status_code == 403
        assert client.get("/api/admin/payments/summary/").status_code == 403
    from rest_framework.test import APIClient
    assert APIClient().get("/api/admin/payments/").status_code == 401


@pytest.mark.django_db
def test_a_marketplace_payment_shows_what_was_bought_by_whom_and_where_the_money_is(admin, deal):
    seller, buyer, listing_id = deal
    _order(_auth_client(buyer), listing_id)

    rows = browse(admin, type="MARKETPLACE_ITEM")["results"]

    assert len(rows) == 1
    row = rows[0]
    assert row["title"] == "Warehouse near the port"
    assert row["requester"]["username"] == "mo_buyer" and row["payee"]["username"] == "mo_seller"
    assert row["escrow"]["status"] == "HELD" and row["escrow"]["gross_xaf"] == "1000000.00" and row["escrow"]["fee_xaf"] == "50000.00"
    assert row["escrow"]["provider_reference"] and row["dispute"] is None and row["stuck"] is False


@pytest.mark.django_db
def test_each_kind_of_payment_is_described(admin, deal, quarter):
    seller, buyer, _ = deal
    driver = User.objects.create(username="pay_driver", phone="+237699870010")
    ride = RideBooking.objects.create(
        rider=buyer, driver=driver, pickup_description="Bastos", dropoff_description="Airport", fare_estimate_xaf=Decimal("3000"),
    )
    make_booking(buyer, BookingType.RIDE, "marketplace.RideBooking", ride.id, escrow=EscrowStatus.RELEASED)
    tech = User.objects.create(username="pay_tech", phone="+237699870011")
    job = ServiceRequest.objects.create(requester=buyer, technician=tech, category="PLUMBING", description="Fix the leaking kitchen tap")
    make_booking(buyer, BookingType.SERVICE_REQUEST, "services.ServiceRequest", job.id, escrow=EscrowStatus.HELD)
    from property.models import Listing, ListingType, PropertyAsset
    asset = PropertyAsset.objects.create(owner=seller, quarter=quarter, type="HOUSE")
    flat = Listing.objects.create(property_asset=asset, listed_by=seller, listing_type=ListingType.RENT, price_xaf=Decimal("90000"), status="PUBLISHED")
    make_booking(buyer, BookingType.GENERAL_RENTAL, "property.Listing", flat.id, escrow=EscrowStatus.HELD)
    make_booking(buyer, BookingType.HOSTEL_SEMESTER, "student_hostels.Room", uuid.uuid4(), escrow=EscrowStatus.HELD)

    rows = {r["booking_type"]: r for r in browse(admin)["results"]}

    assert rows["RIDE"]["title"] == "Bastos \u2192 Airport" and rows["RIDE"]["payee"]["username"] == "pay_driver"
    assert rows["SERVICE_REQUEST"]["title"].startswith("Plumbing") and "tap" in rows["SERVICE_REQUEST"]["title"]
    assert rows["SERVICE_REQUEST"]["payee"]["username"] == "pay_tech"
    assert rows["GENERAL_RENTAL"]["title"].startswith("House") and rows["GENERAL_RENTAL"]["payee"]["username"] == "mo_seller"
    assert rows["HOSTEL_SEMESTER"]["title"] == "Hostel Semester" and rows["HOSTEL_SEMESTER"]["payee"] is None  # unknown target: still listed


@pytest.mark.django_db
def test_a_payment_whose_target_was_deleted_still_appears(admin, deal):
    seller, buyer, _ = deal
    make_booking(buyer, BookingType.SERVICE_REQUEST, "services.ServiceRequest", uuid.uuid4(), escrow=EscrowStatus.HELD)

    row = browse(admin, type="SERVICE_REQUEST")["results"][0]
    assert row["title"] == "Service Request (Technician)" and row["payee"] is None


@pytest.mark.django_db
def test_filters_by_type_and_state(admin, deal):
    seller, buyer, _ = deal
    make_booking(buyer, BookingType.HOTEL, "hotels.Reservation", uuid.uuid4(), escrow=EscrowStatus.HELD)
    make_booking(buyer, BookingType.HOTEL, "hotels.Reservation", uuid.uuid4(), escrow=EscrowStatus.RELEASED)
    make_booking(buyer, BookingType.EVENT, "events.EventBooking", uuid.uuid4(), escrow=EscrowStatus.REFUNDED)
    make_booking(buyer, BookingType.RIDE, "marketplace.RideBooking", uuid.uuid4(), status=BookingStatus.PAYMENT_FAILED)
    make_booking(buyer, BookingType.RIDE, "marketplace.RideBooking", uuid.uuid4(), status=BookingStatus.PAYMENT_PROCESSING)

    assert browse(admin)["count"] == 5
    assert browse(admin, type="HOTEL")["count"] == 2
    assert browse(admin, state="held")["count"] == 1
    assert browse(admin, state="refunded")["count"] == 1
    assert browse(admin, state="failed")["count"] == 1
    assert browse(admin, state="processing")["count"] == 1
    assert browse(admin, type="HOTEL", state="released")["count"] == 1
    assert browse(admin, type="EVENT", state="held")["count"] == 0


@pytest.mark.django_db
def test_search_by_payer_phone_provider_reference_and_booking_id(admin, deal):
    seller, buyer, _ = deal
    other = User.objects.create(username="pay_other", phone="+237699870020", first_name="Odile", last_name="Ngo")
    mine = make_booking(buyer, BookingType.HOTEL, "hotels.Reservation", uuid.uuid4(), escrow=EscrowStatus.HELD)
    theirs = make_booking(other, BookingType.HOTEL, "hotels.Reservation", uuid.uuid4(), escrow=EscrowStatus.HELD)

    assert [r["id"] for r in browse(admin, q="odile")["results"]] == [str(theirs.id)]
    assert [r["id"] for r in browse(admin, q="mo_buyer")["results"]] == [str(mine.id)]
    assert [r["id"] for r in browse(admin, q="+237699870020")["results"]] == [str(theirs.id)]
    assert [r["id"] for r in browse(admin, q=mine.escrow.provider_reference)["results"]] == [str(mine.id)]
    assert [r["id"] for r in browse(admin, q=str(theirs.id))["results"]] == [str(theirs.id)]
    assert browse(admin, q="nobody-here")["count"] == 0


@pytest.mark.django_db
def test_date_filters_and_paging(admin, deal):
    seller, buyer, _ = deal
    old = make_booking(buyer, BookingType.HOTEL, "hotels.Reservation", uuid.uuid4(), escrow=EscrowStatus.HELD)
    Booking.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=40))
    for _ in range(21):
        make_booking(buyer, BookingType.HOTEL, "hotels.Reservation", uuid.uuid4(), escrow=EscrowStatus.HELD)

    since = (timezone.now() - timedelta(days=30)).date().isoformat()
    recent = browse(admin, since=since)
    assert recent["count"] == 21 and len(recent["results"]) == 20 and recent["next"]
    assert browse(admin, until=(timezone.now() - timedelta(days=30)).date().isoformat())["count"] == 1


@pytest.mark.django_db
def test_stuck_payments_are_flagged_and_counted(admin, deal):
    seller, buyer, _ = deal
    fresh = make_booking(buyer, BookingType.RIDE, "marketplace.RideBooking", uuid.uuid4(), status=BookingStatus.PAYMENT_PROCESSING)
    stuck = make_booking(buyer, BookingType.RIDE, "marketplace.RideBooking", uuid.uuid4(), status=BookingStatus.PAYMENT_PROCESSING)
    Booking.objects.filter(pk=stuck.pk).update(updated_at=timezone.now() - timedelta(minutes=45))
    make_booking(buyer, BookingType.RIDE, "marketplace.RideBooking", uuid.uuid4(), status=BookingStatus.PAYMENT_FAILED)

    rows = {r["id"]: r for r in browse(admin, state="processing")["results"]}
    assert rows[str(stuck.id)]["stuck"] is True and rows[str(fresh.id)]["stuck"] is False

    summary = _auth_client(admin).get("/api/admin/payments/summary/").data
    assert summary["attention"] == {"stuck": 1, "failed_24h": 1}
    assert _auth_client(admin).get("/api/admin/console-summary/").data["stuck_payments"] == 1


@pytest.mark.django_db
def test_summary_totals_by_service(admin, deal):
    seller, buyer, _ = deal
    make_booking(buyer, BookingType.HOTEL, "hotels.Reservation", uuid.uuid4(), amount="100000", escrow=EscrowStatus.HELD, fee="2000")
    make_booking(buyer, BookingType.HOTEL, "hotels.Reservation", uuid.uuid4(), amount="50000", escrow=EscrowStatus.RELEASED, fee="1000")
    make_booking(buyer, BookingType.RIDE, "marketplace.RideBooking", uuid.uuid4(), amount="3000", escrow=EscrowStatus.DISPUTED, fee="150")
    old = make_booking(buyer, BookingType.EVENT, "events.EventBooking", uuid.uuid4(), amount="999999", escrow=EscrowStatus.HELD)
    PaymentEscrow.objects.filter(pk=old.escrow.pk).update(held_at=timezone.now() - timedelta(days=90))

    data = _auth_client(admin).get("/api/admin/payments/summary/?days=30").data

    assert data["totals"] == {
        "held_xaf": "100000.00", "released_xaf": "50000.00", "refunded_xaf": "0.00", "disputed_xaf": "3000.00", "fees_xaf": "1000.00",
    }
    by_type = {row["booking_type"]: row for row in data["by_type"]}
    assert by_type["HOTEL"]["count"] == 2 and by_type["HOTEL"]["gross_xaf"] == "150000.00" and by_type["HOTEL"]["held_xaf"] == "100000.00"
    assert by_type["RIDE"]["disputed_xaf"] == "3000.00" and "EVENT" not in by_type
    wide = _auth_client(admin).get("/api/admin/payments/summary/?days=365").data
    assert any(row["booking_type"] == "EVENT" for row in wide["by_type"])
    assert _auth_client(admin).get("/api/admin/payments/summary/?days=abc").data["days"] == 30
    assert _auth_client(admin).get("/api/admin/payments/summary/?days=99999").data["days"] == 365


@pytest.mark.django_db
def test_bad_filters_are_rejected(admin):
    client = _auth_client(admin)
    assert client.get("/api/admin/payments/", {"type": "NOPE"}).status_code == 400
    assert client.get("/api/admin/payments/", {"state": "weird"}).status_code == 400


@pytest.mark.django_db
def test_the_view_is_read_only(admin, deal):
    seller, buyer, _ = deal
    booking = make_booking(buyer, BookingType.HOTEL, "hotels.Reservation", uuid.uuid4(), escrow=EscrowStatus.HELD)
    client = _auth_client(admin)

    assert client.post("/api/admin/payments/", {}, format="json").status_code == 405
    assert client.delete(f"/api/admin/payments/{booking.id}/").status_code == 404
    booking.escrow.refresh_from_db()
    assert booking.escrow.status == EscrowStatus.HELD


# ---------------------------------------------------------------- dispute context

@pytest.mark.django_db
def test_a_marketplace_dispute_shows_what_was_bought_and_by_whom(admin, deal):
    seller, buyer, listing_id = deal
    placed = _order(_auth_client(buyer), listing_id)
    reported = _auth_client(buyer).post(f"/api/marketplace-orders/{placed.data['id']}/dispute/", {"reason": "Not as described"}, format="json")
    assert reported.status_code == 200, reported.data

    cases = _auth_client(admin).get("/api/admin/dispute-cases/").data["results"]

    assert len(cases) == 1
    payment = cases[0]["payment"]
    assert payment["booking_type"] == "MARKETPLACE_ITEM" and payment["title"] == "Warehouse near the port"
    assert payment["payer"]["username"] == "mo_buyer" and payment["payee"]["username"] == "mo_seller"
    assert payment["gross_xaf"] == "1000000.00" and payment["escrow_status"] == "DISPUTED"
    assert cases[0]["reason"] == "Not as described"


@pytest.mark.django_db
def test_resolving_the_dispute_updates_the_payment_row(admin, deal):
    seller, buyer, listing_id = deal
    placed = _order(_auth_client(buyer), listing_id)
    _auth_client(buyer).post(f"/api/marketplace-orders/{placed.data['id']}/dispute/", {"reason": "Not as described"}, format="json")
    case = _auth_client(admin).get("/api/admin/dispute-cases/").data["results"][0]

    resolved = _auth_client(admin).post(f"/api/admin/dispute-cases/{case['id']}/resolve/", {"outcome": "REFUND", "notes": "Refunded"}, format="json")
    assert resolved.status_code == 200 and resolved.data["payment"]["title"] == "Warehouse near the port"

    row = browse(admin, type="MARKETPLACE_ITEM")["results"][0]
    assert row["escrow"]["status"] == "REFUNDED" and row["dispute"]["status"] == "RESOLVED"
    assert browse(admin, state="refunded")["count"] == 1
    assert AuditLog.objects.filter(action="admin-dispute-case/resolve", status_code=200).exists()
