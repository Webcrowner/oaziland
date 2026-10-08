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


def _fee_category_for_booking_type(booking_type: str):
    """WHY this mapping exists (fixed as part of Prompt 10): a booking's
    fee category must match what it actually IS — a service request
    should be charged under SERVICE_PAYMENT's rate, not silently charged
    the PROPERTY_BOOKING rate just because that was the previous
    hardcoded default. Centralizing the mapping here means adding a new
    BookingType later requires one new dict entry, not hunting through
    confirm_payment's internals."""
    from monetization.models import TransactionCategory
    return {
        BookingType.SERVICE_REQUEST: TransactionCategory.SERVICE_PAYMENT,
        BookingType.MARKETPLACE_ITEM: TransactionCategory.MARKETPLACE_SALE,
        BookingType.RIDE: TransactionCategory.RIDE_FARE,
    }.get(booking_type, TransactionCategory.PROPERTY_BOOKING)


class InventoryConflictError(Exception):
    """Raised when the target unit/listing is already locked or booked."""


class VerificationRequiredError(Exception):
    """Raised when the requester must complete identity verification first."""


class WebhookSignatureError(Exception):
    """Raised when a payment webhook's signature doesn't check out — per
    the Flowchart in the UML specification, this is treated as a possible
    fraud attempt, not just a normal failure, and should be logged as a
    security event by the caller."""


