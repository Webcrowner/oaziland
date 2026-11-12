"""Paid courses: Mobile Money payment into escrow before access, released to the provider on completion."""
import json
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from careers.models import CourseModule, Lesson, TrainingCategory, TrainingEnrollment, TrainingEnrollmentStatus, TrainingProgram
from careers.services import PaymentRequiredError, enroll_in_training
from identity.models import User
from notifications.models import Notification
from transactions.models import BookingStatus, BookingType, EscrowStatus

PHONE = "+237670000001"


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _webhook(booking, status="SUCCESSFUL"):
    return APIClient().post(
        "/api/webhooks/payment/",
        data=json.dumps({"externalId": booking.idempotency_key, "transId": f"{status}-{booking.idempotency_key}", "status": status}),
        content_type="application/json",
    )


@pytest.fixture
def course(db):
    provider = User.objects.create(username="paid_course_provider", phone="+237699910001")
    program = TrainingProgram.objects.create(
        provider=provider, title="Licensing Prep", category=TrainingCategory.AGENCY_LICENSING_PREP,
        price_xaf=Decimal("20000"), issues_certification=True,
    )
    lesson = Lesson.objects.create(module=CourseModule.objects.create(program=program, title="Week 1"), title="Intro")
    return program, lesson


@pytest.fixture
def learner(db):
    return User.objects.create(username="paid_course_learner", phone="+237699910002")


def _pay(client, program, phone=PHONE):
    return client.post(f"/api/trainings/{program.id}/enroll/", {"phone_number": phone}, format="json")


@pytest.mark.django_db
def test_a_paid_course_opens_only_after_the_payment_is_confirmed(course, learner):
    program, lesson = course
    client = _client(learner)

    assert client.post(f"/api/trainings/{program.id}/enroll/").status_code == 400  # needs a Mobile Money number
    assert not TrainingEnrollment.objects.filter(student=learner).exists()  # ...and leaves nothing behind
    response = _pay(client, program)
    assert response.status_code == 202, response.data
    assert response.data["status"] == TrainingEnrollmentStatus.PAYMENT_PENDING
    assert response.data["payment"] == {"status": BookingStatus.PAYMENT_PROCESSING, "amount_xaf": "20000.00", "escrow_status": None}

    enrollment = TrainingEnrollment.objects.get(pk=response.data["id"])
    assert enrollment.booking.booking_type == BookingType.TRAINING
    base = f"/api/my-enrollments/{enrollment.id}"
    assert client.get(f"{base}/course/").status_code == 402
    assert client.post(f"{base}/lessons/{lesson.id}/complete/").status_code == 409

    assert _webhook(enrollment.booking).status_code == 200
    enrollment.refresh_from_db()
    assert enrollment.status == TrainingEnrollmentStatus.ENROLLED
    assert enrollment.booking.escrow.status == EscrowStatus.HELD
    assert client.get(f"{base}/course/").status_code == 200
    assert Notification.objects.filter(recipient=learner, notification_type="TRAINING_ENROLLED").exists()
    assert Notification.objects.filter(recipient=program.provider, notification_type="TRAINING_ENROLLED").exists()

    assert _webhook(enrollment.booking).status_code == 200  # a duplicate webhook changes nothing
    assert Notification.objects.filter(recipient=learner, notification_type="TRAINING_ENROLLED").count() == 1


@pytest.mark.django_db
def test_the_fee_stays_in_escrow_until_the_learner_completes_the_course(course, learner):
    from monetization.services import get_or_create_wallet
    program, lesson = course
    client = _client(learner)
    enrollment = TrainingEnrollment.objects.get(pk=_pay(client, program).data["id"])
    _webhook(enrollment.booking)
    assert get_or_create_wallet(program.provider).balance_xaf == 0

    assert client.post(f"/api/my-enrollments/{enrollment.id}/lessons/{lesson.id}/complete/").status_code == 200
    enrollment.refresh_from_db()
    assert enrollment.status == TrainingEnrollmentStatus.COMPLETED
    escrow = enrollment.booking.escrow
    assert escrow.status == EscrowStatus.RELEASED
    assert enrollment.booking.status == BookingStatus.COMPLETED
    assert get_or_create_wallet(program.provider).balance_xaf == escrow.payee_amount_xaf == Decimal("18000.00")


@pytest.mark.django_db
def test_a_failed_payment_keeps_the_course_locked_and_can_be_retried(course, learner):
    program, _ = course
    client = _client(learner)
    enrollment = TrainingEnrollment.objects.get(pk=_pay(client, program).data["id"])
    first_booking = enrollment.booking

    assert _webhook(first_booking, status="FAILED").status_code == 200
    data = client.get("/api/my-enrollments/").data["results"][0]
    assert data["status"] == TrainingEnrollmentStatus.PAYMENT_PENDING
    assert data["payment"]["status"] == BookingStatus.PAYMENT_FAILED

    retry = _pay(client, program)
    assert retry.status_code == 202
    enrollment.refresh_from_db()
    assert enrollment.booking_id != first_booking.id
    _webhook(enrollment.booking)
    enrollment.refresh_from_db()
    assert enrollment.status == TrainingEnrollmentStatus.ENROLLED


