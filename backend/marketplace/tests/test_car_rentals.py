"""Cars for sale and for rent by the day: full specs with a masked chassis number, Turo-style date bookings with
a calendar, quotes with discounts/driver/delivery, owner-blocked days, browse filters and late cancellations."""
import json
import pytest
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone

from identity.models import User
from marketplace.models import MarketplaceOrder, CarListing
from marketplace.services import process_marketplace_orders
from monetization.models import Wallet
from transactions.models import EscrowStatus
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_marketplace_orders import fee_policy, PHONE  # noqa: F401

SPEC = {
    "make": "Toyota", "model": "RAV4", "year": 2019, "mileage_km": 62000, "engine_size_cc": 2500, "trim": "XLE",
    "body_type": "SUV", "fuel_type": "PETROL", "transmission": "AUTOMATIC", "drivetrain": "AWD",
    "exterior_color": "White", "interior_color": "Black", "doors": 5, "seats": 5, "vehicle_condition": "FOREIGN_USED",
    "customs_cleared": True, "registration_in_seller_name": True, "previous_owners": 1, "accident_free": True,
    "service_history": True, "features": ["AIR_CONDITIONING", "REVERSE_CAMERA", "AIR_CONDITIONING"], "vin": "jtmbfrev0kd123456",
}


def _day(offset):
    return (timezone.localdate() + timedelta(days=offset)).isoformat()


def _post_car(client, quarter, **overrides):
    body = {
        "title": "Toyota RAV4 2019", "price_basis": "RENT_NIGHTLY", "price_xaf": "30000", "security_deposit_xaf": "100000",
        "quarter": str(quarter.id), "vehicle_spec": SPEC, "driver_option": "EITHER", "driver_fee_per_day_xaf": "10000",
        "weekly_discount_pct": 10, "monthly_discount_pct": 25, "min_rental_days": 2, "max_rental_days": 60,
        "daily_km_limit": 250, "extra_km_fee_xaf": "150", "fuel_policy": "SAME_LEVEL", "min_driver_age": 25,
        "min_licence_years": 2, "insurance_included": True, "delivery_available": True, "delivery_fee_xaf": "5000",
    }
    body.update(overrides)
    return client.post("/api/cars/", body, format="json")


@pytest.fixture
def car(quarter):
    owner = _verify(User.objects.create(username="car_owner", phone="+237699800001"))
    renter = _verify(User.objects.create(username="car_renter", phone="+237699800002"))
    created = _post_car(_auth_client(owner), quarter)
    assert created.status_code == 201, created.data
    return owner, renter, created.data["id"]


def _book(client, car_id, start, end, pay=True, **extra):
    response = client.post("/api/marketplace-orders/", {
        "category": "cars", "listing_id": car_id, "phone_number": PHONE, "start_date": start, "end_date": end, **extra,
    }, format="json")
    if response.status_code != 202 or not pay:
        return response
    order = MarketplaceOrder.objects.get(pk=response.data["id"])
    webhook = client.post("/api/webhooks/payment/", data=json.dumps({
        "externalId": order.booking.idempotency_key, "transId": f"TEST-{order.booking.idempotency_key}", "status": "SUCCESSFUL",
    }), content_type="application/json")
    assert webhook.status_code == 200, webhook.data
    return client.get(f"/api/marketplace-orders/{order.id}/")


@pytest.mark.django_db
def test_full_specs_are_saved_and_the_chassis_number_is_only_shown_whole_to_the_lister(car):
    owner, renter, car_id = car
    public = _auth_client(renter).get(f"/api/cars/{car_id}/").data["vehicle_spec"]
    assert public["body_type"] == "SUV" and public["customs_cleared"] is True and public["trim"] == "XLE"
    assert public["features"] == ["AIR_CONDITIONING", "REVERSE_CAMERA"]
    assert public["vin"] == "" and public["vin_last6"] == "…123456"
    assert _auth_client(owner).get(f"/api/cars/{car_id}/").data["vehicle_spec"]["vin"] == "JTMBFREV0KD123456"
    from rest_framework.test import APIClient
    assert APIClient().get(f"/api/cars/{car_id}/").data["vehicle_spec"]["vin"] == ""


