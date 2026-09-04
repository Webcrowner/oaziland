"""
Tests for the channel manager (the actual cross-channel double-booking
prevention), biometric guest verification, multi-payee escrow splits,
housekeeping, and the host dashboard.
"""
import pytest
from decimal import Decimal
from datetime import date

from identity.models import User, KYCProfile, VerificationStatus
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import GuestHouseLodge
from transactions.models import Booking, BookingType, BookingStatus, PaymentEscrow, EscrowStatus
from guest_houses.models import OTAChannel, ChannelListing, VerificationMethod, EscrowSplitRole
from guest_houses.services import (
    block_dates_across_all_channels, is_date_available, receive_external_booking,
    verify_guest_for_checkin, create_escrow_splits, execute_split_payouts, SplitAmountMismatchError,
    schedule_housekeeping_task, complete_housekeeping_task, get_host_dashboard_summary,
)


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Littoral")
    division = Division.objects.create(region=region, name="Fako")
    subdivision = Subdivision.objects.create(division=division, name="Limbe")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Limbe Down Beach")
    return Quarter.objects.create(village_or_district=village, name="Down Beach")


@pytest.fixture
def guest_house(db, quarter):
    owner = User.objects.create(username="guesthouse_owner", phone="+237699444001")
    return GuestHouseLodge.objects.create(owner=owner, quarter=quarter, type="GUEST_HOUSE_LODGE" if False else "HOUSE", is_coastal_leisure=True)


@pytest.mark.django_db
def test_booking_on_one_channel_blocks_all_other_channels(guest_house):
    """The actual reason a channel manager exists: an Airbnb booking
    must immediately block those same nights on Booking.com too."""
    ChannelListing.objects.create(guest_house=guest_house, channel=OTAChannel.AIRBNB, external_listing_id="airbnb-123")
    ChannelListing.objects.create(guest_house=guest_house, channel=OTAChannel.BOOKING_COM, external_listing_id="bcom-456")

    assert is_date_available(guest_house=guest_house, date=date(2026, 8, 1)) is True

    receive_external_booking(guest_house=guest_house, source_channel=OTAChannel.AIRBNB, check_in=date(2026, 8, 1), check_out=date(2026, 8, 4))

    # Now blocked regardless of which channel someone checks from —
    # there's only ONE authoritative availability record.
    assert is_date_available(guest_house=guest_house, date=date(2026, 8, 1)) is False
    assert is_date_available(guest_house=guest_house, date=date(2026, 8, 2)) is False
    assert is_date_available(guest_house=guest_house, date=date(2026, 8, 4)) is True  # checkout day itself is free again


@pytest.mark.django_db
def test_biometric_verification_requires_existing_kyc(quarter, guest_house):
    guest_with_kyc = User.objects.create(username="verified_guest", phone="+237699444002")
    KYCProfile.objects.create(user=guest_with_kyc, legal_full_name="Verified Guest", date_of_birth="1990-01-01", national_id_number="CM-GH-001", residential_address="Limbe", kyc_status=VerificationStatus.VERIFIED)
    guest_without_kyc = User.objects.create(username="unverified_guest", phone="+237699444003")

    booking_a = Booking.objects.create(booking_type=BookingType.GUEST_HOUSE, target_content_type="property.GuestHouseLodge", target_id=guest_house.id, requester=guest_with_kyc, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("50000"), idempotency_key="gh-verify-1")
    booking_b = Booking.objects.create(booking_type=BookingType.GUEST_HOUSE, target_content_type="property.GuestHouseLodge", target_id=guest_house.id, requester=guest_without_kyc, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("50000"), idempotency_key="gh-verify-2")

    verification = verify_guest_for_checkin(booking=booking_a, method=VerificationMethod.ID_PHOTO_MATCH)
    assert verification.is_verified is True

    with pytest.raises(ValueError):
        verify_guest_for_checkin(booking=booking_b, method=VerificationMethod.FACIAL_RECOGNITION)

    # MANUAL verification is the correct fallback for a guest with no KYC on file.
    host = User.objects.create(username="verifying_host", phone="+237699444004")
    manual_verification = verify_guest_for_checkin(booking=booking_b, method=VerificationMethod.MANUAL, verified_by=host)
    assert manual_verification.is_verified is True
    assert manual_verification.verified_by == host


@pytest.mark.django_db
def test_multi_payee_escrow_split_and_payout(guest_house):
    owner = User.objects.create(username="split_owner", phone="+237699444005")
    manager = User.objects.create(username="split_manager", phone="+237699444006")
    guest = User.objects.create(username="split_guest", phone="+237699444007")

    booking = Booking.objects.create(booking_type=BookingType.GUEST_HOUSE, target_content_type="property.GuestHouseLodge", target_id=guest_house.id, requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("100000"), idempotency_key="gh-split-1")
    escrow = PaymentEscrow.objects.create(booking=booking, gross_amount_xaf=Decimal("100000"), platform_fee_xaf=Decimal("3000"), payee_amount_xaf=Decimal("97000"), status=EscrowStatus.HELD, provider="MTN_MOMO")

    with pytest.raises(SplitAmountMismatchError):
        create_escrow_splits(escrow=escrow, splits=[(owner, EscrowSplitRole.OWNER, Decimal("50000"))])  # doesn't sum to 97000

    splits = create_escrow_splits(escrow=escrow, splits=[
        (owner, EscrowSplitRole.OWNER, Decimal("77000")),
        (manager, EscrowSplitRole.PROPERTY_MANAGER, Decimal("20000")),
    ])
    assert len(splits) == 2

    owner_wallet_before = owner.wallet.balance_xaf if hasattr(owner, "wallet") else Decimal("0")
    paid = execute_split_payouts(escrow)
    assert len(paid) == 2

    owner.refresh_from_db()
    manager.refresh_from_db()
    assert owner.wallet.balance_xaf == owner_wallet_before + Decimal("77000")
    assert manager.wallet.balance_xaf == Decimal("20000")

    # Running payout again must not double-pay — already-paid splits are skipped.
    paid_again = execute_split_payouts(escrow)
    assert len(paid_again) == 0
    owner.refresh_from_db()
    assert owner.wallet.balance_xaf == owner_wallet_before + Decimal("77000")  # unchanged


@pytest.mark.django_db
def test_housekeeping_task_lifecycle(guest_house):
    from django.utils import timezone
    staff = User.objects.create(username="housekeeping_staff", phone="+237699444008")

    task = schedule_housekeeping_task(guest_house=guest_house, task_type="Turnover Cleaning", scheduled_for=timezone.now(), assigned_to=staff)
    assert task.status == "SCHEDULED"

    complete_housekeeping_task(task=task, completion_photo_url="https://example.com/clean-room.jpg")
    task.refresh_from_db()
    assert task.status == "COMPLETED"
    assert task.completed_at is not None
    assert task.completion_photo_url


@pytest.mark.django_db
def test_host_dashboard_aggregates_real_data(quarter, guest_house):
    from django.utils import timezone
    host = guest_house.owner

    schedule_housekeeping_task(guest_house=guest_house, task_type="Deep Clean", scheduled_for=timezone.now())
    block_dates_across_all_channels(guest_house=guest_house, dates=[date(2026, 9, 1), date(2026, 9, 2)], source_channel=OTAChannel.DIRECT)

    summary = get_host_dashboard_summary(host)
    assert summary["total_guest_houses"] == 1
    assert summary["total_blocked_nights_all_channels"] == 2
    assert summary["pending_housekeeping_tasks"] == 1