@pytest.mark.django_db
def test_a_second_payment_cannot_start_while_one_awaits_approval_until_its_hold_expires(course, learner):
    program, _ = course
    client = _client(learner)
    enrollment = TrainingEnrollment.objects.get(pk=_pay(client, program).data["id"])

    assert _pay(client, program).status_code == 409

    first_booking = enrollment.booking
    type(first_booking).objects.filter(pk=first_booking.pk).update(hold_expires_at=timezone.now() - timedelta(seconds=1))
    assert _pay(client, program).status_code == 202
    first_booking.refresh_from_db()
    assert first_booking.status == BookingStatus.EXPIRED


@pytest.mark.django_db
def test_dropping_a_paid_course_and_coming_back_does_not_charge_again(course, learner):
    program, _ = course
    client = _client(learner)
    enrollment = TrainingEnrollment.objects.get(pk=_pay(client, program).data["id"])
    _webhook(enrollment.booking)
    paid_booking = enrollment.booking_id

    assert client.post(f"/api/my-enrollments/{enrollment.id}/drop/").status_code == 200
    again = client.post(f"/api/trainings/{program.id}/enroll/")  # no phone number needed
    assert again.status_code == 201, again.data
    assert again.data["status"] == TrainingEnrollmentStatus.ENROLLED
    enrollment.refresh_from_db()
    assert enrollment.booking_id == paid_booking
    assert enrollment.booking.escrow.status == EscrowStatus.HELD


@pytest.mark.django_db
def test_paid_courses_cannot_be_joined_without_paying_but_free_ones_and_the_provider_can(course, learner):
    program, _ = course
    with pytest.raises(PaymentRequiredError):
        enroll_in_training(program=program, student=learner)

    own = _client(program.provider).post(f"/api/trainings/{program.id}/enroll/")
    assert own.status_code == 201 and own.data["payment"] is None

    free = TrainingProgram.objects.create(provider=program.provider, title="Free", category=TrainingCategory.OTHER, price_xaf=Decimal("0"))
    assert _client(learner).post(f"/api/trainings/{free.id}/enroll/").status_code == 201


def _paid_enrollment(client, program):
    enrollment = TrainingEnrollment.objects.get(pk=_pay(client, program).data["id"])
    _webhook(enrollment.booking)
    enrollment.refresh_from_db()
    return enrollment


@pytest.mark.django_db
def test_a_full_refund_through_a_dispute_takes_the_course_back(course, learner):
    from monetization.services import get_or_create_wallet
    from property_management.models import DisputeCase
    from property_management.services import resolve_dispute
    program, _ = course
    client = _client(learner)
    enrollment = _paid_enrollment(client, program)

    opened = client.post(f"/api/bookings/{enrollment.booking_id}/open-dispute/", {"reason": "The videos don't play."}, format="json")
    assert opened.status_code == 201, opened.data
    assert Notification.objects.filter(recipient=program.provider, notification_type="DISPUTE_OPENED").exists()
    assert client.post(f"/api/bookings/{enrollment.booking_id}/open-dispute/", {"reason": "again"}, format="json").status_code == 400
    assert client.get(f"/api/my-enrollments/{enrollment.id}/course/").status_code == 200  # still usable while support decides

    resolve_dispute(dispute=DisputeCase.objects.get(pk=opened.data["id"]), outcome="REFUND", notes="Confirmed")
    enrollment.refresh_from_db()
    assert enrollment.status == TrainingEnrollmentStatus.DROPPED and enrollment.certificate_code is None
    assert get_or_create_wallet(learner).balance_xaf == Decimal("20000")
    assert get_or_create_wallet(program.provider).balance_xaf == 0
    assert client.get(f"/api/my-enrollments/{enrollment.id}/course/").status_code == 403

    assert client.post(f"/api/trainings/{program.id}/enroll/").status_code == 400  # refunded, so it must be paid again
    assert _pay(client, program).status_code == 202


@pytest.mark.django_db
def test_a_partial_refund_keeps_the_course_open(course, learner):
    from property_management.models import DisputeCase
    from property_management.services import resolve_dispute
    program, _ = course
    client = _client(learner)
    enrollment = _paid_enrollment(client, program)
    dispute_id = client.post(f"/api/bookings/{enrollment.booking_id}/open-dispute/", {"reason": "Half the lessons missing"}, format="json").data["id"]

    resolve_dispute(dispute=DisputeCase.objects.get(pk=dispute_id), outcome="SPLIT", payer_amount_xaf=10000)
    enrollment.refresh_from_db()
    assert enrollment.status == TrainingEnrollmentStatus.ENROLLED
    assert client.get(f"/api/my-enrollments/{enrollment.id}/course/").status_code == 200


@pytest.mark.django_db
def test_a_payment_already_paid_out_cannot_be_disputed(course, learner):
    program, lesson = course
    client = _client(learner)
    enrollment = _paid_enrollment(client, program)
    client.post(f"/api/my-enrollments/{enrollment.id}/lessons/{lesson.id}/complete/")  # completion pays the trainer

    response = client.post(f"/api/bookings/{enrollment.booking_id}/open-dispute/", {"reason": "Changed my mind"}, format="json")
    assert response.status_code == 400
    enrollment.booking.escrow.refresh_from_db()
    assert enrollment.booking.escrow.status == EscrowStatus.RELEASED
