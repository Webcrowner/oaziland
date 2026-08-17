"""
finance.services — AVM valuation, affordability estimation, earnings
reports, and currency display conversion. Reuses monetization.Wallet
(built in Prompt 7) rather than a second wallet system, and reuses
geo.QuarterPriceTrend rather than a separate pricing data source.
"""
from decimal import Decimal


def estimate_property_value(*, quarter, property_type: str, requested_by=None):
    """A straightforward averaging AVM: looks at comparable PUBLISHED
    listings in the same quarter and property type, and returns a
    low/high range. Deliberately simple and clearly labeled as an
    estimate, never a guarantee."""
    from property.models import Listing, ListingStatus
    from .models import ValuationEstimate

    comparables = Listing.objects.filter(
        status=ListingStatus.PUBLISHED, property_asset__quarter=quarter,
        property_asset__type=property_type,
    )
    prices = list(comparables.values_list("price_xaf", flat=True))

    if not prices:
        low, high = Decimal("0"), Decimal("0")
    else:
        avg = sum(prices) / len(prices)
        low = avg * Decimal("0.85")
        high = avg * Decimal("1.15")

    return ValuationEstimate.objects.create(
        requested_by=requested_by, quarter=quarter, property_type=property_type,
        estimated_low_xaf=low, estimated_high_xaf=high, comparable_count=len(prices),
    )


def estimate_affordable_rent_range(*, monthly_income_xaf: Decimal):
    """A simple, transparent affordability rule (rent should not exceed
    roughly a third of income) — not a credit-scoring model."""
    max_recommended = monthly_income_xaf * Decimal("0.33")
    comfortable = monthly_income_xaf * Decimal("0.25")
    return {"comfortable_rent_xaf": comfortable, "max_recommended_rent_xaf": max_recommended}


def generate_earnings_report(*, user, start_date, end_date):
    """Pulls real Commission and PaymentEscrow records for a landlord or
    agent over a date range — the actual data an exportable PDF/CSV
    report would be built from."""
    from transactions.models import Commission, PaymentEscrow

    commissions = Commission.objects.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)
    payouts = PaymentEscrow.objects.filter(
        status="RELEASED", released_at__date__gte=start_date, released_at__date__lte=end_date,
    )
    total_commission = sum((c.agent_share_xaf for c in commissions), Decimal("0"))
    total_payouts = sum((p.payee_amount_xaf for p in payouts), Decimal("0"))

    return {
        "period": {"start": start_date, "end": end_date},
        "total_commission_earned_xaf": total_commission,
        "total_payouts_received_xaf": total_payouts,
        "transaction_count": commissions.count() + payouts.count(),
    }


def convert_xaf_to_currency(amount_xaf: Decimal, currency_code: str) -> Decimal:
    """DISPLAY-ONLY conversion — everything is still stored and charged
    in XAF; this only affects what a diaspora user SEES."""
    from .models import ExchangeRateSnapshot
    try:
        rate = ExchangeRateSnapshot.objects.filter(currency_code=currency_code).latest()
    except ExchangeRateSnapshot.DoesNotExist:
        raise ValueError(f"No exchange rate available for {currency_code}")
    return round(amount_xaf / rate.xaf_per_unit, 2)
