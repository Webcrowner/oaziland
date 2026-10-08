"""
Seeds a default PlatformFeePolicy row for every TransactionCategory —
the real gap this closes: PlatformFeePolicy.fee_for() does a plain
.get(category=...), which raises DoesNotExist for any category with no
row. Without this migration, a fresh database (dev OR production) has
ZERO fee policy rows, so the very first real payment confirmation
(confirm_payment(), which looks up the fee automatically) would crash.

Percentages here are sensible, clearly-labeled starting defaults —
same approach used elsewhere in this codebase when the spec leaves an
exact number "configurable" (e.g. hotel dynamic-pricing multipliers).
Admins can change any of these via Django admin at any time; nothing
in the codebase hardcodes these values outside this seed.
"""
from decimal import Decimal
from django.db import migrations


DEFAULT_FEE_PERCENTAGES = {
    "PROPERTY_BOOKING": Decimal("5.00"),
    "MARKETPLACE_SALE": Decimal("5.00"),
    "SERVICE_PAYMENT": Decimal("10.00"),
    "AD_SPEND": Decimal("0.00"),
    "GIFT_CONVERSION": Decimal("10.00"),
    "WALLET_WITHDRAWAL": Decimal("2.00"),
    "RIDE_FARE": Decimal("15.00"),
}


def seed_fee_policies(apps, schema_editor):
    PlatformFeePolicy = apps.get_model("monetization", "PlatformFeePolicy")
    for category, fee_percent in DEFAULT_FEE_PERCENTAGES.items():
        PlatformFeePolicy.objects.get_or_create(category=category, defaults={"fee_percent": fee_percent})


def unseed_fee_policies(apps, schema_editor):
    PlatformFeePolicy = apps.get_model("monetization", "PlatformFeePolicy")
    PlatformFeePolicy.objects.filter(category__in=DEFAULT_FEE_PERCENTAGES.keys()).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("monetization", "0006_creatorpremiumsubscription"),
    ]

    operations = [
        migrations.RunPython(seed_fee_policies, unseed_fee_policies),
    ]
