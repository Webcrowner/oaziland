"""Admin pricing editor: platform fee percentages and the boost price list."""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from identity.models import AdminProfile, User
from monetization.models import (
    AdPlacement, BoostDurationUnit, BoostPricingTier, PlatformFeePolicy, TransactionCategory,
)
from monetization.services import get_boost_price, purchase_campaign_boost
from payments.gateways import SandboxGateway
from trust_safety.models import AuditLog


def make_user(username, phone):
    return User.objects.create_user(username=username, email=f"{username}@example.com", phone=phone, password="x-Strong-pass-1")


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def boss(db):
    user = make_user("pricing_boss", "+237699500001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def limited(db):
    user = make_user("pricing_limited", "+237699500002")
    AdminProfile.objects.create(user=user, permissions=["moderation"])
    return user


@pytest.fixture
def member(db):
    return make_user("pricing_member", "+237699500003")


def fee_row(data, category):
    return next(row for row in data["fees"] if row["category"] == category)


def boost_row(data, placement, unit):
    return next(row for row in data["boosts"] if row["placement"] == placement and row["duration_unit"] == unit)


# ---------------------------------------------------------------- access

@pytest.mark.django_db
def test_only_full_access_admins_can_see_or_change_pricing(boss, limited, member):
    put_fee = ("put", "/api/admin/pricing/fees/PROPERTY_BOOKING/", {"fee_percent": "4"})
    put_boost = ("put", "/api/admin/pricing/boosts/", {"placement": "FEED_BOOSTED_POST", "duration_unit": "DAILY", "price_xaf": "1000"})

    for user in (limited, member):
        client = client_for(user)
        assert client.get("/api/admin/pricing/").status_code == 403
        for method, url, body in (put_fee, put_boost):
            assert getattr(client, method)(url, body, format="json").status_code == 403
    assert APIClient().get("/api/admin/pricing/").status_code in (401, 403)
    assert client_for(boss).get("/api/admin/pricing/").status_code == 200


# ---------------------------------------------------------------- the snapshot

@pytest.mark.django_db
def test_snapshot_lists_every_fee_category_and_every_boost_option(boss):
    BoostPricingTier.objects.create(placement=AdPlacement.FEED_BOOSTED_POST, duration_unit=BoostDurationUnit.DAILY, price_xaf=Decimal("3000"))

    data = client_for(boss).get("/api/admin/pricing/").data

    assert [row["category"] for row in data["fees"]] == [c.value for c in TransactionCategory]
    assert fee_row(data, "WALLET_WITHDRAWAL")["fee_percent"] == "2.00"  # seeded default
    assert len(data["boosts"]) == len(AdPlacement) * len(BoostDurationUnit)
    assert boost_row(data, "FEED_BOOSTED_POST", "DAILY")["price_xaf"] == "3000.00"
    assert boost_row(data, "FEED_BOOSTED_POST", "HOURLY")["price_xaf"] is None
    assert data["max_fee_percent"] == "50"


@pytest.mark.django_db
def test_a_missing_fee_row_shows_as_not_set(boss):
    PlatformFeePolicy.objects.filter(category="RIDE_FARE").delete()

    assert fee_row(client_for(boss).get("/api/admin/pricing/").data, "RIDE_FARE")["fee_percent"] is None


# ---------------------------------------------------------------- fees

@pytest.mark.django_db
def test_changing_a_fee_takes_effect_and_is_audited_with_old_and_new_values(boss):
    PlatformFeePolicy.objects.update_or_create(category="PROPERTY_BOOKING", defaults={"fee_percent": Decimal("5.00")})

    res = client_for(boss).put("/api/admin/pricing/fees/PROPERTY_BOOKING/", {"fee_percent": "6.5"}, format="json")

    assert res.status_code == 200
    assert fee_row(res.data, "PROPERTY_BOOKING")["fee_percent"] == "6.50"
    assert PlatformFeePolicy.fee_for("PROPERTY_BOOKING", Decimal("100000")) == Decimal("6500")
    entry = AuditLog.objects.get(action="AdminFeePolicyView/put")
    assert entry.actor == boss and entry.target_label == "Property Booking"
    assert entry.details["old_value"] == "5.00" and entry.details["new_value"] == "6.50"


@pytest.mark.django_db
def test_a_fee_can_be_created_when_the_row_is_missing_and_set_to_zero(boss):
    PlatformFeePolicy.objects.filter(category="RIDE_FARE").delete()
    client = client_for(boss)

    assert client.put("/api/admin/pricing/fees/RIDE_FARE/", {"fee_percent": "0"}, format="json").status_code == 200
    assert PlatformFeePolicy.objects.get(category="RIDE_FARE").fee_percent == Decimal("0")
    assert AuditLog.objects.get().details["old_value"] == "not set"


@pytest.mark.django_db
@pytest.mark.parametrize("value", ["-1", "50.01", "100", "abc", "", None, "5.123", "1e3"])
def test_bad_fee_values_are_rejected_and_nothing_changes(boss, value):
    PlatformFeePolicy.objects.update_or_create(category="PROPERTY_BOOKING", defaults={"fee_percent": Decimal("5.00")})

    res = client_for(boss).put("/api/admin/pricing/fees/PROPERTY_BOOKING/", {"fee_percent": value}, format="json")

    assert res.status_code == 400
    assert PlatformFeePolicy.objects.get(category="PROPERTY_BOOKING").fee_percent == Decimal("5.00")


@pytest.mark.django_db
def test_the_highest_allowed_fee_is_accepted_and_an_unknown_category_is_a_404(boss):
    client = client_for(boss)

    assert client.put("/api/admin/pricing/fees/AD_SPEND/", {"fee_percent": "50"}, format="json").status_code == 200
    assert client.put("/api/admin/pricing/fees/NOT_A_CATEGORY/", {"fee_percent": "5"}, format="json").status_code == 404
    assert client.put("/api/admin/pricing/fees/AD_SPEND/", {}, format="json").status_code == 400


# ---------------------------------------------------------------- boost prices

@pytest.mark.django_db
def test_setting_updating_and_removing_a_boost_price(boss):
    client = client_for(boss)
    body = {"placement": "FEED_BOOSTED_POST", "duration_unit": "DAILY"}

    created = client.put("/api/admin/pricing/boosts/", {**body, "price_xaf": "3000"}, format="json")
    assert created.status_code == 200 and boost_row(created.data, "FEED_BOOSTED_POST", "DAILY")["price_xaf"] == "3000.00"
    assert get_boost_price(placement="FEED_BOOSTED_POST", duration_unit="DAILY", duration_quantity=3) == Decimal("9000")

    updated = client.put("/api/admin/pricing/boosts/", {**body, "price_xaf": 3500.5}, format="json")
    assert boost_row(updated.data, "FEED_BOOSTED_POST", "DAILY")["price_xaf"] == "3500.50"
    assert BoostPricingTier.objects.count() == 1

    removed = client.put("/api/admin/pricing/boosts/", {**body, "price_xaf": None}, format="json")
    assert boost_row(removed.data, "FEED_BOOSTED_POST", "DAILY")["price_xaf"] is None
    assert BoostPricingTier.objects.count() == 0

    entries = list(AuditLog.objects.filter(action="AdminBoostPriceView/put").order_by("created_at"))
    assert [(e.details["old_value"], e.details["new_value"]) for e in entries] == [
        ("not offered", "3000.00"), ("3000.00", "3500.50"), ("3500.50", "not offered"),
    ]
    assert entries[0].target_label == "Boosted in Feed / Daily"


@pytest.mark.django_db
@pytest.mark.parametrize("price", ["0", "-5", "10000001", "abc", ""])
def test_bad_boost_prices_are_rejected(boss, price):
    res = client_for(boss).put(
        "/api/admin/pricing/boosts/", {"placement": "FEED_BOOSTED_POST", "duration_unit": "DAILY", "price_xaf": price}, format="json",
    )

    assert res.status_code == 400
    assert BoostPricingTier.objects.count() == 0


@pytest.mark.django_db
def test_unknown_boost_options_and_a_missing_price_are_rejected(boss):
    client = client_for(boss)

    assert client.put("/api/admin/pricing/boosts/", {"placement": "NOPE", "duration_unit": "DAILY", "price_xaf": "100"}, format="json").status_code == 400
    assert client.put("/api/admin/pricing/boosts/", {"placement": "FEED_BOOSTED_POST", "duration_unit": "DAILY"}, format="json").status_code == 400


# ---------------------------------------------------------------- what customers see

@pytest.mark.django_db
def test_a_removed_boost_option_is_refused_cleanly_instead_of_crashing(boss, member):
    BoostPricingTier.objects.create(placement="FEED_BOOSTED_POST", duration_unit="DAILY", price_xaf=Decimal("3000"))
    client_for(boss).put(
        "/api/admin/pricing/boosts/", {"placement": "FEED_BOOSTED_POST", "duration_unit": "DAILY", "price_xaf": None}, format="json",
    )

    quote = client_for(member).post(
        "/api/ad-campaigns/quote/", {"placement": "FEED_BOOSTED_POST", "duration_unit": "DAILY", "duration_quantity": 2}, format="json",
    )
    assert quote.status_code == 400

    with pytest.raises(ValueError, match="not available"):
        purchase_campaign_boost(
            owner=member, placement="FEED_BOOSTED_POST", duration_unit="DAILY", duration_quantity=2,
            payment_gateway=SandboxGateway(), phone_number="+237699500003",
        )

    purchase = client_for(member).post(
        "/api/ad-campaigns/purchase/",
        {"placement": "FEED_BOOSTED_POST", "duration_unit": "DAILY", "duration_quantity": 2, "phone_number": "+237699500003"}, format="json",
    )
    assert purchase.status_code == 400
