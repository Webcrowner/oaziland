"""
Tests proving Prompt 19's literal acceptance criteria: a confirmed
booking now actually sends a WhatsApp confirmation and an email
receipt — a real gap this prompt closes (confirm_payment previously
sent nothing at all).
"""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.models import BookingType
from transactions.services import reserve_booking, initiate_booking_payment, confirm_payment
from payments.gateways import SandboxGateway
from notifications.models import Notification


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


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_confirmed_booking_sends_real_whatsapp_confirmation_and_email_receipt(quarter):
    from monetization.models import PlatformFeePolicy, TransactionCategory
    PlatformFeePolicy.objects.get_or_create(category=TransactionCategory.PROPERTY_BOOKING, defaults={"fee_percent": Decimal("3.0")})

    landlord = User.objects.create(username="notif_landlord", phone="+237699999201")
    guest = User.objects.create(username="notif_guest", phone="+237699999202")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    lock = FakeLock()
    gateway = SandboxGateway()
    booking = reserve_booking(
        lock_client=lock, requester=guest, booking_type=BookingType.GENERAL_RENTAL,
        target_content_type="property.Listing", target_id=listing.id, amount_xaf=Decimal("100000"),
    )
    initiate_booking_payment(booking=booking, payment_gateway=gateway, phone_number="+237670000123")

    assert Notification.objects.filter(recipient=guest, notification_type="BOOKING_CONFIRMED").exists() is False

    confirm_payment(
        lock_client=lock, booking=booking, provider="MTN_MOMO", provider_reference=booking.idempotency_key,
        payment_gateway=gateway, raw_webhook_payload=b"{}", webhook_signature_header="sandbox",
    )

    whatsapp_confirmation = Notification.objects.filter(recipient=guest, notification_type="BOOKING_CONFIRMED", channel="WHATSAPP")
    assert whatsapp_confirmation.exists()
    assert whatsapp_confirmation.first().delivered is True
    assert "100000" in whatsapp_confirmation.first().message

    email_receipt = Notification.objects.filter(recipient=guest, notification_type="BOOKING_RECEIPT", channel="EMAIL")
    assert email_receipt.exists()
    assert booking.idempotency_key in email_receipt.first().message