@pytest.mark.django_db
def test_car_listing_rules(quarter):
    client = _auth_client(_verify(User.objects.create(username="car_rules", phone="+237699800010")))
    assert _post_car(client, quarter, price_basis="RENT_MONTHLY").status_code == 400
    assert _post_car(client, quarter, vehicle_spec={**SPEC, "features": ["JETPACK"]}).status_code == 400
    assert _post_car(client, quarter, vehicle_spec={**SPEC, "vin": "bad vin!"}).status_code == 400
    assert _post_car(client, quarter, vehicle_spec={**SPEC, "year": timezone.localdate().year + 3}).status_code == 400
    assert _post_car(client, quarter, min_rental_days=10, max_rental_days=5).status_code == 400
    assert _post_car(client, quarter, weekly_discount_pct=90).status_code == 400
    assert _post_car(client, quarter, min_driver_age=16).status_code == 400

    sale = _post_car(client, quarter, price_basis="SALE", price_xaf="9500000", security_deposit_xaf="0", price_negotiable=True)
    assert sale.status_code == 201, sale.data
    assert sale.data["price_negotiable"] is True and sale.data["driver_option"] == "SELF_DRIVE"
    self_drive = _post_car(client, quarter, driver_option="SELF_DRIVE", delivery_available=False, daily_km_limit=None)
    saved = CarListing.objects.get(pk=self_drive.data["id"])
    assert (saved.driver_fee_per_day_xaf, saved.delivery_fee_xaf, saved.extra_km_fee_xaf) == (0, 0, None)


@pytest.mark.django_db
def test_quote_prices_days_with_discounts_driver_and_delivery(car):
    _, renter, car_id = car
    client = _auth_client(renter)
    two_days = client.get(f"/api/cars/{car_id}/quote/?start_date={_day(3)}&end_date={_day(5)}").data
    assert (two_days["days"], two_days["base_xaf"], two_days["discount_pct"], two_days["rent_total_xaf"], two_days["total_xaf"]) == (
        2, "60000", 0, "60000", "160000")
    week = client.get(f"/api/cars/{car_id}/quote/?start_date={_day(3)}&end_date={_day(10)}&with_driver=true&delivery=true").data
    # 7 x 30,000 = 210,000, -10% = 189,000, + 7 x 10,000 driver + 5,000 delivery.
    assert (week["discount_xaf"], week["driver_fee_xaf"], week["delivery_fee_xaf"], week["rent_total_xaf"]) == ("21000", "70000", "5000", "264000")
    month = client.get(f"/api/cars/{car_id}/quote/?start_date={_day(3)}&end_date={_day(31)}").data
    assert month["discount_pct"] == 25

    assert client.get(f"/api/cars/{car_id}/quote/?start_date={_day(3)}&end_date={_day(4)}").status_code == 400  # min 2 days
    assert client.get(f"/api/cars/{car_id}/quote/?start_date={_day(3)}&end_date={_day(70)}").status_code == 400  # max 60
    assert client.get(f"/api/cars/{car_id}/quote/?start_date={_day(-1)}&end_date={_day(3)}").status_code == 400
    assert client.get(f"/api/cars/{car_id}/quote/?start_date={_day(5)}&end_date={_day(3)}").status_code == 400


@pytest.mark.django_db
def test_booking_dates_blocks_them_but_keeps_the_car_listed_for_other_dates(car, fee_policy):
    owner, renter, car_id = car
    booked = _book(_auth_client(renter), car_id, _day(5), _day(8), with_driver=True)
    assert booked.status_code == 200, booked.data
    data = booked.data
    assert data["status"] == "PAID" and data["booked_dates"] is True and data["rental_days"] == 3 and data["with_driver"] is True
    assert (data["amount_xaf"], data["deposit_xaf"], data["total_xaf"]) == ("120000.00", "100000.00", "220000.00")
    assert data["rental_starts_on"] == _day(5) and data["rental_ends_on"] == _day(8)
    assert data["free_cancellation_until"] and data["seller_deadline"]
    order = MarketplaceOrder.objects.get(pk=data["id"])
    assert order.booking.escrow.gross_amount_xaf == Decimal("120000.00") and order.deposit_booking.escrow.gross_amount_xaf == Decimal("100000.00")
    assert CarListing.objects.get(pk=car_id).availability_status == "AVAILABLE"

    other = _verify(User.objects.create(username="car_other", phone="+237699800003"))
    other_client = _auth_client(other)
    assert _book(other_client, car_id, _day(7), _day(10)).status_code == 400  # overlaps
    assert _book(other_client, car_id, _day(8), _day(10)).status_code == 200  # starts the day it comes back

    busy = _auth_client(renter).get(f"/api/cars/{car_id}/availability/").data["busy"]
    assert busy == [{"start": _day(5), "end": _day(8)}, {"start": _day(8), "end": _day(10)}]
    assert _book(_auth_client(owner), car_id, _day(20), _day(22)).status_code == 400  # own car
    no_dates = other_client.post("/api/marketplace-orders/", {"category": "cars", "listing_id": car_id, "phone_number": PHONE}, format="json")
    assert no_dates.status_code == 400


