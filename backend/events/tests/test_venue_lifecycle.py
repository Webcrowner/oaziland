"""Venue bookings: cancelling, the balance deadline, confirming, disputes and the automatic payout."""
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from events.lifecycle import process_event_bookings
from events.models import EventBooking, EventBookingStatus, EventType
from events.services import create_event_booking
from events.tests.test_availability_and_booking import quarter, venue_space  # noqa: F401
from identity.models import User
from monetization.models import PlatformFeePolicy, TransactionCategory, Wallet
from property_management.models import DisputeCase
from property_management.services import resolve_dispute
from transactions.models import EscrowStatus, PaymentEscrow


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _wallet(user) -> Decimal:
    wallet = Wallet.objects.filter(owner=user).first()
    return wallet.balance_xaf if wallet else Decimal("0")


@pytest.fixture
def organiser(db):
    PlatformFeePolicy.objects.get_or_create(category=TransactionCategory.PROPERTY_BOOKING, defaults={"fee_percent": Decimal("5.0")})
    return User.objects.create(username="lc_organiser", phone="+237699555001")


def _event(venue_space, organiser, days_ahead=30):
    return create_event_booking(
        organiser=organiser, venue_space=venue_space, event_type=EventType.WEDDING,
        event_date=timezone.localdate() + timedelta(days=days_ahead), start_time=time(10, 0), end_time=time(14, 0), guest_count=80,
    )


def _pay(user, event, part):
    response = _client(user).post(f"/api/event-bookings/{event.id}/pay-{part}/", {"phone_number": "+237699000111"}, format="json")
    assert response.status_code == 200, response.data
    event.refresh_from_db()


def _age_payments(event, **delta):
    """Pretend the money was paid `delta` ago."""
    for booking in (event.booking, event.balance_booking):
        if booking is not None:
            PaymentEscrow.objects.filter(booking=booking).update(held_at=timezone.now() - timedelta(**delta))


def _move_event(event, days_from_today):
    EventBooking.objects.filter(pk=event.pk).update(event_date=timezone.localdate() + timedelta(days=days_from_today))
    event.refresh_from_db()


@pytest.fixture
def paid_event(venue_space, organiser):
    event = _event(venue_space, organiser)
    _pay(organiser, event, "deposit")
    _pay(organiser, event, "balance")
    return event


def _cancel(user, event):
    return _client(user).post(f"/api/event-bookings/{event.id}/cancel/", {}, format="json")


@pytest.mark.django_db
def test_cancelling_well_ahead_refunds_everything(paid_event, organiser):
    _age_payments(paid_event, hours=3)
    quote = _client(organiser).get(f"/api/event-bookings/{paid_event.id}/").data["cancellation"]
    assert quote["free"] is True and Decimal(quote["refund_xaf"]) == paid_event.total_cost_xaf

    response = _cancel(organiser, paid_event)
    assert response.status_code == 200 and response.data["status"] == "CANCELLED"
    assert _wallet(organiser) == paid_event.total_cost_xaf
    assert _wallet(paid_event.venue_space.venue.owner) == 0


@pytest.mark.django_db
def test_a_mis_tap_within_fifteen_minutes_is_free_even_close_to_the_event(venue_space, organiser):
    event = _event(venue_space, organiser, days_ahead=3)
    _pay(organiser, event, "deposit")
    assert _cancel(organiser, event).status_code == 200
    assert _wallet(organiser) == event.deposit_amount_xaf
    assert _wallet(event.venue_space.venue.owner) == 0


@pytest.mark.django_db
def test_cancelling_late_costs_the_deposit_but_returns_the_balance(venue_space, organiser):
    event = _event(venue_space, organiser, days_ahead=3)
    _pay(organiser, event, "deposit")
    _pay(organiser, event, "balance")
    _age_payments(event, hours=3)

    quote = _client(organiser).get(f"/api/event-bookings/{event.id}/").data["cancellation"]
    assert quote["free"] is False and Decimal(quote["fee_xaf"]) == event.deposit_amount_xaf

    assert _cancel(organiser, event).status_code == 200
    assert _wallet(organiser) == event.balance_amount_xaf
    # The venue keeps the deposit, less the platform fee.
    assert _wallet(event.venue_space.venue.owner) == event.deposit_amount_xaf * Decimal("0.95")
    assert _cancel(organiser, event).status_code == 400  # already cancelled


@pytest.mark.django_db
def test_the_venue_owner_cancelling_refunds_the_organiser_in_full(venue_space, organiser):
    event = _event(venue_space, organiser, days_ahead=3)
    _pay(organiser, event, "deposit")
    _age_payments(event, hours=3)
    assert _cancel(event.venue_space.venue.owner, event).status_code == 200
    assert _wallet(organiser) == event.deposit_amount_xaf
    assert _wallet(event.venue_space.venue.owner) == 0


@pytest.mark.django_db
def test_strangers_cannot_cancel_and_an_unpaid_booking_just_closes(venue_space, organiser):
    event = _event(venue_space, organiser)
    stranger = User.objects.create(username="lc_stranger", phone="+237699555009")
    assert _cancel(stranger, event).status_code == 404
    assert _cancel(organiser, event).status_code == 200
    assert EventBooking.objects.get(pk=event.pk).status == EventBookingStatus.CANCELLED


@pytest.mark.django_db
def test_the_venue_is_paid_automatically_two_days_after_the_event(paid_event, organiser):
    owner = paid_event.venue_space.venue.owner
    _move_event(paid_event, -1)  # ended yesterday: still inside the dispute window
    process_event_bookings()
    assert _wallet(owner) == 0 and EventBooking.objects.get(pk=paid_event.pk).status == EventBookingStatus.CONFIRMED

    _move_event(paid_event, -3)
    result = process_event_bookings()
    assert len(result["paid"]) == 1
    assert EventBooking.objects.get(pk=paid_event.pk).status == EventBookingStatus.COMPLETED
    assert _wallet(owner) == paid_event.total_cost_xaf * Decimal("0.95")
    assert len(process_event_bookings()["paid"]) == 0  # nothing is paid twice


