"""A reservation is confirmed only when the payment provider says the money arrived (its verified webhook), never
because the app asked to pay. The sandbox gateway, which has no phone approval step, confirms at once."""
import json
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from hotels.models import Reservation, ReservationStatus
from hotels.tests.test_room_types import _book, _client, _guest, _stay, deluxe, hotel  # noqa: F401
from notifications.models import Notification
from payments.gateways import DebitResult, PaymentGateway, WebhookVerificationResult
from transactions.models import Booking, BookingStatus, EscrowStatus


class LiveLikeGateway(PaymentGateway):
    """Not the sandbox: starting a debit only sends a phone prompt, and the provider confirms it later by webhook."""

    def __init__(self, debit_ok=True):
        self.debit_ok = debit_ok
        self.debits = 0

    def initiate_debit(self, *, phone_number, amount_xaf, idempotency_key):
        self.debits += 1
        return DebitResult(success=self.debit_ok, provider_reference="LIVE-REF" if self.debit_ok else "", raw_provider_response={})

    def verify_webhook(self, *, raw_payload, signature_header):
        data = json.loads(raw_payload or b"{}")
        return WebhookVerificationResult(
            is_valid_signature=signature_header == "provider-signature", provider_reference=data.get("transId", ""),
            payment_succeeded=data.get("status") == "SUCCESSFUL", external_id=data.get("externalId", ""),
            amount_xaf=Decimal(str(data["amount"])) if data.get("amount") is not None else None,
        )


@pytest.fixture
def live(monkeypatch):
    gateway = LiveLikeGateway()
    monkeypatch.setattr("payments.gateways.get_active_gateway", lambda: gateway)
    return gateway


def _webhook(booking, status="SUCCESSFUL", signature="provider-signature"):
    return APIClient().post(
        "/api/webhooks/payment/", {"externalId": booking.idempotency_key, "transId": "LIVE-REF", "status": status},
        format="json", HTTP_X_WEBHOOK_SIGNATURE=signature,
    )


def _pay(guest, reservation_id):
    return _client(guest).post(f"/api/reservations/{reservation_id}/pay/", {"phone_number": "+237699000111"}, format="json")


def _reserve(guest, room_type, days_ahead=10):
    check_in, check_out = _stay(days_ahead)
    response = _book(guest, room_type, check_in, check_out)
    assert response.status_code == 201, response.data
    return Reservation.objects.get(pk=response.data["id"])


@pytest.mark.django_db
def test_a_real_payment_confirms_the_reservation_only_when_the_provider_confirms_it(deluxe, live):
    guest = _guest("pay_guest_1")
    reservation = _reserve(guest, deluxe)

    started = _pay(guest, reservation.id)
    assert started.status_code == 202 and started.data["status"] == "PENDING_PAYMENT"
    reservation.refresh_from_db()
    booking = reservation.booking
    assert booking.status == BookingStatus.PAYMENT_PROCESSING and not hasattr(booking, "escrow")

    # While the guest approves on their phone, the room stays held and a second tap doesn't start a second payment.
    assert _book(_guest("pay_guest_2"), deluxe, *_stay(10)).status_code == 409
    assert _pay(guest, reservation.id).status_code == 409

    assert _webhook(booking).status_code == 200
    reservation.refresh_from_db()
    booking.refresh_from_db()
    assert reservation.status == ReservationStatus.CONFIRMED and booking.status == BookingStatus.CONFIRMED
    assert booking.escrow.status == EscrowStatus.HELD
    assert Notification.objects.filter(recipient=deluxe.hotel.owner, notification_type="HOTEL_RESERVATION", title="New reservation").count() == 1

    # The provider repeating its webhook changes nothing.
    assert _webhook(booking).status_code == 200
    assert Notification.objects.filter(recipient=deluxe.hotel.owner, notification_type="HOTEL_RESERVATION").count() == 1


@pytest.mark.django_db
def test_a_forged_or_failed_payment_never_confirms_the_reservation(deluxe, live):
    guest = _guest("pay_guest_3")
    reservation = _reserve(guest, deluxe)
    assert _pay(guest, reservation.id).status_code == 202
    reservation.refresh_from_db()
    booking = reservation.booking

    assert _webhook(booking, signature="forged").status_code == 403
    reservation.refresh_from_db()
    assert reservation.status == ReservationStatus.PENDING_PAYMENT

    assert _webhook(booking, status="FAILED").status_code == 200
    booking.refresh_from_db()
    reservation.refresh_from_db()
    assert booking.status == BookingStatus.PAYMENT_FAILED and reservation.status == ReservationStatus.PENDING_PAYMENT
    assert not hasattr(booking, "escrow")

    # The guest can try again.
    assert _pay(guest, reservation.id).status_code == 202