@pytest.mark.django_db
def test_the_owner_can_still_pause_and_reprice_a_car_with_bookings(car, fee_policy):
    owner, renter, car_id = car
    _book(_auth_client(renter), car_id, _day(5), _day(8))
    client = _auth_client(owner)
    assert client.patch(f"/api/cars/{car_id}/", {"price_xaf": "35000"}, format="json").status_code == 200
    assert MarketplaceOrder.objects.get(listing_id=car_id).amount_xaf == Decimal("90000.00")
    assert client.post(f"/api/cars/{car_id}/set-status/", {"status": "UNAVAILABLE"}, format="json").status_code == 200


@pytest.mark.django_db
def test_owner_blocked_days_close_the_calendar_and_only_the_owner_manages_them(car):
    owner, renter, car_id = car
    owner_client = _auth_client(owner)
    blocked = owner_client.post(f"/api/cars/{car_id}/blocked-dates/", {"starts_on": _day(10), "ends_on": _day(12), "note": "Servicing"}, format="json")
    assert blocked.status_code == 201, blocked.data
    assert _auth_client(renter).post(f"/api/cars/{car_id}/blocked-dates/", {"starts_on": _day(20), "ends_on": _day(22)}, format="json").status_code == 403
    assert _auth_client(renter).get(f"/api/cars/{car_id}/quote/?start_date={_day(9)}&end_date={_day(11)}").status_code == 400
    public = _auth_client(renter).get(f"/api/cars/{car_id}/availability/").data["busy"]
    assert public == [{"start": _day(10), "end": _day(12)}]
    mine = owner_client.get(f"/api/cars/{car_id}/availability/").data["busy"]
    assert mine[0]["kind"] == "blocked" and mine[0]["note"] == "Servicing"
    assert owner_client.post(f"/api/cars/{car_id}/blocked-dates/", {"starts_on": _day(5), "ends_on": _day(3)}, format="json").status_code == 400

    assert owner_client.delete(f"/api/cars/{car_id}/blocked-dates/{blocked.data['id']}/").status_code == 204
    assert _auth_client(renter).get(f"/api/cars/{car_id}/quote/?start_date={_day(9)}&end_date={_day(11)}").status_code == 200


@pytest.mark.django_db
def test_booked_days_cannot_be_blocked(car, fee_policy):
    owner, renter, car_id = car
    _book(_auth_client(renter), car_id, _day(5), _day(8))
    response = _auth_client(owner).post(f"/api/cars/{car_id}/blocked-dates/", {"starts_on": _day(6), "ends_on": _day(7)}, format="json")
    assert response.status_code == 409


@pytest.mark.django_db
def test_handover_opens_the_day_before_the_start(car, fee_policy):
    owner, renter, car_id = car
    far = _book(_auth_client(renter), car_id, _day(5), _day(8)).data
    assert _auth_client(owner).post(f"/api/marketplace-orders/{far['id']}/hand-over/").status_code == 400
    soon = _book(_auth_client(renter), car_id, _day(1), _day(3)).data
    handed = _auth_client(owner).post(f"/api/marketplace-orders/{soon['id']}/hand-over/")
    assert handed.status_code == 200 and handed.data["rental_starts_on"] == _day(1) and handed.data["rental_ends_on"] == _day(3)