class BookingAlreadySettledError(Exception):
    """Raised when trying to cancel a booking that's already been paid
    for, completed, or cancelled."""


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
    platform_fee_xaf: Decimal = None,
    payment_gateway=None,
    raw_webhook_payload: bytes = None,
    webhook_signature_header: str = None,
) -> PaymentEscrow:
    """Step 6 of the use case: payment webhook confirmed -> booking CONFIRMED
    and an escrow record created HELD. Idempotent on provider_reference via
    the unique constraint on PaymentEscrow — a duplicate webhook cannot
    create a second escrow record.

    WHY platform_fee_xaf defaults to None instead of being required: the
    platform fee should come from ONE shared source of truth
    (monetization.PlatformFeePolicy) so a booking, a marketplace sale,
    and an ad purchase all compute their fee the exact same way — not
    from whatever number happened to be passed in by the caller. If
    platform_fee_xaf isn't explicitly given, it's looked up from
    PlatformFeePolicy for PROPERTY_BOOKING automatically. The explicit
    override still exists for tests and edge cases, but production code
    should almost always leave it unset.

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

    if platform_fee_xaf is None:
        from monetization.models import PlatformFeePolicy
        fee_category = _fee_category_for_booking_type(booking.booking_type)
        platform_fee_xaf = PlatformFeePolicy.fee_for(fee_category, booking.amount_xaf)

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

    # WHY this was a real gap before this fix: a confirmed booking
    # previously sent NOTHING to the guest — the acceptance criteria's
    # 'receive a real WhatsApp booking confirmation and a real
    # transactional email' had nothing behind it. Both notifications
    # route through the same shared notify() function every other
    # feature uses — no separate, one-off messaging path for bookings.
    from notifications.services import notify
    notify(
        recipient=booking.requester, notification_type="BOOKING_CONFIRMED",
        title="Booking Confirmed",
        message=f"Your booking has been confirmed. Amount paid: {booking.amount_xaf} XAF.",
        channel="WHATSAPP", related_reference=str(booking.id),
    )
    notify(
        recipient=booking.requester, notification_type="BOOKING_RECEIPT",
        title="Your Oaziland Receipt",
        message=f"Receipt — Booking {booking.id}: {booking.amount_xaf} XAF paid, platform fee {platform_fee_xaf} XAF, provider reference {provider_reference}.",
        channel="EMAIL", related_reference=str(booking.id),
    )

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


def cancel_booking(*, lock_client, booking: Booking):
    """The real gap this closes: a booking could be created and held,
    but the requester had NO way to ever back out of it — no cancel
    action existed anywhere, and the generic ModelViewSet's default
    destroy() would have hard-deleted the row instead of leaving a real
    CANCELLED audit trail. Only allowed before money has actually
    changed hands — once CONFIRMED (escrow HELD), backing out needs a
    real refund, which goes through the existing dispute/resolve_dispute
    (outcome='REFUND') flow instead, not a silent status flip here."""
    if booking.status not in (BookingStatus.PENDING, BookingStatus.PAYMENT_PROCESSING, BookingStatus.PAYMENT_FAILED):
        raise BookingAlreadySettledError(
            "This booking can no longer be cancelled this way — open a dispute if you already paid."
        )
    booking.cancel()
    lock_key = f"booking-lock:{booking.target_content_type}:{booking.target_id}"
    lock_client.release(lock_key)

    # A cancelled reservation on a Listing is exactly the "this is
    # available again" event the platform-wide waitlist exists for.
    if booking.target_content_type == "property.Listing":
        from discovery.services import notify_waitlist_on_availability
        notify_waitlist_on_availability(booking.target_id)
    return booking


def resolve_target_owner(booking: Booking):
    """Generic bookings (e.g. guest houses, direct property rentals, services, rides)
    settle through the shared /api/bookings/ endpoint or vertical actions —
    this resolves 'who gets paid' (payee user) across all target types."""
    from django.apps import apps
    try:
        app_label, model_name = booking.target_content_type.split(".")
        model = apps.get_model(app_label, model_name)
        target = model.objects.filter(pk=booking.target_id).first()
    except (LookupError, ValueError):
        return None
    if target is None:
        return None
    if hasattr(target, "technician"):
        return target.technician
    if hasattr(target, "driver"):
        return getattr(target.driver, "user", target.driver)
    if hasattr(target, "hotel"):
        return getattr(target.hotel, "owner", None)
    if hasattr(target, "venue"):
        return getattr(target.venue, "owner", None)
    if hasattr(target, "property_asset"):
        return getattr(target.property_asset, "owner", None)
    return getattr(target, "owner", None)


def complete_booking(*, booking: Booking, agent=None, commission=None):
    """Step 9: arrival/check-in/term-end confirmed -> release escrow to the
    landlord/agent/agency, computing the commission split if one applies.

    WHY 'agent' is accepted here rather than only a pre-built commission
    object: this is the ONE function every vertical's real completion
    action (hotel checkout, ride completion, service completion, event/
    property booking completion) calls to actually pay out — computing
    the commission split HERE, from the real agent who closed the deal,
    is what makes commission genuinely get calculated for a live
    transaction, instead of the correct math existing but never running
    outside of a test."""
    with db_transaction.atomic():
        booking.complete()
        escrow = booking.escrow
        if commission is None and agent is not None:
            from agency.services import create_commission_for_booking
            commission = create_commission_for_booking(booking=booking, agent=agent)
        if commission is not None:
            escrow.payee_amount_xaf = (
                escrow.gross_amount_xaf - escrow.platform_fee_xaf - commission.total_amount_xaf
            )
            escrow.save(update_fields=["payee_amount_xaf"])
        escrow.release()

        # Credit the payee's in-app wallet so they can immediately see their
        # earnings and disburse/withdraw them to MTN MoMo or Orange Money.
        payee = resolve_target_owner(booking)
        if payee:
            from monetization.services import get_or_create_wallet
            from monetization.models import WalletTransaction, WalletTransactionType
            wallet = get_or_create_wallet(payee)
            wallet.balance_xaf += escrow.payee_amount_xaf
            wallet.save(update_fields=["balance_xaf"])
            WalletTransaction.objects.create(
                wallet=wallet,
                transaction_type=WalletTransactionType.GIFT_PAYOUT,
                amount_xaf=escrow.payee_amount_xaf,
                related_reference=f"Escrow release: booking #{booking.id}",
            )

        # If an agent was involved and earned commission, credit the agent's wallet too
        if commission is not None and agent is not None:
            from monetization.services import get_or_create_wallet
            from monetization.models import WalletTransaction, WalletTransactionType
            agent_user = getattr(agent, "user", None)
            if agent_user and commission.agent_share_xaf > 0:
                agent_wallet = get_or_create_wallet(agent_user)
                agent_wallet.balance_xaf += commission.agent_share_xaf
                agent_wallet.save(update_fields=["balance_xaf"])
                WalletTransaction.objects.create(
                    wallet=agent_wallet,
                    transaction_type=WalletTransactionType.GIFT_PAYOUT,
                    amount_xaf=commission.agent_share_xaf,
                    related_reference=f"Commission: booking #{booking.id}",
                )

        # Real completed deals feed the FIVE_SUCCESSFUL_DEALS badge —
        # complete_booking() is the ONE function every vertical's real
        # completion action calls, so this is the correct single place
        # to re-evaluate it rather than duplicating the check per-app.
        from engagement.services import evaluate_badges_for_user
        evaluate_badges_for_user(booking.requester)
    return escrow
