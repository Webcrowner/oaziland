"""
finance — automated valuation (AVM), affordability estimates, exportable
earnings reports, and multi-currency display. The wallet itself already
exists in monetization (built as part of Prompt 7's gift economy) — this
app is everything else Prompt 13 asks for, reusing that wallet rather
than building a second one.
"""
import uuid
from django.conf import settings
from django.db import models


class ValuationEstimate(models.Model):
    """A single AVM estimate for an address — kept as its own record
    (not just a return value) so estimates can be looked back on later
    and compared against what a property actually rented/sold for, which
    is how a valuation model gets better over time."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="valuation_estimates")
    quarter = models.ForeignKey("geo.Quarter", on_delete=models.CASCADE, related_name="valuation_estimates")
    property_type = models.CharField(max_length=30)
    size_sqm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    estimated_low_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    estimated_high_xaf = models.DecimalField(max_digits=14, decimal_places=2)
    comparable_count = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "valuation_estimates"


class ExchangeRateSnapshot(models.Model):
    """A cached exchange rate — XAF is ALWAYS the stored currency
    everywhere else in the platform; this table only supports DISPLAY
    conversion for diaspora users, never changes what's actually stored
    or charged."""
    currency_code = models.CharField(max_length=3)
    xaf_per_unit = models.DecimalField(max_digits=12, decimal_places=6)
    fetched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "exchange_rate_snapshots"
        get_latest_by = "fetched_at"
