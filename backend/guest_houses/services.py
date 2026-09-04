"""
guest_houses.services — cross-channel availability sync (the actual
double-booking-prevention mechanism), biometric guest verification,
multi-payee escrow splits, housekeeping, and the host dashboard.
"""
from decimal import Decimal


class SplitAmountMismatchError(Exception):
    pass


# ---------------------------------------------------------------------------
# Channel manager / OTA sync.
# ---------------------------------------------------------------------------
def block_dates_across_all_channels(*, guest_house, dates: list, source_channel: str, booking=None):
    """THE actual value of a channel manager: the moment a date is
    booked through ANY channel, it's blocked everywhere — this is what
    stops a guest house owner from getting a booking on Airbnb and a
    conflicting one on Booking.com for the same night."""
    from .models import ChannelBlockedDate
    from .ota_connectors import get_active_ota_connector

    blocked = []
    for date in dates:
        blocked_date, _ = ChannelBlockedDate.objects.get_or_create(
            guest_house=guest_house, date=date, defaults={"source_channel": source_channel, "booking": booking},
        )
        blocked.append(blocked_date)

    for channel_listing in guest_house.channel_listings.filter(is_active=True):
        from django.utils import timezone
        connector = get_active_ota_connector(channel_listing.channel)
        connector.push_availability(external_listing_id=channel_listing.external_listing_id, blocked_dates=dates)
        channel_listing.last_synced_at = timezone.now()
        channel_listing.save(update_fields=["last_synced_at"])

    return blocked


def is_date_available(*, guest_house, date) -> bool:
    from .models import ChannelBlockedDate
    return not ChannelBlockedDate.objects.filter(guest_house=guest_house, date=date).exists()


def receive_external_booking(*, guest_house, source_channel: str, check_in, check_out, booking=None):
    """Called when a booking arrives FROM an external OTA (Airbnb,
    Booking.com) — immediately blocks those dates across every OTHER
    channel too, per the whole point of a channel manager."""
    from datetime import timedelta
    dates = []
    current = check_in
    while current < check_out:
        dates.append(current)
        current += timedelta(days=1)
    return block_dates_across_all_channels(guest_house=guest_house, dates=dates, source_channel=source_channel, booking=booking)


# ---------------------------------------------------------------------------
# Biometric guest verification.
# ---------------------------------------------------------------------------
def verify_guest_for_checkin(*, booking, method: str, verified_by=None, provider_reference: str = ""):
    """Real verification workflow — reuses the guest's existing
    KYCProfile if one is on file (they've already been through
    platform-wide identity verification) rather than demanding a
    second, redundant check for a returning verified user."""
    from django.utils import timezone
    from .models import GuestVerification, VerificationMethod

    verification, _ = GuestVerification.objects.get_or_create(booking=booking, defaults={"method": method})

    if method == VerificationMethod.MANUAL:
        if verified_by is None:
            raise ValueError("Manual verification requires a verifying staff member.")
        verification.verified_by = verified_by
    else:
        guest = booking.requester
        if not hasattr(guest, "kyc_profile") or guest.kyc_profile.kyc_status != "VERIFIED":
            raise ValueError("This guest has no verified KYC profile on file — use MANUAL verification or complete KYC first.")

    verification.method = method
    verification.verified_at = timezone.now()
    verification.provider_reference = provider_reference
    verification.save(update_fields=["method", "verified_at", "provider_reference", "verified_by"])
    return verification


# ---------------------------------------------------------------------------
# Multi-payee escrow splits.
# ---------------------------------------------------------------------------
def create_escrow_splits(*, escrow, splits: list):
    """splits is a list of (payee, role, amount_xaf) tuples. WHY the
    amounts must sum EXACTLY to escrow.payee_amount_xaf: a mismatch
    means either the owner or the property manager is being paid the
    wrong amount, silently — this is money, so it fails loudly instead."""
    from .models import EscrowSplit

    total = sum(amount for _, _, amount in splits)
    if total != escrow.payee_amount_xaf:
        raise SplitAmountMismatchError(
            f"Split amounts ({total}) must sum exactly to the escrow's payee amount ({escrow.payee_amount_xaf})."
        )

    return [
        EscrowSplit.objects.create(escrow=escrow, payee=payee, role=role, amount_xaf=amount)
        for payee, role, amount in splits
    ]


