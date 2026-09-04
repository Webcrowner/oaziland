"""
oaziland.analytics — a small, shared trend-analysis utility every
dashboard across the platform can reuse, so 'analytics' means the same
thing (a real period-over-period comparison) everywhere instead of
each app inventing its own version differently — or, as was the case
before this, several dashboards having no trend dimension at all,
just a current-state snapshot.
"""
from decimal import Decimal


def compute_period_over_period(*, queryset, date_field: str, period_days: int = 30, aggregate_field: str = None, now=None):
    """Compares the CURRENT period (the last `period_days` days)
    against the PRECEDING period of equal length. Counts rows by
    default; sums `aggregate_field` instead if given (e.g. revenue).

    WHY this inspects the field's actual type: filtering a plain
    DateField (e.g. HostelBilling.due_date) with a timezone-aware
    DATETIME bound doesn't reliably compare as "today or later" —
    found by a real test against real data (get_hostel_occupancy_
    summary's revenue trend silently returned 0 instead of the actual
    total). Using a plain date() bound for a DateField, and the full
    aware datetime for a DateTimeField, is what actually works
    correctly for both column types this utility is asked to trend on.

    WHY percent_change is None (not 0 or a fake number) when the
    previous period had zero activity: a jump from 0 to any positive
    number is technically an infinite percent increase — reporting it
    as some large fabricated number would be misleading. None signals
    'not enough history to compare' honestly, and callers should
    display that as 'New' or '—', not silently treat it as 0%."""
    from django.utils import timezone
    from django.db.models import Sum, DateField
    from datetime import timedelta

    now = now or timezone.now()
    current_start = now - timedelta(days=period_days)
    previous_start = now - timedelta(days=period_days * 2)

    model_field = queryset.model._meta.get_field(date_field)
    # DateField (but not its DateTimeField subclass) — DateTimeField
    # instances also satisfy isinstance(..., DateField) in Django, so
    # this checks the MRO precisely rather than relying on that alone.
    from django.db.models import DateTimeField
    is_plain_date_field = isinstance(model_field, DateField) and not isinstance(model_field, DateTimeField)

    if is_plain_date_field:
        current_start, previous_start, now_bound = current_start.date(), previous_start.date(), now.date()
        # WHY __lte here, not __lt: a DateField has whole-day granularity
        # — if now_bound is literally today's date, an EXCLUSIVE upper
        # bound (__lt) would incorrectly exclude every record dated
        # today, since today is never "less than" today. A DateTimeField
        # doesn't have this problem (timezone.now() always has a precise
        # time component later than midnight), so it correctly keeps the
        # exclusive bound. Found by a real test against real data.
        current_qs = queryset.filter(**{f"{date_field}__gte": current_start, f"{date_field}__lte": now_bound})
        previous_qs = queryset.filter(**{f"{date_field}__gte": previous_start, f"{date_field}__lt": current_start})
    else:
        now_bound = now
        current_qs = queryset.filter(**{f"{date_field}__gte": current_start, f"{date_field}__lt": now_bound})
        previous_qs = queryset.filter(**{f"{date_field}__gte": previous_start, f"{date_field}__lt": current_start})

    if aggregate_field:
        current_value = current_qs.aggregate(total=Sum(aggregate_field))["total"] or Decimal("0")
        previous_value = previous_qs.aggregate(total=Sum(aggregate_field))["total"] or Decimal("0")
    else:
        current_value = current_qs.count()
        previous_value = previous_qs.count()

    if previous_value:
        percent_change = round(((current_value - previous_value) / previous_value) * 100, 1)
    else:
        percent_change = None

    return {
        "current_period_value": current_value,
        "previous_period_value": previous_value,
        "percent_change": percent_change,
        "period_days": period_days,
    }


def top_n_by_aggregate(*, queryset, group_by_field: str, aggregate_field: str, n: int = 5):
    """'Top event types by revenue,' 'top room types by revenue' — the
    exact recurring analytics pattern the Hotels and Events specs both
    explicitly ask for, built once here instead of twice differently."""
    from django.db.models import Sum

    return list(
        queryset.values(group_by_field)
        .annotate(total=Sum(aggregate_field))
        .order_by("-total")[:n]
    )
