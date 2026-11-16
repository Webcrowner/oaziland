"""Technician jobs and rides are confirmed only by the payment provider's verified webhook, never on the payer's word."""
from decimal import Decimal

import pytest

from hotels.tests.test_reservation_payment import _webhook, live  # noqa: F401
from marketplace.models import RideBooking, RideStatus
from marketplace.services import accept_ride, register_as_driver, register_vehicle, request_ride, start_ride
from identity.models import User
from monetization.models import PlatformFeePolicy, TransactionCategory
from services.models import ServiceRequest, ServiceRequestStatus
from services.tests.test_service_escrow_funding import PHONE, _client, approved_job  # noqa: F401
from transactions.models import BookingStatus, EscrowStatus


def _fund(requester, job_id):
    return _client(requester).post(f"/api/service-requests/{job_id}/fund/", {"phone_number": PHONE}, format="json")


@pytest.mark.django_db
def test_a_real_job_payment_is_held_only_when_the_provider_confirms_it(approved_job, live):
    job_id, requester, technician = approved_job
    started = _fund(requester, job_id)
    assert started.status_code == 202 and started.data["escrow_funded"] is False
    # Nothing is held yet, so work can't start and a second tap doesn't start a second payment.
    assert _client(technician).post(f"/api/service-requests/{job_id}/start/").status_code == 400
    assert _fund(requester, job_id).status_code == 400

    from transactions.models import Booking
    booking = Booking.objects.get(target_id=job_id)
    assert _webhook(booking).status_code == 200
    job = ServiceRequest.objects.get(pk=job_id)
    assert job.booking_id == booking.id and booking.escrow.status == EscrowStatus.HELD
    assert _client(technician).post(f"/api/service-requests/{job_id}/start/").status_code == 200
    assert _webhook(booking).status_code == 200  # the provider repeating itself changes nothing


@pytest.mark.django_db
def test_a_job_payment_for_a_cancelled_job_is_refunded(approved_job, live):
    job_id, requester, _technician = approved_job
    _fund(requester, job_id)
    ServiceRequest.objects.filter(pk=job_id).update(status=ServiceRequestStatus.CANCELLED)

    from transactions.models import Booking
    booking = Booking.objects.get(target_id=job_id)
    assert _webhook(booking).status_code == 200
    booking.refresh_from_db()
    assert booking.escrow.status == EscrowStatus.REFUNDED
    assert ServiceRequest.objects.get(pk=job_id).booking_id is None
    assert requester.wallet.balance_xaf == booking.amount_xaf


@pytest.mark.django_db
def test_a_job_payment_for_a_price_that_changed_is_refunded(approved_job, live):
    job_id, requester, _technician = approved_job
    _fund(requester, job_id)
    ServiceRequest.objects.filter(pk=job_id).update(quoted_amount_xaf=Decimal("99999"))

    from transactions.models import Booking
    booking = Booking.objects.get(target_id=job_id)
    _webhook(booking)
    booking.refresh_from_db()
    assert booking.escrow.status == EscrowStatus.REFUNDED and ServiceRequest.objects.get(pk=job_id).booking_id is None


@pytest.mark.django_db
def test_a_job_cannot_be_completed_with_a_payment_that_is_not_held(approved_job, live):
    job_id, requester, technician = approved_job
    ServiceRequest.objects.filter(pk=job_id).update(status=ServiceRequestStatus.IN_PROGRESS)
    response = _client(requester).post(f"/api/service-requests/{job_id}/complete/", {"phone_number": PHONE}, format="json")
    assert response.status_code == 400 and "escrow" in response.data["detail"].lower()
    assert ServiceRequest.objects.get(pk=job_id).status == ServiceRequestStatus.IN_PROGRESS


@pytest.fixture
def ride_in_progress(db):
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.RIDE_FARE, defaults={"fee_percent": Decimal("10.0")})
    rider = User.objects.create(username="lp_rider", phone="+237699700005")
    driver = User.objects.create(username="lp_driver", phone="+237699700006")
    profile = register_as_driver(user=driver, license_number="CM-DL-70001")
    profile.is_verified = True
    profile.save(update_fields=["is_verified"])
    vehicle = register_vehicle(driver_profile=profile, vehicle_category="STANDARD", make="Toyota", model="Corolla", plate_number="LP-001-AB")
    ride = request_ride(rider=rider, pickup_description="Akwa", dropoff_description="Bonaberi", fare_estimate_xaf=Decimal("2000"))
    accept_ride(ride=ride, driver=driver, vehicle=vehicle)
    start_ride(ride)
    return ride, rider


def _complete_ride(rider, ride):
    return _client(rider).post(f"/api/rides/{ride.id}/complete/", {"phone_number": PHONE}, format="json")


@pytest.mark.django_db
def test_a_real_ride_is_completed_and_paid_only_when_the_provider_confirms_the_fare(ride_in_progress, live):
    ride, rider = ride_in_progress
    started = _complete_ride(rider, ride)
    assert started.status_code == 202 and started.data["status"] == RideStatus.IN_PROGRESS
    assert _complete_ride(rider, ride).status_code == 400  # a second tap doesn't start a second payment

    from transactions.models import Booking
    booking = Booking.objects.get(target_id=ride.id)
    assert _webhook(booking).status_code == 200
    ride = RideBooking.objects.get(pk=ride.pk)
    booking.refresh_from_db()
    assert ride.status == RideStatus.COMPLETED and ride.booking_id == booking.id
    assert booking.escrow.status == EscrowStatus.RELEASED and booking.status == BookingStatus.COMPLETED


@pytest.mark.django_db
def test_a_fare_for_a_ride_that_is_no_longer_in_progress_is_refunded(ride_in_progress, live):
    ride, rider = ride_in_progress
    _complete_ride(rider, ride)
    RideBooking.objects.filter(pk=ride.pk).update(status=RideStatus.CANCELLED)

    from transactions.models import Booking
    booking = Booking.objects.get(target_id=ride.id)
    assert _webhook(booking).status_code == 200
    booking.refresh_from_db()
    assert booking.escrow.status == EscrowStatus.REFUNDED
    assert rider.wallet.balance_xaf == booking.amount_xaf


@pytest.mark.django_db
def test_the_sandbox_still_completes_a_ride_at_once(ride_in_progress):
    ride, rider = ride_in_progress
    response = _complete_ride(rider, ride)
    assert response.status_code == 200 and response.data["status"] == RideStatus.COMPLETED
