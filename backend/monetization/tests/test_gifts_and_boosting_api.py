"""Tests for the real monetization API surfaces closed in this round:
wallet recharge, sending/converting gifts, and ad campaign boosting —
all fully built and unit-tested at the service layer, but with zero
reachable endpoint until now."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from monetization.models import (
    Gift, GiftType, PlatformFeePolicy, TransactionCategory, BoostPricingTier, AdPlacement, BoostDurationUnit,
)


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_recharge_wallet_via_api():
    user = User.objects.create(username="mon_recharge_user", phone="+237699800101")
    response = _auth_client(user).post("/api/wallet/recharge/", {"amount_xaf": "10000", "phone_number": "+237699800101"})
    assert response.status_code == 200
    assert Decimal(response.data["balance_xaf"]) == Decimal("10000")


@pytest.mark.django_db
def test_send_and_convert_gift_via_api():
    sender = User.objects.create(username="mon_gift_sender", phone="+237699800102")
    recipient = User.objects.create(username="mon_gift_recipient", phone="+237699800103")
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.GIFT_CONVERSION, defaults={"fee_percent": Decimal("5")})

    send_response = _auth_client(sender).post("/api/gifts/send/", {"recipient": str(recipient.id), "gift_type": GiftType.ROSE})
    assert send_response.status_code == 201
    assert Gift.objects.filter(sender=sender, recipient=recipient, converted_to_wallet=False).exists()

    mine_response = _auth_client(recipient).get("/api/gifts/mine/")
    assert mine_response.data["unconverted_points"] == 100

    convert_response = _auth_client(recipient).post("/api/gifts/convert/")
    assert convert_response.status_code == 200
    assert Decimal(convert_response.data["converted_xaf"]) == Decimal("475.00")  # 100pts*5xaf=500, minus 5% fee


@pytest.mark.django_db
def test_cannot_send_gift_to_self():
    user = User.objects.create(username="mon_gift_self", phone="+237699800104")
    response = _auth_client(user).post("/api/gifts/send/", {"recipient": str(user.id), "gift_type": GiftType.ROSE})
    assert response.status_code == 400


@pytest.mark.django_db
def test_ad_boost_quote_and_purchase_via_api():
    owner = User.objects.create(username="mon_ad_owner", phone="+237699800105")
    BoostPricingTier.objects.create(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.DAILY, price_xaf=Decimal("3000"))
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.AD_SPEND, defaults={"fee_percent": Decimal("10")})
    client = _auth_client(owner)

    quote_response = client.post("/api/ad-campaigns/quote/", {
        "placement": AdPlacement.FEED_BOOSTED_POST, "duration_unit": BoostDurationUnit.DAILY, "duration_quantity": 3,
    })
    assert quote_response.status_code == 200
    assert Decimal(quote_response.data["total_price_xaf"]) == Decimal("9000")

    purchase_response = client.post("/api/ad-campaigns/purchase/", {
        "placement": AdPlacement.FEED_BOOSTED_POST, "duration_unit": BoostDurationUnit.DAILY, "duration_quantity": 3,
        "phone_number": "+237699800105",
    })
    assert purchase_response.status_code == 201
    assert purchase_response.data["status"] == "ACTIVE"

    mine_response = client.get("/api/my-ad-campaigns/")
    assert mine_response.data["count"] == 1