@pytest.mark.django_db
def test_cancelling_early_is_free_but_late_keeps_one_day_for_the_owner(car, fee_policy):
    owner, renter, car_id = car
    client = _auth_client(renter)
    early = _book(client, car_id, _day(5), _day(8)).data
    assert client.post(f"/api/marketplace-orders/{early['id']}/cancel/").data["status"] == "CANCELLED"
    assert MarketplaceOrder.objects.get(pk=early["id"]).booking.escrow.status == EscrowStatus.REFUNDED

    late = _book(client, car_id, _day(0), _day(3)).data
    cancelled = client.post(f"/api/marketplace-orders/{late['id']}/cancel/")
    assert cancelled.status_code == 200 and cancelled.data["status"] == "CANCELLED"
    escrow = MarketplaceOrder.objects.get(pk=late["id"]).booking.escrow
    # One day (30,000) to the owner minus the 5% fee; the other two days and the deposit back to the renter.
    assert (escrow.refunded_amount_xaf, escrow.payee_amount_xaf) == (Decimal("60000.00"), Decimal("28500.00"))
    assert Wallet.objects.get(owner=owner).balance_xaf == Decimal("28500.00")
    assert Wallet.objects.get(owner=renter).balance_xaf == Decimal("160000.00")
    # The cancelled days are free again.
    assert client.get(f"/api/cars/{car_id}/quote/?start_date={_day(0)}&end_date={_day(3)}").status_code == 200


@pytest.mark.django_db
def test_the_sweep_refunds_a_rental_never_handed_over_after_its_start(car, fee_policy):
    owner, renter, car_id = car
    order = MarketplaceOrder.objects.get(pk=_book(_auth_client(renter), car_id, _day(1), _day(3)).data["id"])
    assert process_marketplace_orders(now=timezone.now() + timedelta(days=2))["refunded"] == []
    result = process_marketplace_orders(now=timezone.now() + timedelta(days=3))
    assert [o.pk for o in result["refunded"]] == [order.pk]
    order.refresh_from_db()
    assert order.status == "CANCELLED" and CarListing.objects.get(pk=car_id).availability_status == "AVAILABLE"


@pytest.mark.django_db
def test_car_browse_filters(quarter, fee_policy):
    owner = _verify(User.objects.create(username="car_filters", phone="+237699800020"))
    renter = _verify(User.objects.create(username="car_filters_r", phone="+237699800021"))
    client = _auth_client(owner)
    rav = _post_car(client, quarter, title="RAV4").data["id"]
    _post_car(client, quarter, title="Hilux", driver_option="SELF_DRIVE", delivery_available=False,
              vehicle_spec={**SPEC, "make": "Toyota", "model": "Hilux", "body_type": "PICKUP", "fuel_type": "DIESEL", "transmission": "MANUAL", "seats": 5, "customs_cleared": False})
    _post_car(client, quarter, title="Prado for sale", price_basis="SALE", price_xaf="25000000", security_deposit_xaf="0", price_negotiable=True,
              vehicle_spec={**SPEC, "model": "Prado", "seats": 7, "fuel_type": "DIESEL"})
    _book(_auth_client(renter), rav, _day(5), _day(8))

    def titles(query):
        response = _auth_client(renter).get(f"/api/cars/?{query}")
        assert response.status_code == 200, response.data
        return sorted(r["title"] for r in response.data["results"])

    assert titles("body_type=PICKUP") == ["Hilux"]
    assert titles("fuel_type=DIESEL") == ["Hilux", "Prado for sale"]
    assert titles("transmission=AUTOMATIC&price_basis=RENT_NIGHTLY") == ["RAV4"]
    assert titles("min_seats=7") == ["Prado for sale"]
    assert titles("customs_cleared=1") == ["Prado for sale", "RAV4"]
    assert titles("with_driver=1") == ["RAV4"]
    assert titles("delivery=1") == ["RAV4"]
    assert titles("negotiable=1") == ["Prado for sale"]
    assert titles(f"available_from={_day(6)}&available_to={_day(7)}") == ["Hilux"]
    assert titles(f"available_from={_day(8)}&available_to={_day(9)}") == ["Hilux", "RAV4"]
    assert _auth_client(renter).get("/api/cars/?body_type=SPACESHIP").status_code == 400
    assert _auth_client(renter).get(f"/api/cars/?available_from={_day(9)}&available_to={_day(8)}").status_code == 400

    similar = _auth_client(renter).get(f"/api/cars/{rav}/similar/").data
    assert [s["title"] for s in similar] == ["Hilux"]  # same make, also for rent; the sale car is excluded