@pytest.mark.django_db
def test_a_debit_the_provider_refuses_is_reported_and_can_be_retried(deluxe, monkeypatch):
    refusing = LiveLikeGateway(debit_ok=False)
    monkeypatch.setattr("payments.gateways.get_active_gateway", lambda: refusing)
    guest = _guest("pay_guest_4")
    reservation = _reserve(guest, deluxe)
    refused = _pay(guest, reservation.id)
    assert refused.status_code == 400 and "could not be started" in refused.data["detail"]
    reservation.refresh_from_db()
    assert reservation.status == ReservationStatus.PENDING_PAYMENT
    assert reservation.booking.status == BookingStatus.PAYMENT_FAILED

    refusing.debit_ok = True
    assert _pay(guest, reservation.id).status_code == 202


@pytest.mark.django_db
def test_a_payment_that_arrives_after_the_room_was_sold_is_refunded(deluxe, live):
    late = _guest("pay_guest_5")
    slow = _reserve(late, deluxe)
    assert _pay(late, slow.id).status_code == 202
    slow.refresh_from_db()
    booking = slow.booking

    # The hold lapses, so someone else takes the only room.
    Reservation.objects.filter(pk=slow.pk).update(created_at=timezone.now() - timedelta(minutes=30))
    other = _reserve(_guest("pay_guest_6"), deluxe)
    Reservation.objects.filter(pk=other.pk).update(status=ReservationStatus.CONFIRMED)

    assert _webhook(booking).status_code == 200
    slow.refresh_from_db()
    booking.refresh_from_db()
    assert slow.status == ReservationStatus.CANCELLED
    assert booking.escrow.status == EscrowStatus.REFUNDED and booking.status == BookingStatus.CANCELLED
    assert Notification.objects.filter(recipient=late, title="Reservation refunded").exists()


@pytest.mark.django_db
def test_the_sandbox_gateway_confirms_straight_away(deluxe):
    guest = _guest("pay_guest_7")
    reservation = _reserve(guest, deluxe)
    paid = _pay(guest, reservation.id)
    assert paid.status_code == 200 and paid.data["status"] == "CONFIRMED"
    assert Reservation.objects.get(pk=reservation.pk).booking.escrow.status == EscrowStatus.HELD


@pytest.mark.django_db
def test_a_generic_booking_waits_for_the_provider_too(db, live):
    from transactions.locks import get_booking_lock_client
    from transactions.services import reserve_booking
    from transactions.models import BookingType
    import uuid

    guest = _guest("pay_guest_8")
    booking = reserve_booking(
        lock_client=get_booking_lock_client(), requester=guest, booking_type=BookingType.GUEST_HOUSE,
        target_content_type="property.GuestHouseLodge", target_id=uuid.uuid4(), amount_xaf=Decimal("25000"),
    )
    client = _client(guest)
    started = client.post(f"/api/bookings/{booking.id}/pay/", {"phone_number": "+237699000222"}, format="json")
    assert started.status_code == 202 and started.data["status"] == "PAYMENT_PROCESSING"
    assert client.post(f"/api/bookings/{booking.id}/pay/", {"phone_number": "+237699000222"}, format="json").status_code == 409

    assert _webhook(booking).status_code == 200
    booking.refresh_from_db()
    assert booking.status == BookingStatus.CONFIRMED and booking.escrow.status == EscrowStatus.HELD


@pytest.mark.django_db
def test_a_booking_whose_time_to_pay_ran_out_is_not_charged(db, live):
    import uuid
    from django.utils import timezone
    from transactions.locks import get_booking_lock_client
    from transactions.models import BookingType
    from transactions.services import reserve_booking

    guest = _guest("pay_guest_9")
    booking = reserve_booking(
        lock_client=get_booking_lock_client(), requester=guest, booking_type=BookingType.GUEST_HOUSE,
        target_content_type="property.GuestHouseLodge", target_id=uuid.uuid4(), amount_xaf=Decimal("25000"),
    )
    Booking.objects.filter(pk=booking.pk).update(hold_expires_at=timezone.now() - timedelta(minutes=1))

    refused = _client(guest).post(f"/api/bookings/{booking.id}/pay/", {"phone_number": "+237699000333"}, format="json")
    assert refused.status_code == 409 and "ran out" in refused.data["detail"]
    booking.refresh_from_db()
    assert booking.status == BookingStatus.EXPIRED
    assert live.debits == 0  # the phone was never asked for money
