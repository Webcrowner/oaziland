"""Venue deposits and balances are confirmed only by the payment provider's verified webhook."""
from datetime import date, time

import pytest
from rest_framework.test import APIClient

from events.models import EventBooking, EventBookingStatus, EventType
from events.services import create_event_booking
from events.tests.test_availability_and_booking import quarter, venue_space  # noqa: F401
from hotels.tests.test_reservation_payment import _webhook, live  # noqa: F401
from identity.models import User
from monetization.models import PlatformFeePolicy, TransactionCategory
from transactions.models import BookingStatus, EscrowStatus
from decimal import Decimal


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def organiser(db):
    PlatformFeePolicy.objects.get_or_create(category=TransactionCategory.PROPERTY_BOOKING, defaults={"fee_percent": Decimal("5.0")})
    return User.objects.create(username="venue_payer", phone="+237699444001")


@pytest.fixture
def event(venue_space, organiser):
    return create_event_booking(
        organiser=organiser, venue_space=venue_space, event_type=EventType.WEDDING,
        event_date=date(2031, 9, 1), start_time=time(10, 0), end_time=time(14, 0), guest_count=80,
    )


def _pay(user, event, part):
    return _client(user).post(f"/api/event-bookings/{event.id}/pay-{part}/", {"phone_number": "+237699000111"}, format="json")


@pytest.mark.django_db
def test_a_real_deposit_confirms_the_event_only_when_the_provider_confirms_it(event, organiser, live):
    started = _pay(organiser, event, "deposit")
    assert started.status_code == 202 and started.data["status"] == "PENDING"
    event.refresh_from_db()
    assert not hasattr(event.booking, "escrow")
    assert _pay(organiser, event, "deposit").status_code == 409

    assert _webhook(event.booking).status_code == 200
    event.refresh_from_db()
    assert event.status == EventBookingStatus.CONFIRMED
    assert event.booking.status == BookingStatus.CONFIRMED and event.booking.escrow.status == EscrowStatus.HELD
    assert _pay(organiser, event, "deposit").status_code == 409


@pytest.mark.django_db
def test_the_balance_counts_as_paid_only_after_the_provider_confirms_it(event, organiser, live):
    from events.services import EventNotFullyPaidError, complete_event_booking

    assert _pay(organiser, event, "balance").status_code == 409  # nothing to settle before the deposit
    _pay(organiser, event, "deposit")
    _webhook(EventBooking.objects.get(pk=event.pk).booking)

    assert _pay(organiser, event, "balance").status_code == 202
    event.refresh_from_db()
    with pytest.raises(EventNotFullyPaidError):
        complete_event_booking(event_booking=event)

    assert APIClient().post(
        "/api/webhooks/payment/", {"externalId": event.balance_booking.idempotency_key, "transId": "LIVE-REF-2", "status": "SUCCESSFUL"},
        format="json", HTTP_X_WEBHOOK_SIGNATURE="provider-signature",
    ).status_code == 200
    event.refresh_from_db()
    assert event.balance_booking.escrow.status == EscrowStatus.HELD
    complete_event_booking(event_booking=event)
    assert EventBooking.objects.get(pk=event.pk).status == EventBookingStatus.COMPLETED


@pytest.mark.django_db
def test_only_the_organiser_pays_and_a_cancelled_booking_is_refunded(event, organiser, live):
    owner = event.venue_space.venue.owner
    assert _pay(owner, event, "deposit").status_code == 403

    _pay(organiser, event, "deposit")
    EventBooking.objects.filter(pk=event.pk).update(status=EventBookingStatus.CANCELLED)
    event.refresh_from_db()
    assert _webhook(event.booking).status_code == 200
    event.booking.refresh_from_db()
    assert event.booking.escrow.status == EscrowStatus.REFUNDED
    assert organiser.wallet.balance_xaf == event.deposit_amount_xaf


@pytest.mark.django_db
def test_the_sandbox_still_confirms_at_once(event, organiser):
    response = _pay(organiser, event, "deposit")
    assert response.status_code == 200 and response.data["status"] == "CONFIRMED"


@pytest.mark.django_db
def test_a_slot_taken_before_the_payment_arrives_is_refunded(event, organiser, live, venue_space):
    rival = User.objects.create(username="venue_rival", phone="+237699444002")
    other = create_event_booking(
        organiser=rival, venue_space=venue_space, event_type=EventType.WEDDING,
        event_date=event.event_date, start_time=event.start_time, end_time=event.end_time, guest_count=50,
    )
    _pay(organiser, event, "deposit")
    EventBooking.objects.filter(pk=other.pk).update(status=EventBookingStatus.CONFIRMED)  # the rival's deposit landed first

    assert _webhook(EventBooking.objects.get(pk=event.pk).booking).status_code == 200
    event.refresh_from_db()
    assert event.status == EventBookingStatus.CANCELLED
    assert event.booking.escrow.status == EscrowStatus.REFUNDED
    assert organiser.wallet.balance_xaf == event.deposit_amount_xaf
    assert _pay(organiser, event, "deposit").status_code == 409


@pytest.mark.django_db
def test_the_booking_shows_what_has_been_paid(event, organiser):
    before = _client(organiser).get(f"/api/event-bookings/{event.id}/").data
    assert before["deposit_paid"] is False and before["balance_paid"] is False and before["is_organiser"] is True
    _pay(organiser, event, "deposit")
    assert _client(organiser).get(f"/api/event-bookings/{event.id}/").data["deposit_paid"] is True