def execute_split_payouts(escrow):
    """Called once an escrow is released — credits each payee's
    EXISTING Wallet (the same wallet system from the gift economy,
    Prompt 7) directly, following the exact same pattern
    monetization.services.convert_gifts_to_wallet_balance() uses:
    update the balance and record a WalletTransaction together, inside
    one atomic block, so there's always a paper trail."""
    from django.db import transaction as db_transaction
    from django.utils import timezone
    from monetization.services import get_or_create_wallet
    from monetization.models import WalletTransaction, WalletTransactionType

    paid = []
    for split in escrow.splits.filter(paid_out_at__isnull=True):
        wallet = get_or_create_wallet(split.payee)
        with db_transaction.atomic():
            wallet.balance_xaf += split.amount_xaf
            wallet.save(update_fields=["balance_xaf"])
            WalletTransaction.objects.create(
                wallet=wallet, transaction_type=WalletTransactionType.GIFT_PAYOUT,
                amount_xaf=split.amount_xaf, platform_fee_xaf=Decimal("0"),
                related_reference=f"Escrow split payout: {split.role}",
            )
            split.paid_out_at = timezone.now()
            split.save(update_fields=["paid_out_at"])
        paid.append(split)
    return paid


# ---------------------------------------------------------------------------
# Housekeeping.
# ---------------------------------------------------------------------------
def schedule_housekeeping_task(*, guest_house, task_type: str, scheduled_for, assigned_to=None):
    from .models import HousekeepingTask
    return HousekeepingTask.objects.create(guest_house=guest_house, task_type=task_type, scheduled_for=scheduled_for, assigned_to=assigned_to)


def complete_housekeeping_task(*, task, completion_photo_url: str = ""):
    from django.utils import timezone
    from .models import HousekeepingTaskStatus
    task.status = HousekeepingTaskStatus.COMPLETED
    task.completed_at = timezone.now()
    task.completion_photo_url = completion_photo_url
    task.save(update_fields=["status", "completed_at", "completion_photo_url"])
    return task


# ---------------------------------------------------------------------------
# Host ERP dashboard.
# ---------------------------------------------------------------------------
def get_host_dashboard_summary(host):
    """Real aggregation across every guest house a host owns —
    following the same pattern as get_landlord_portfolio_summary() and
    get_hostel_occupancy_summary()."""
    from property.models import GuestHouseLodge
    from .models import ChannelBlockedDate, HousekeepingTask, HousekeepingTaskStatus
    from oaziland.analytics import compute_period_over_period

    guest_houses = GuestHouseLodge.objects.filter(owner=host)
    blocked_dates = ChannelBlockedDate.objects.filter(guest_house__in=guest_houses)
    blocked_nights = blocked_dates.count()
    pending_housekeeping = HousekeepingTask.objects.filter(
        guest_house__in=guest_houses, status__in=[HousekeepingTaskStatus.SCHEDULED, HousekeepingTaskStatus.IN_PROGRESS],
    ).count()

    # Trends on the booked NIGHT itself (not when the block was
    # recorded) — 'are more nights being booked this period than last,'
    # the actual question a host cares about.
    booked_nights_trend = compute_period_over_period(queryset=blocked_dates, date_field="date")

    return {
        "total_guest_houses": guest_houses.count(),
        "total_blocked_nights_all_channels": blocked_nights,
        "pending_housekeeping_tasks": pending_housekeeping,
        "booked_nights_trend": booked_nights_trend,
    }
