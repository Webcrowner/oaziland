"""
transactions.services — the reservation and escrow-release algorithm,
translated directly from the pseudocode in the Oaziland UML & Data Model
Specification, §11. This is the real-code counterpart of that pseudocode,
using the exact same object and field names.

Redis locking and the payment-gateway client are injected as dependencies
(`lock_client`, `payment_gateway`) so this module stays testable without a
live Redis/telecom connection.
"""
import uuid
from dataclasses import dataclass
from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils import timezone

from .models import Booking, BookingStatus, BookingType, PaymentEscrow, EscrowStatus


class InventoryConflictError(Exception):
    """Raised when the target unit/listing is already locked or booked."""


class VerificationRequiredError(Exception):
    """Raised when the requester must complete identity verification first."""


class WebhookSignatureError(Exception):
    """Raised when a payment webhook's signature doesn't check out — per
    the Flowchart in the UML specification, this is treated as a possible
    fraud attempt, not just a normal failure, and should be logged as a
    security event by the caller."""


@dataclass
class PaymentDetails:
    provider: str          # PaymentProvider choice, e.g. "MTN_MOMO"
    phone_number: str


HOLD_TTL_SECONDS = 420  # 7 minutes, per Architecture doc §2.2.1 / Pre-Dev §1.3


def reserve_booking(
    *,
    lock_client,
    requester,
    booking_type: str,
    target_content_type: str,
    target_id: uuid.UUID,
    amount_xaf: Decimal,
) -> Booking:
    """Step 1-2 of the 'Reserve Property' use case (Pre-Dev Design §1.3):
    acquire a distributed lock, then create a PENDING booking hold.
    Raises InventoryConflictError if the lock cannot be acquired — this is
    what prevents two guests from booking the same house simultaneously."""
    lock_key = f"booking-lock:{target_content_type}:{target_id}"
    if not lock_client.acquire(lock_key, ttl_seconds=HOLD_TTL_SECONDS):
        raise InventoryConflictError(
            "This unit is no longer available for the selected dates."
        )

    with db_transaction.atomic():
        booking = Booking.objects.create(
            booking_type=booking_type,
            target_content_type=target_content_type,
            target_id=target_id,
            requester=requester,
            status=BookingStatus.PENDING,
            amount_xaf=amount_xaf,
            idempotency_key=str(uuid.uuid4()),
            hold_expires_at=timezone.now() + timezone.timedelta(seconds=HOLD_TTL_SECONDS),
        )
    return booking


def initiate_booking_payment(*, booking: Booking, payment_gateway, phone_number: str):
    """Step 4 of the use case: actually start the Mobile Money/card debit
    through the ACTIVE payment gateway — MTN MoMo, Orange Money, and card
    payments all flow through this exact same function call, because they
    all implement the same PaymentGateway interface (payments/gateways.py).
    Swapping which provider is 'active' never requires changing this
    function, or anything else in this file."""
    booking.status = BookingStatus.PAYMENT_PROCESSING
    booking.save(update_fields=["status"])

    return payment_gateway.initiate_debit(
        phone_number=phone_number,
        amount_xaf=booking.amount_xaf,
        idempotency_key=booking.idempotency_key,
    )


def confirm_payment(
    *,
    lock_client,
    booking: Booking,
    provider: str,
    provider_reference: str,
    platform_fee_xaf: Decimal,
    payment_gateway=None,
    raw_webhook_payload: bytes = None,
    webhook_signature_header: str = None,
) -> PaymentEscrow:
    """Step 6 of the use case: payment webhook confirmed -> booking CONFIRMED
    and an escrow record created HELD. Idempotent on provider_reference via
    the unique constraint on PaymentEscrow — a duplicate webhook cannot
    create a second escrow record.

    If a payment_gateway and raw webhook data are supplied, the webhook's
    signature is verified FIRST — an invalid signature raises
    WebhookSignatureError rather than silently trusting the request. This
    is optional (defaults to skipped) so existing callers/tests that
    already trust their input don't break, but any real production
    webhook handler MUST pass these."""
    if payment_gateway is not None and raw_webhook_payload is not None:
        verification = payment_gateway.verify_webhook(
            raw_payload=raw_webhook_payload, signature_header=webhook_signature_header,
        )
        if not verification.is_valid_signature:
            raise WebhookSignatureError(
                "Payment webhook signature could not be verified — possible fraud attempt."
            )
        if not verification.payment_succeeded:
            fail_payment(lock_client=lock_client, booking=booking)
            raise ValueError("Payment did not succeed according to the gateway.")

    with db_transaction.atomic():
        booking.confirm()
        escrow = PaymentEscrow.objects.create(
            booking=booking,
            gross_amount_xaf=booking.amount_xaf,
            platform_fee_xaf=platform_fee_xaf,
            payee_amount_xaf=booking.amount_xaf - platform_fee_xaf,
            status=EscrowStatus.HELD,
            provider=provider,
            provider_reference=provider_reference,
        )
    lock_key = f"booking-lock:{booking.target_content_type}:{booking.target_id}"
    lock_client.release(lock_key, permanent=True)
    return escrow


def fail_payment(*, lock_client, booking: Booking):
    """Step 5a: payment declined — release the hold so the unit becomes
    searchable again, and let the guest retry."""
    booking.fail_payment()
    lock_key = f"booking-lock:{booking.target_content_type}:{booking.target_id}"
    lock_client.release(lock_key)


def expire_hold(*, lock_client, booking: Booking):
    """Step 3a: TTL elapsed with no payment — same release, different
    origin. Intended to be called by a periodic sweep job querying
    Booking.objects.filter(status=PENDING, hold_expires_at__lt=now())."""
    booking.expire()
    lock_key = f"booking-lock:{booking.target_content_type}:{booking.target_id}"
    lock_client.release(lock_key)


def complete_booking(*, booking: Booking, commission=None):
    """Step 9: arrival/check-in/term-end confirmed -> release escrow to the
    landlord/agent/agency, computing the commission split if one applies."""
    with db_transaction.atomic():
        booking.complete()
        escrow = booking.escrow
        if commission is not None:
            escrow.payee_amount_xaf = (
                escrow.gross_amount_xaf - escrow.platform_fee_xaf - commission.total_amount_xaf
            )
            escrow.save(update_fields=["payee_amount_xaf"])
        escrow.release()
    return escrow
