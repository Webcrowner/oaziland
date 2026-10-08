from decimal import Decimal
import pytest
from rest_framework.test import APIClient
from identity.models import User
from monetization.models import Wallet, WalletTransaction, WalletTransactionType, WithdrawalStatus
from monetization.services import get_or_create_wallet
from transactions.models import Booking, BookingType, BookingStatus, PaymentEscrow, EscrowStatus
from transactions.services import complete_booking


@pytest.fixture
def landlord_user(db):
    return User.objects.create_user(
        username="test_landlord_unique",
        email="landlord_unique@example.com",
        phone="+237699887766",
        password="TestPassword123!",
    )


@pytest.fixture
def seeker_user(db):
    return User.objects.create_user(
        username="test_seeker_unique",
        email="seeker_unique@example.com",
        phone="+237611223344",
        password="TestPassword123!",
    )


@pytest.mark.django_db
def test_complete_booking_auto_credits_payee_wallet(landlord_user, seeker_user):
    from property.models import House, PropertyType
    from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter

    cm = Country.objects.create(name="Cameroon_Test", iso_code="CTX")
    reg = Region.objects.create(country=cm, name="Centre_Test")
    div = Division.objects.create(region=reg, name="Mfoundi_Test")
    sub = Subdivision.objects.create(division=div, name="Yde1_Test")
    vil = VillageOrDistrict.objects.create(subdivision=sub, name="Bastos_Test")
    qtr = Quarter.objects.create(village_or_district=vil, name="Quarter_Test")

    house = House.objects.create(
        owner=landlord_user,
        quarter=qtr,
        type=PropertyType.HOUSE,
    )

    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL,
        target_content_type="property.House",
        target_id=house.id,
        requester=seeker_user,
        status=BookingStatus.CONFIRMED,
        amount_xaf=Decimal("100000"),
        idempotency_key="test-key-payout-1",
    )
    escrow = PaymentEscrow.objects.create(
        booking=booking,
        gross_amount_xaf=Decimal("100000"),
        platform_fee_xaf=Decimal("5000"),
        payee_amount_xaf=Decimal("95000"),
        status=EscrowStatus.HELD,
        provider="MTN_MOMO",
        provider_reference="test-ref-1",
    )

    complete_booking(booking=booking)

    escrow.refresh_from_db()
    assert escrow.status == EscrowStatus.RELEASED

    wallet = get_or_create_wallet(landlord_user)
    assert wallet.balance_xaf == Decimal("95000")
    assert wallet.transactions.count() == 1
    assert wallet.transactions.first().amount_xaf == Decimal("95000")


@pytest.mark.django_db
def test_wallet_api_and_momo_withdrawal(landlord_user):
    client = APIClient()
    client.force_authenticate(user=landlord_user)

    wallet = get_or_create_wallet(landlord_user)
    wallet.balance_xaf = Decimal("50000")
    wallet.save()

    # 1. Check wallet GET
    res = client.get("/api/wallet/")
    assert res.status_code == 200
    assert Decimal(str(res.data["balance_xaf"])) == Decimal("50000")

    # 2. Insufficient balance withdrawal fails
    res_fail = client.post("/api/wallet/withdraw/", {"amount_xaf": 80000, "phone_number": "+237699887766"})
    assert res_fail.status_code == 400

    # 3. Successful withdrawal to MTN MoMo
    res_success = client.post(
        "/api/wallet/withdraw/",
        {"amount_xaf": 20000, "phone_number": "+237699887766", "provider": "MTN_MOMO"},
    )
    assert res_success.status_code == 200
    assert res_success.data["status"] == WithdrawalStatus.PAID_OUT
    assert Decimal(str(res_success.data["balance_xaf"])) == Decimal("30000")

    wallet.refresh_from_db()
    assert wallet.balance_xaf == Decimal("30000")
    assert wallet.withdrawal_requests.count() == 1
    assert wallet.withdrawal_requests.first().status == WithdrawalStatus.PAID_OUT
