"""A payment the provider confirms must never be stranded: if its booking can no longer be confirmed, the money goes
back to the payer's Oaziland wallet (once), instead of the webhook being turned away with the provider holding it."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from hotels.models import Reservation, ReservationStatus
from hotels.tests.test_reservation_payment import _pay, _reserve, _webhook, live  # noqa: F401
from hotels.tests.test_room_types import _guest, deluxe, hotel  # noqa: F401
from marketplace.models import GoodsListing, MarketplaceOrder, MarketplaceOrderStatus
from marketplace.tests.test_goods_listings import _auth_client, _buy, _buyer, seller, stocked  # noqa: F401
from marketplace.tests.test_marketplace_api import quarter  # noqa: F401
from monetization.models import Wallet, WalletTransaction
from notifications.models import Notification
from transactions.models import Booking, BookingStatus, EscrowStatus


def _balance(user):
    wallet = Wallet.objects.filter(owner=user).first()
    return wallet.balance_xaf if wallet else Decimal("0")


def _started(deluxe, name):
    guest = _guest(name)
    reservation = _reserve(guest, deluxe)
    assert _pay(guest, reservation.id).status_code == 202
    reservation.refresh_from_db()
    return guest, reservation, reservation.booking


@pytest.mark.django_db
def test_a_payment_approved_after_the_hold_ran_out_is_returned_to_the_wallet_once(deluxe, live):
    guest, reservation, booking = _started(deluxe, "late_guest_1")
    Booking.objects.filter(pk=booking.pk).update(hold_expires_at=timezone.now() - timedelta(minutes=3))

    answered = _webhook(booking)
    assert answered.status_code == 200 and "refunded" in answered.data["detail"]
    booking.refresh_from_db()
    assert booking.status == BookingStatus.CANCELLED
    assert booking.escrow.status == EscrowStatus.REFUNDED and booking.escrow.gross_amount_xaf == booking.amount_xaf
    assert _balance(guest) == booking.amount_xaf
    assert WalletTransaction.objects.filter(wallet__owner=guest, transaction_type="REFUND", amount_xaf=booking.amount_xaf).count() == 1
    assert Notification.objects.filter(recipient=guest, notification_type="PAYMENT_REFUNDED").count() == 1
    assert Reservation.objects.get(pk=reservation.pk).status == ReservationStatus.PENDING_PAYMENT

    # The provider delivering the same webhook again must not credit the wallet twice.
    assert _webhook(booking).status_code == 200
    assert _balance(guest) == booking.amount_xaf
    assert Notification.objects.filter(recipient=guest, notification_type="PAYMENT_REFUNDED").count() == 1


@pytest.mark.django_db
def test_a_payment_for_a_booking_that_already_expired_or_failed_is_returned_too(deluxe, live):
    guest, _reservation, booking = _started(deluxe, "late_guest_2")
    Booking.objects.filter(pk=booking.pk).update(status=BookingStatus.PAYMENT_FAILED)

    assert _webhook(booking).status_code == 200
    booking.refresh_from_db()
    assert booking.escrow.status == EscrowStatus.REFUNDED and _balance(guest) == booking.amount_xaf


@pytest.mark.django_db
def test_forged_or_unsuccessful_late_webhooks_move_no_money(deluxe, live):
    guest, _reservation, booking = _started(deluxe, "late_guest_3")
    Booking.objects.filter(pk=booking.pk).update(hold_expires_at=timezone.now() - timedelta(minutes=3))

    assert _webhook(booking, signature="forged").status_code == 403
    # The provider reporting the payment failed is recorded as a failure, and repeating it changes nothing more.
    assert _webhook(booking, status="FAILED").status_code == 200
    assert _webhook(booking, status="FAILED").status_code == 409
    booking.refresh_from_db()
    assert booking.status == BookingStatus.PAYMENT_FAILED
    assert not hasattr(booking, "escrow") and _balance(guest) == 0


@pytest.mark.django_db
def test_a_late_payment_for_a_marketplace_order_refunds_the_buyer_and_frees_the_stock(stocked, live):
    buyer = _buyer("late_buyer_1", "+237699500041")
    started = _buy(_auth_client(buyer), stocked, quantity=2, confirm=False)
    assert started.status_code == 202
    order = MarketplaceOrder.objects.get(pk=started.data["id"])
    assert GoodsListing.objects.get(pk=stocked).quantity == 3
    Booking.objects.filter(pk=order.booking_id).update(hold_expires_at=timezone.now() - timedelta(minutes=3))

    assert _webhook(order.booking).status_code == 200
    order.refresh_from_db()
    assert order.status == MarketplaceOrderStatus.CANCELLED
    assert GoodsListing.objects.get(pk=stocked).quantity == 5
    assert _balance(buyer) == order.booking.amount_xaf


@pytest.mark.django_db
def test_a_reservation_whose_room_was_sold_meanwhile_is_refunded_to_the_wallet(deluxe, live):
    from hotels.tests.test_room_types import _book, _stay  # noqa: F401
    late, slow, booking = _started(deluxe, "late_guest_4")
    Reservation.objects.filter(pk=slow.pk).update(created_at=timezone.now() - timedelta(minutes=30))
    other = _reserve(_guest("late_guest_5"), deluxe)
    Reservation.objects.filter(pk=other.pk).update(status=ReservationStatus.CONFIRMED)

    assert _webhook(booking).status_code == 200
    booking.refresh_from_db()
    assert Reservation.objects.get(pk=slow.pk).status == ReservationStatus.CANCELLED
    assert booking.escrow.status == EscrowStatus.REFUNDED and _balance(late) == booking.amount_xaf
