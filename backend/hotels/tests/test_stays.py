"""What happens to a paid reservation until the owner is paid: cancelling, no-shows, confirming, disputes and the
automatic payout (hotels.stays)."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from hotels.models import Reservation, ReservationStatus
from hotels.stays import first_night_xaf, process_hotel_reservations
from hotels.tests.test_reservation_payment import _pay, _reserve, live  # noqa: F401
from hotels.tests.test_room_types import _book, _client, _guest, _stay, deluxe, hotel  # noqa: F401
from monetization.models import PlatformFeePolicy, TransactionCategory, Wallet
from notifications.models import Notification
from property_management.services import resolve_dispute
from transactions.models import EscrowStatus

PLATFORM_FEE = Decimal("5.0")


@pytest.fixture(autouse=True)
def fee_policy(db):
    from transactions.services import _fee_category_for_booking_type
    category = _fee_category_for_booking_type("HOTEL")
    PlatformFeePolicy.objects.update_or_create(category=category, defaults={"fee_percent": PLATFORM_FEE})


def _balance(user):
    wallet = Wallet.objects.filter(owner=user).first()
    return wallet.balance_xaf if wallet else Decimal("0")


def _paid(deluxe, name, days_ahead=10, nights=2):
    guest = _guest(name)
    check_in, check_out = _stay(days_ahead, nights)
    response = _book(guest, deluxe, check_in, check_out)
    assert response.status_code == 201, response.data
    reservation = Reservation.objects.get(pk=response.data["id"])
    assert _pay(guest, reservation.id).status_code == 200
    reservation.refresh_from_db()
    return guest, reservation


def _dates(reservation, check_in_offset, check_out_offset):
    today = timezone.localdate()
    Reservation.objects.filter(pk=reservation.pk).update(
        check_in=today + timedelta(days=check_in_offset), check_out=today + timedelta(days=check_out_offset),
    )
    reservation.refresh_from_db()
    return reservation


def _act(user, reservation, action, **data):
    return _client(user).post(f"/api/reservations/{reservation.id}/{action}/", data, format="json")


@pytest.mark.django_db
def test_cancelling_early_refunds_the_guest_in_full_and_frees_the_room(deluxe):
    guest, reservation = _paid(deluxe, "stay_guest_1", days_ahead=10)
    assert _act(guest, reservation, "cancel").status_code == 200
    reservation.refresh_from_db()
    assert reservation.status == ReservationStatus.CANCELLED
    assert reservation.booking.escrow.status == EscrowStatus.REFUNDED
    assert _balance(guest) == reservation.rate_xaf and _balance(deluxe.hotel.owner) == 0
    assert Notification.objects.filter(recipient=deluxe.hotel.owner, title="Reservation cancelled").exists()

    check_in, check_out = _stay(10)
    assert _book(_guest("stay_guest_1b"), deluxe, check_in, check_out).status_code == 201  # the only room is free again
    assert _act(guest, reservation, "cancel").status_code == 400  # and it can't be cancelled twice


@pytest.mark.django_db
def test_cancelling_late_keeps_the_first_night_for_the_owner(deluxe):
    guest, reservation = _paid(deluxe, "stay_guest_2", days_ahead=1, nights=3)
    quote = _client(guest).get(f"/api/reservations/{reservation.id}/").data["cancellation"]
    fee = first_night_xaf(reservation)
    assert quote["free"] is False and Decimal(quote["fee_xaf"]) == fee

    assert _act(guest, reservation, "cancel").status_code == 200
    assert _balance(guest) == reservation.rate_xaf - fee
    assert _balance(deluxe.hotel.owner) == fee - (fee * PLATFORM_FEE / 100).quantize(Decimal("1"))


@pytest.mark.django_db
def test_the_owner_cancelling_refunds_the_guest_in_full_and_strangers_cannot_act(deluxe):
    guest, reservation = _paid(deluxe, "stay_guest_3", days_ahead=1, nights=2)
    stranger = _guest("stay_stranger")
    assert _act(stranger, reservation, "cancel").status_code == 404
    assert _act(stranger, reservation, "confirm-stay").status_code == 404

    assert _act(deluxe.hotel.owner, reservation, "cancel").status_code == 200  # even this close to check-in
    assert _balance(guest) == reservation.rate_xaf and _balance(deluxe.hotel.owner) == 0
    assert Notification.objects.filter(recipient=guest, title="Your reservation was cancelled").exists()


@pytest.mark.django_db
def test_a_no_show_keeps_the_first_night_and_only_after_the_day_of_arrival(deluxe):
    guest, reservation = _paid(deluxe, "stay_guest_4", days_ahead=10, nights=3)
    owner = deluxe.hotel.owner
    assert _act(owner, reservation, "no-show").status_code == 400  # too early
    _dates(reservation, -2, 1)
    assert _act(guest, reservation, "no-show").status_code == 400  # only the owner can record it
    assert _act(owner, reservation, "no-show").status_code == 200
    reservation.refresh_from_db()
    fee = first_night_xaf(reservation)
    assert reservation.status == ReservationStatus.NO_SHOW and _balance(guest) == reservation.rate_xaf - fee
    assert _balance(owner) > 0


@pytest.mark.django_db
def test_the_guest_confirming_the_stay_pays_the_owner_once(deluxe):
    guest, reservation = _paid(deluxe, "stay_guest_5", days_ahead=10)
    assert _act(guest, reservation, "confirm-stay").status_code == 400  # the stay hasn't started
    _dates(reservation, -1, 1)
    assert _act(guest, reservation, "confirm-stay").status_code == 200
    reservation.refresh_from_db()
    paid = _balance(deluxe.hotel.owner)
    assert reservation.status == ReservationStatus.CHECKED_OUT and paid == reservation.rate_xaf - (reservation.rate_xaf * PLATFORM_FEE / 100).quantize(Decimal("1"))
    assert _act(guest, reservation, "confirm-stay").status_code == 400
    assert _balance(deluxe.hotel.owner) == paid


@pytest.mark.django_db
def test_the_owner_is_paid_automatically_a_day_after_check_out_and_only_once(deluxe):
    guest, reservation = _paid(deluxe, "stay_guest_6", days_ahead=10)
    _dates(reservation, -3, 0)  # leaves today at noon
    assert process_hotel_reservations(now=timezone.now().replace(hour=13))["paid"] == []  # too soon
    assert _balance(deluxe.hotel.owner) == 0

    later = timezone.now() + timedelta(days=2)
    assert [r.pk for r in process_hotel_reservations(now=later)["paid"]] == [reservation.pk]
    owner_balance = _balance(deluxe.hotel.owner)
    assert owner_balance > 0 and Reservation.objects.get(pk=reservation.pk).status == ReservationStatus.CHECKED_OUT
    assert process_hotel_reservations(now=later)["paid"] == []
    assert _balance(deluxe.hotel.owner) == owner_balance
    assert Notification.objects.filter(recipient=deluxe.hotel.owner, title="Payment released").count() == 1


@pytest.mark.django_db
def test_a_dispute_freezes_the_payment_until_an_admin_decides(deluxe):
    guest, reservation = _paid(deluxe, "stay_guest_7", days_ahead=10)
    _dates(reservation, -1, 0)
    assert _act(guest, reservation, "dispute", reason="x").status_code == 400
    assert _act(guest, reservation, "dispute", reason="The room was not as described").status_code == 200
    reservation.refresh_from_db()
    escrow = reservation.booking.escrow
    assert escrow.status == EscrowStatus.DISPUTED

    # Neither the sweep, nor the guest, nor a checkout can pay the owner while it is frozen.
    assert process_hotel_reservations(now=timezone.now() + timedelta(days=3))["paid"] == []
    assert _act(guest, reservation, "confirm-stay").status_code == 400
    assert _balance(deluxe.hotel.owner) == 0

    resolve_dispute(dispute=escrow.dispute_case, outcome="REFUND", notes="Reviewed")
    reservation.refresh_from_db()
    assert reservation.status == ReservationStatus.CANCELLED and _balance(guest) == reservation.rate_xaf


@pytest.mark.django_db
def test_check_out_pays_the_owner_and_a_later_sweep_does_not_pay_again(deluxe):
    from hotels.models import Room
    from hotels.services import check_in_guest, checkout_guest
    guest, reservation = _paid(deluxe, "stay_guest_8", days_ahead=10)
    owner = deluxe.hotel.owner
    check_in_guest(reservation=reservation, assigned_by=owner)
    reservation.refresh_from_db()
    assert Room.objects.filter(room_type=deluxe, status="OCCUPIED").count() == 1

    checkout_guest(reservation)
    paid = _balance(owner)
    assert paid > 0
    _dates(reservation, -3, -1)
    assert process_hotel_reservations(now=timezone.now() + timedelta(days=3))["paid"] == []
    assert _balance(owner) == paid


@pytest.mark.django_db
def test_a_cancelled_reservation_cannot_be_checked_in(deluxe):
    guest, reservation = _paid(deluxe, "stay_guest_9", days_ahead=10)
    _act(guest, reservation, "cancel")
    reservation.refresh_from_db()
    response = _act(deluxe.hotel.owner, reservation, "check-in")
    assert response.status_code == 400 and "cancelled" in response.data["detail"]


@pytest.mark.django_db
def test_owners_list_the_reservations_at_their_places_and_guests_only_their_own(deluxe):
    guest, reservation = _paid(deluxe, "stay_guest_10", days_ahead=10)
    owner = deluxe.hotel.owner
    hosting = _client(owner).get("/api/reservations/", {"role": "hosting"}).data
    rows = hosting["results"] if isinstance(hosting, dict) else hosting
    assert [r["id"] for r in rows] == [str(reservation.id)]
    assert rows[0]["guest_name"] == "stay_guest_10" and rows[0]["room_type_name"] == deluxe.display_name and rows[0]["payment_held"] is True
    assert _client(guest).get("/api/reservations/", {"role": "hosting"}).data["count"] == 0
    assert _client(guest).get("/api/reservations/").data["count"] == 1
    assert _client(owner).get("/api/reservations/").data["count"] == 0


@pytest.mark.django_db
def test_a_reservation_cannot_be_cancelled_while_its_payment_is_in_flight_and_unpaid_ones_are_tidied(deluxe, live):
    guest = _guest("stay_guest_11")
    check_in, check_out = _stay(10)
    reservation = Reservation.objects.get(pk=_book(guest, deluxe, check_in, check_out).data["id"])
    assert _pay(guest, reservation.id).status_code == 202
    refused = _act(guest, reservation, "cancel")
    assert refused.status_code == 400 and "in progress" in refused.data["detail"]

    abandoned = Reservation.objects.get(pk=_book(_guest("stay_guest_12"), deluxe, *_stay(40)).data["id"])
    Reservation.objects.filter(pk=abandoned.pk).update(created_at=timezone.now() - timedelta(days=2))
    result = process_hotel_reservations()
    assert [r.pk for r in result["cancelled_unpaid"]] == [abandoned.pk]
    assert Reservation.objects.get(pk=reservation.pk).status == ReservationStatus.PENDING_PAYMENT