@pytest.mark.django_db
def test_an_unpaid_balance_cancels_the_booking_and_the_venue_keeps_the_deposit(venue_space, organiser):
    event = _event(venue_space, organiser, days_ahead=3)
    _pay(organiser, event, "deposit")
    _age_payments(event, days=3)

    assert len(process_event_bookings()["cancelled_unpaid_balance"]) == 1
    assert EventBooking.objects.get(pk=event.pk).status == EventBookingStatus.CANCELLED
    assert _wallet(event.venue_space.venue.owner) == event.deposit_amount_xaf * Decimal("0.95")
    assert _wallet(organiser) == 0


@pytest.mark.django_db
def test_a_balance_that_is_not_due_yet_is_left_alone(venue_space, organiser):
    event = _event(venue_space, organiser, days_ahead=30)
    _pay(organiser, event, "deposit")
    _age_payments(event, days=3)
    assert process_event_bookings()["cancelled_unpaid_balance"] == []


@pytest.mark.django_db
def test_nobody_can_settle_an_event_before_it_happens(paid_event, organiser):
    owner = paid_event.venue_space.venue.owner
    assert _client(owner).post(f"/api/event-bookings/{paid_event.id}/complete/", {}, format="json").status_code == 400
    assert _client(organiser).post(f"/api/event-bookings/{paid_event.id}/confirm-event/", {}, format="json").status_code == 400
    assert _client(organiser).post(f"/api/event-bookings/{paid_event.id}/dispute/", {"reason": "It was bad"}, format="json").status_code == 400
    assert _wallet(owner) == 0


@pytest.mark.django_db
def test_the_organiser_confirming_the_event_pays_the_venue_at_once(paid_event, organiser):
    _move_event(paid_event, 0)  # today: the event has started
    EventBooking.objects.filter(pk=paid_event.pk).update(start_time=time(0, 0), end_time=time(1, 0))
    response = _client(organiser).post(f"/api/event-bookings/{paid_event.id}/confirm-event/", {}, format="json")
    assert response.status_code == 200 and response.data["status"] == "COMPLETED"
    assert _wallet(paid_event.venue_space.venue.owner) == paid_event.total_cost_xaf * Decimal("0.95")


@pytest.mark.django_db
def test_the_owner_completing_an_event_credits_their_wallet(paid_event):
    owner = paid_event.venue_space.venue.owner
    _move_event(paid_event, -1)
    response = _client(owner).post(f"/api/event-bookings/{paid_event.id}/complete/", {}, format="json")
    assert response.status_code == 200 and response.data["status"] == "COMPLETED"
    assert _wallet(owner) == paid_event.total_cost_xaf * Decimal("0.95")


@pytest.mark.django_db
def test_a_reported_problem_freezes_the_money_until_an_admin_decides(paid_event, organiser):
    owner = paid_event.venue_space.venue.owner
    _move_event(paid_event, -3)
    response = _client(organiser).post(f"/api/event-bookings/{paid_event.id}/dispute/", {"reason": "The hall was not ready"}, format="json")
    assert response.status_code == 200 and response.data["payment_held"] is False

    assert DisputeCase.objects.count() == 2  # deposit and balance
    assert process_event_bookings()["paid"] == []  # frozen, not paid
    assert _wallet(owner) == 0

    cases = list(DisputeCase.objects.all())
    resolve_dispute(dispute=cases[0], outcome="REFUND")
    assert EventBooking.objects.get(pk=paid_event.pk).status == EventBookingStatus.CONFIRMED  # one payment still frozen
    resolve_dispute(dispute=cases[1], outcome="REFUND")
    assert EventBooking.objects.get(pk=paid_event.pk).status == EventBookingStatus.CANCELLED
    assert _wallet(organiser) == paid_event.total_cost_xaf
    assert set(PaymentEscrow.objects.values_list("status", flat=True)) == {EscrowStatus.REFUNDED}


@pytest.mark.django_db
def test_the_balance_cannot_be_paid_once_the_event_has_started(venue_space, organiser):
    event = _event(venue_space, organiser, days_ahead=3)
    _pay(organiser, event, "deposit")
    _move_event(event, -1)
    response = _client(organiser).post(f"/api/event-bookings/{event.id}/pay-balance/", {"phone_number": "+237699000111"}, format="json")
    assert response.status_code == 409


@pytest.mark.django_db
def test_the_venue_owner_sees_who_booked_and_what_they_will_receive(venue_space, organiser):
    event = _event(venue_space, organiser, days_ahead=3)
    _pay(organiser, event, "deposit")
    _pay(organiser, event, "balance")
    owner = event.venue_space.venue.owner

    as_owner = _client(owner).get(f"/api/event-bookings/{event.id}/").data
    assert as_owner["is_owner"] is True and as_owner["is_organiser"] is False
    assert as_owner["organiser_name"] == "lc_organiser"
    assert Decimal(as_owner["owner_payout_xaf"]) == event.total_cost_xaf * Decimal("0.95")
    assert as_owner["cancellation"]["free"] is True and Decimal(as_owner["cancellation"]["refund_xaf"]) == event.total_cost_xaf

    as_organiser = _client(organiser).get(f"/api/event-bookings/{event.id}/").data
    assert as_organiser["organiser_name"] == "" and as_organiser["owner_payout_xaf"] is None and as_organiser["is_owner"] is False