"""
Tests for the real payment webhook endpoint — the actual gap found and
closed during Prompt 21's security review. Confirms a valid webhook
confirms a booking through the real URL, an unknown booking 404s, and
(critically) an invalid signature is genuinely rejected with a 403 —
not silently trusted.
"""
import pytest
from decimal import Decimal
from unittest.mock import patch

from rest_framework.test import APIClient

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.models import Booking, BookingType, BookingStatus
from monetization.models import PlatformFeePolicy, TransactionCategory
from payments.gateways import PaymentGateway, WebhookVerificationResult, DebitResult


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def confirmable_booking(db, quarter):
    PlatformFeePolicy.objects.get_or_create(category=TransactionCategory.PROPERTY_BOOKING, defaults={"fee_percent": Decimal("3.0")})
    landlord = User.objects.create(username="webhook_landlord", phone="+237699999901")
    guest = User.objects.create(username="webhook_guest", phone="+237699999902")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    return Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=guest, status=BookingStatus.PAYMENT_PROCESSING, amount_xaf=Decimal("100000"), idempotency_key="webhook-test-1",
    )


@pytest.mark.django_db
def test_webhook_confirms_booking_with_valid_signature(confirmable_booking):
    client = APIClient()
    response = client.post("/api/webhooks/payment/", {
        "booking_id": str(confirmable_booking.id), "provider": "MTN_MOMO", "provider_reference": "webhook-test-1",
    }, HTTP_X_WEBHOOK_SIGNATURE="anything-sandbox-always-accepts")

    assert response.status_code == 200
    confirmable_booking.refresh_from_db()
    assert confirmable_booking.status == BookingStatus.CONFIRMED


@pytest.mark.django_db
def test_webhook_returns_404_for_an_unknown_booking():
    client = APIClient()
    response = client.post("/api/webhooks/payment/", {
        "booking_id": "00000000-0000-0000-0000-000000000000", "provider": "MTN_MOMO", "provider_reference": "doesnt-matter",
    }, HTTP_X_WEBHOOK_SIGNATURE="anything")
    assert response.status_code == 404


class FakeInvalidSignatureGateway(PaymentGateway):
    """A gateway that ALWAYS reports an invalid signature — used
    specifically to prove the webhook view genuinely rejects a bad
    signature, since the real SandboxGateway always reports valid
    (it has nothing real to verify against)."""
    def initiate_debit(self, *, phone_number, amount_xaf, idempotency_key):
        return DebitResult(success=True, provider_reference="fake", raw_provider_response={})

    def verify_webhook(self, *, raw_payload, signature_header):
        return WebhookVerificationResult(is_valid_signature=False, provider_reference="fake", payment_succeeded=False)


@pytest.mark.django_db
def test_webhook_rejects_an_invalid_signature(confirmable_booking):
    """The critical security property: a webhook claiming to confirm
    a payment, but with a signature that doesn't actually verify, must
    be rejected — not trusted just because it POSTed the right shape
    of data."""
    client = APIClient()
    with patch("payments.gateways.get_active_gateway", return_value=FakeInvalidSignatureGateway()):
        response = client.post("/api/webhooks/payment/", {
            "booking_id": str(confirmable_booking.id), "provider": "MTN_MOMO", "provider_reference": "webhook-test-1",
        }, HTTP_X_WEBHOOK_SIGNATURE="a-forged-signature")

    assert response.status_code == 403
    confirmable_booking.refresh_from_db()
    assert confirmable_booking.status == BookingStatus.PAYMENT_PROCESSING  # NOT confirmed — correctly rejected
