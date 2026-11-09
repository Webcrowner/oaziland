"""
trust_safety.analytics — the admin console's analytics: how the platform is moving over a chosen period, not
only where it stands today.

For a period of N days (compared with the N days before it) this returns headline figures with their change,
time series to chart, a conversion funnel for people who joined in the period, how quickly the team handles
queues, and breakdowns by service, neighbourhood and role. Read-only; every figure comes straight from the
records that already exist.
"""
import statistics
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate, TruncWeek
from django.utils import timezone

PERIODS = (7, 30, 90, 365)
SPEED_SAMPLE_LIMIT = 5000  # enough for a stable median without loading a whole table


def _money(value) -> str:
    return f"{Decimal(value or 0):.2f}"


def _change(current, previous):
    if not previous:
        return None  # nothing to compare with: shown as "new" rather than a made-up percentage
    return round(float((Decimal(current) - Decimal(previous)) / Decimal(previous)) * 100, 1)


class Window:
    """The current period and the equally long period just before it."""

    def __init__(self, days: int, now=None):
        self.days = days
        self.end = now or timezone.now()
        self.start = self.end - timedelta(days=days)
        self.previous_start = self.start - timedelta(days=days)

    def current(self, field: str) -> Q:
        return Q(**{f"{field}__gte": self.start, f"{field}__lt": self.end})

    def previous(self, field: str) -> Q:
        return Q(**{f"{field}__gte": self.previous_start, f"{field}__lt": self.start})


def _metric(window, queryset, field, *, total=None, money=False) -> dict:
    """{current, previous, change} for a count (or a sum of `total`) of rows dated by `field`."""
    def measure(condition):
        rows = queryset.filter(condition)
        if total:
            return rows.aggregate(value=Sum(total))["value"] or Decimal("0")
        return rows.count()

    current, previous = measure(window.current(field)), measure(window.previous(field))
    return {
        "current": _money(current) if money else current,
        "previous": _money(previous) if money else previous,
        "change": _change(current, previous),
    }


def _headline(window) -> dict:
    from engagement.models import SupportTicket
    from identity.models import KYCProfile, User, VerificationStatus
    from marketplace.models import MarketplaceListingBase
    from monetization.models import WithdrawalRequest, WithdrawalStatus
    from property.models import Listing
    from property_management.models import DisputeCase
    from transactions.models import EscrowStatus, PaymentEscrow

    from .models import ContentReport

    escrows = PaymentEscrow.objects.all()
    return {
        "new_users": _metric(window, User.objects.all(), "date_joined"),
        "kyc_submitted": _metric(window, KYCProfile.objects.all(), "submitted_at"),
        "kyc_verified": _metric(window, KYCProfile.objects.filter(kyc_status=VerificationStatus.VERIFIED), "reviewed_at"),
        "property_listings_published": _metric(window, Listing.objects.all(), "published_at"),
        "marketplace_listings_created": _metric(window, MarketplaceListingBase.objects.all(), "created_at"),
        "paid_bookings": _metric(window, escrows, "held_at"),
        "payment_volume_xaf": _metric(window, escrows, "held_at", total="gross_amount_xaf", money=True),
        "fees_earned_xaf": _metric(window, escrows.filter(status=EscrowStatus.RELEASED), "released_at", total="platform_fee_xaf", money=True),
        "refunded_xaf": _metric(window, escrows.filter(refunded_amount_xaf__gt=0), "held_at", total="refunded_amount_xaf", money=True),
        "disputes_opened": _metric(window, DisputeCase.objects.all(), "created_at"),
        "reports_filed": _metric(window, ContentReport.objects.all(), "created_at"),
        "support_chats": _metric(window, SupportTicket.objects.all(), "created_at"),
        "payouts_xaf": _metric(window, WithdrawalRequest.objects.filter(status=WithdrawalStatus.PAID_OUT), "resolved_at", total="amount_xaf", money=True),
    }


def _buckets(window):
    """Bucket start dates covering the window: days for up to 90 days, otherwise Monday-starting weeks."""
    weekly = window.days > 90
    first = timezone.localdate(window.start)
    last = timezone.localdate(window.end)
    if weekly:
        first -= timedelta(days=first.weekday())
    step = timedelta(days=7 if weekly else 1)
    dates = []
    day = first
    while day <= last:
        dates.append(day)
        day += step
    return weekly, dates