@pytest.mark.django_db
def test_model_filter_and_car_sorts(quarter):
    client = _auth_client(_verify(User.objects.create(username="car_sorts", phone="+237699800030")))
    for title, model, year, km in (("A", "Corolla", 2015, 120000), ("B", "Camry", 2020, 40000), ("C", "Corolla", 2018, None)):
        assert _post_car(client, quarter, title=title, price_basis="SALE", price_xaf="5000000", security_deposit_xaf="0",
                         vehicle_spec={**SPEC, "model": model, "year": year, "mileage_km": km}).status_code == 201

    def titles(query):
        response = client.get(f"/api/cars/?{query}")
        assert response.status_code == 200, response.data
        return [r["title"] for r in response.data["results"]]

    assert sorted(titles("model=corol")) == ["A", "C"]
    assert titles("ordering=year_desc") == ["B", "C", "A"]
    assert titles("ordering=year_asc") == ["A", "C", "B"]
    assert titles("ordering=mileage_asc") == ["B", "A", "C"]  # a car with no mileage given goes last
    assert client.get("/api/marketplace-feed/?ordering=year_desc").status_code == 400
    assert client.get("/api/stores/?ordering=year_desc").status_code == 200  # other lists just keep the default order


@pytest.fixture
def request_car(quarter):
    owner = _verify(User.objects.create(username="req_owner", phone="+237699800040"))
    renter = _verify(User.objects.create(username="req_renter", phone="+237699800041"))
    created = _post_car(_auth_client(owner), quarter, instant_book=False)
    assert created.status_code == 201 and created.data["instant_book"] is False
    return owner, renter, created.data["id"]


@pytest.mark.django_db
def test_without_instant_book_the_owner_must_accept_before_the_handover(request_car, fee_policy):
    owner, renter, car_id = request_car
    data = _book(_auth_client(renter), car_id, _day(1), _day(3)).data
    assert data["status"] == "PAID" and data["needs_approval"] is True and data["approval_deadline"]
    assert data["free_cancellation_until"] is None
    from notifications.models import Notification
    assert Notification.objects.filter(recipient=owner, title="New booking request").exists()
    # The days are held while the owner decides.
    assert _auth_client(renter).get(f"/api/cars/{car_id}/quote/?start_date={_day(1)}&end_date={_day(3)}").status_code == 400

    owner_client = _auth_client(owner)
    assert owner_client.post(f"/api/marketplace-orders/{data['id']}/hand-over/").status_code == 400
    assert _auth_client(renter).post(f"/api/marketplace-orders/{data['id']}/confirm/").status_code == 400
    assert _auth_client(renter).post(f"/api/marketplace-orders/{data['id']}/approve/").status_code == 403
    approved = owner_client.post(f"/api/marketplace-orders/{data['id']}/approve/")
    assert approved.status_code == 200 and approved.data["owner_approved_at"] and approved.data["approval_deadline"] is None
    assert owner_client.post(f"/api/marketplace-orders/{data['id']}/approve/").status_code == 400
    assert owner_client.post(f"/api/marketplace-orders/{data['id']}/hand-over/").status_code == 200


@pytest.mark.django_db
def test_a_request_is_free_to_cancel_and_the_owner_can_decline_it(request_car, fee_policy):
    owner, renter, car_id = request_car
    client = _auth_client(renter)
    soon = _book(client, car_id, _day(0), _day(2)).data
    # Starting today, but not accepted yet, so no late-cancellation fee.
    assert client.post(f"/api/marketplace-orders/{soon['id']}/cancel/").data["status"] == "CANCELLED"
    assert MarketplaceOrder.objects.get(pk=soon["id"]).booking.escrow.status == EscrowStatus.REFUNDED
    later = _book(client, car_id, _day(5), _day(7)).data
    assert _auth_client(owner).post(f"/api/marketplace-orders/{later['id']}/decline/").data["status"] == "CANCELLED"


@pytest.mark.django_db
def test_an_unanswered_request_expires_and_is_refunded(request_car, fee_policy):
    owner, renter, car_id = request_car
    order = MarketplaceOrder.objects.get(pk=_book(_auth_client(renter), car_id, _day(5), _day(7)).data["id"])
    assert process_marketplace_orders(now=timezone.now() + timedelta(hours=23))["refunded"] == []
    result = process_marketplace_orders(now=timezone.now() + timedelta(hours=25))
    assert [o.pk for o in result["refunded"]] == [order.pk]
    order.refresh_from_db()
    assert order.status == "CANCELLED"


@pytest.mark.django_db
def test_instant_book_filter(quarter):
    client = _auth_client(_verify(User.objects.create(username="car_ib", phone="+237699800050")))
    _post_car(client, quarter, title="Instant")
    _post_car(client, quarter, title="Request", instant_book=False)
    assert [r["title"] for r in client.get("/api/cars/?instant_book=1").data["results"]] == ["Instant"]