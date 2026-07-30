"""
Tests for Prompt 5's two genuinely new pieces: Contract, and the
PaymentGateway interface actually being used by the reservation flow
(not just defined and sitting unused).
"""
import uuid
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.models import BookingType, ContractType
from transactions.services import (
    reserve_booking, initiate_booking_payment, confirm_payment,
    WebhookSignatureError,
)
from payments.gateways import SandboxGateway, DebitResult, WebhookVerificationResult, PaymentGateway


class FakeLock:
    def __init__(self):
        self.locked = set()

    def acquire(self, key, ttl_seconds):
        if key in self.locked:
            return False
        self.locked.add(key)
        return True

    def release(self, key, permanent=False):
        self.locked.discard(key)


class ForgedSignatureGateway(PaymentGateway):
    """A test double that ALWAYS reports a forged signature — used to
    prove the system correctly rejects a payment webhook that didn't
    really come from the payment provider."""
    def initiate_debit(self, *, phone_number, amount_xaf, idempotency_key):
        return DebitResult(success=True, provider_reference="FORGED-REF", raw_provider_response={})

    def verify_webhook(self, *, raw_payload, signature_header):
        return WebhookVerificationResult(is_valid_signature=False, provider_reference="FORGED-REF", payment_succeeded=True)


@pytest.fixture
def sample_booking(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")

    landlord = User.objects.create(username="contract_landlord", phone="+237699400001")
    guest = User.objects.create(username="contract_guest", phone="+237699400002")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(
        property_asset=house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"),
    )
    lock = FakeLock()
    booking = reserve_booking(
        lock_client=lock, requester=guest, booking_type=BookingType.GENERAL_RENTAL,
        target_content_type="property.Listing", target_id=listing.id, amount_xaf=listing.price_xaf,
    )
    return booking, lock


@pytest.mark.django_db
def test_sandbox_gateway_initiates_a_debit(sample_booking):
    """Proves the reservation flow actually CALLS the PaymentGateway
    interface now, rather than the interface existing unused."""
    booking, lock = sample_booking
    gateway = SandboxGateway()

    result = initiate_booking_payment(booking=booking, payment_gateway=gateway, phone_number="+237670000099")

    assert result.success is True
    booking.refresh_from_db()
    assert booking.status == "PAYMENT_PROCESSING"


@pytest.mark.django_db
def test_forged_webhook_signature_is_rejected(sample_booking):
    """This is the security-critical test: a payment confirmation that
    did NOT really come from the payment provider must be rejected, not
    silently trusted."""
    booking, lock = sample_booking
    forged_gateway = ForgedSignatureGateway()

    with pytest.raises(WebhookSignatureError):
        confirm_payment(
            lock_client=lock, booking=booking, provider="MTN_MOMO",
            provider_reference="FORGED-REF", platform_fee_xaf=Decimal("3000"),
            payment_gateway=forged_gateway, raw_webhook_payload=b"{}",
            webhook_signature_header="forged-header",
        )


@pytest.mark.django_db
def test_genuine_webhook_confirms_the_booking(sample_booking):
    """The counterpart to the forged-signature test: a REAL, correctly-
    signed webhook (via the sandbox gateway, which always reports valid)
    must go through normally."""
    booking, lock = sample_booking
    gateway = SandboxGateway()

    escrow = confirm_payment(
        lock_client=lock, booking=booking, provider="MTN_MOMO",
        provider_reference=f"REAL-{uuid.uuid4()}", platform_fee_xaf=Decimal("3000"),
        payment_gateway=gateway, raw_webhook_payload=b"{}", webhook_signature_header="real-header",
    )

    booking.refresh_from_db()
    assert booking.status == "CONFIRMED"
    assert escrow.status == "HELD"


@pytest.mark.django_db
def test_contract_can_be_created_and_signed(sample_booking):
    booking, lock = sample_booking
    gateway = SandboxGateway()
    confirm_payment(
        lock_client=lock, booking=booking, provider="ORANGE_MONEY",
        provider_reference=f"REF-{uuid.uuid4()}", platform_fee_xaf=Decimal("3000"),
        payment_gateway=gateway, raw_webhook_payload=b"{}", webhook_signature_header="header",
    )

    from transactions.models import Contract, ContractFile
    contract = Contract.objects.create(booking=booking, contract_type=ContractType.LEASE)
    assert contract.is_signed is False

    contract.sign(signature_hash="abc123signaturehash")
    assert contract.is_signed is True
    assert contract.signed_at is not None

    ContractFile.objects.create(contract=contract, file_type="LEASE_PDF", file_url="https://example.com/lease.pdf")
    assert contract.attached_files.count() == 1