def _series(window) -> dict:
    from identity.models import User
    from transactions.models import PaymentEscrow

    weekly, dates = _buckets(window)
    trunc = TruncWeek if weekly else TruncDate

    def bucketed(queryset, field, total=None):
        rows = queryset.filter(window.current(field)).annotate(bucket=trunc(field)).values("bucket")
        rows = rows.annotate(value=Sum(total) if total else Count("pk"))
        found = {}
        for row in rows:
            bucket = row["bucket"]
            key = bucket.date() if hasattr(bucket, "date") else bucket
            found[key] = found.get(key, 0) + (row["value"] or 0)
        return found

    users = bucketed(User.objects.all(), "date_joined")
    bookings = bucketed(PaymentEscrow.objects.all(), "held_at")
    volume = bucketed(PaymentEscrow.objects.all(), "held_at", total="gross_amount_xaf")
    return {
        "interval": "week" if weekly else "day",
        "points": [
            {
                "date": day.isoformat(), "new_users": users.get(day, 0), "paid_bookings": bookings.get(day, 0),
                "payment_volume_xaf": _money(volume.get(day, 0)),
            }
            for day in dates
        ],
    }


def _funnel(window) -> list[dict]:
    """Of the people who joined in the period, how many went on to each next step (at any time since)."""
    from identity.models import User, VerificationStatus
    from marketplace.models import MarketplaceListingBase
    from property.models import Listing

    cohort = User.objects.filter(window.current("date_joined"))
    joined = cohort.count()
    steps = [
        ("joined", joined),
        ("kyc_submitted", cohort.filter(kyc_profile__isnull=False).count()),
        ("kyc_verified", cohort.filter(kyc_profile__kyc_status=VerificationStatus.VERIFIED).count()),
        ("paid_booking", cohort.filter(bookings__escrow__isnull=False).distinct().count()),
        ("listed_something", cohort.filter(
            Q(pk__in=Listing.objects.values("listed_by")) | Q(pk__in=MarketplaceListingBase.objects.values("lister_user"))
        ).count()),
    ]
    return [{"step": name, "count": count, "percent": round(count * 100 / joined, 1) if joined else None} for name, count in steps]


def _median_hours(pairs) -> dict:
    hours = [(end - start).total_seconds() / 3600 for start, end in pairs if start and end and end >= start]
    return {"median_hours": round(statistics.median(hours), 1) if hours else None, "count": len(hours)}


def _speed(window) -> dict:
    """How quickly the team handled things that were finished in the period (median, in hours)."""
    from identity.models import KYCProfile
    from monetization.models import WithdrawalRequest
    from property_management.models import DisputeCase

    def sample(queryset, start_field, end_field):
        return list(queryset.filter(window.current(end_field)).values_list(start_field, end_field)[:SPEED_SAMPLE_LIMIT])

    return {
        "kyc_review": _median_hours(sample(KYCProfile.objects.all(), "submitted_at", "reviewed_at")),
        "dispute_resolution": _median_hours(sample(DisputeCase.objects.all(), "created_at", "resolved_at")),
        "withdrawal_review": _median_hours(sample(WithdrawalRequest.objects.all(), "requested_at", "resolved_at")),
    }


def _breakdowns(window) -> dict:
    from identity.models import AgencyProfile, AgentProfile, LandlordProfile, TechnicianProfile
    from marketplace.models import DriverProfile, MarketplaceListingBase
    from property.models import Listing
    from transactions.models import BookingType, PaymentEscrow

    labels = dict(BookingType.choices)
    by_service = [
        {"booking_type": row["booking__booking_type"], "label": labels.get(row["booking__booking_type"], row["booking__booking_type"]),
         "count": row["count"], "volume_xaf": _money(row["volume"])}
        for row in PaymentEscrow.objects.filter(window.current("held_at")).values("booking__booking_type")
        .annotate(count=Count("pk"), volume=Sum("gross_amount_xaf")).order_by("-volume")
    ]

    places = {}
    for row in Listing.objects.filter(window.current("published_at")).values("property_asset__quarter__name").annotate(n=Count("pk")):
        name = row["property_asset__quarter__name"]
        places[name] = places.get(name, 0) + row["n"]
    for row in MarketplaceListingBase.objects.filter(window.current("created_at"), quarter__isnull=False).values("quarter__name").annotate(n=Count("pk")):
        places[row["quarter__name"]] = places.get(row["quarter__name"], 0) + row["n"]
    top_places = sorted(({"name": name, "count": n} for name, n in places.items() if name), key=lambda r: (-r["count"], r["name"]))[:8]

    roles = {
        "agents": AgentProfile, "agencies": AgencyProfile, "landlords": LandlordProfile,
        "technicians": TechnicianProfile, "drivers": DriverProfile,
    }
    new_roles = {name: model.objects.filter(window.current("created_at")).count() for name, model in roles.items()}
    return {"by_service": by_service, "top_neighbourhoods": top_places, "new_providers": new_roles}


def platform_analytics(days: int = 30, now=None) -> dict:
    window = Window(days, now=now)
    return {
        "days": days,
        "start": window.start,
        "end": window.end,
        "headline": _headline(window),
        "series": _series(window),
        "funnel": _funnel(window),
        "speed": _speed(window),
        "breakdowns": _breakdowns(window),
    }
