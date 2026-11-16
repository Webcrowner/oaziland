"""
The seller's view of their marketplace business: what sold, what Oaziland kept, what reached their wallet, what is
still held in escrow, where the sales came from, plus the payout history and a CSV of every order for bookkeeping.

Money is read from each order's escrow: payee_amount_xaf is what the seller received (after the platform fee),
platform_fee_xaf what Oaziland kept and refunded_amount_xaf what went back to the buyer. Gross sales are the share of
the price that reached the seller before the fee (payee + fee), so partial refunds are already taken out.
"""
import csv
import io
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, F, Sum
from django.db.models.functions import TruncDate, TruncMonth
from django.utils import timezone

PERIODS = {"7d": 7, "30d": 30, "90d": 90, "365d": 365, "all": None}
DEFAULT_PERIOD = "30d"
# Up to this many days the chart has one bar per day; beyond it, one per month.
DAILY_CHART_MAX_DAYS = 90
OPEN_ORDER_STATUSES = ("PAID", "HANDED_OVER", "DISPUTED")
CATEGORY_RELATIONS = {
    "goods": "goodslisting", "cars": "carlisting", "stores": "storelisting",
    "warehouses": "warehouselisting", "businesses": "businesslisting",
}
ESCROW = "booking__escrow"
GROSS = F(f"{ESCROW}__payee_amount_xaf") + F(f"{ESCROW}__platform_fee_xaf")


def period_start(period: str, now=None):
    days = PERIODS[period]
    return None if days is None else (now or timezone.now()) - timedelta(days=days)


def _orders(user):
    from .models import MarketplaceOrder
    return MarketplaceOrder.objects.filter(listing__lister_user=user)


def _completed(user, since):
    from .models import MarketplaceOrderStatus
    rows = _orders(user).filter(status=MarketplaceOrderStatus.COMPLETED, **{f"{ESCROW}__isnull": False})
    return rows.filter(completed_at__gte=since) if since else rows


def _zero(value) -> Decimal:
    return Decimal(value or 0)


def _money(value) -> str:
    return str(_zero(value).quantize(Decimal("1")))


def _series(user, since, now):
    completed = _completed(user, since)
    monthly = since is None or (now - since).days > DAILY_CHART_MAX_DAYS
    trunc = TruncMonth("completed_at") if monthly else TruncDate("completed_at")
    # TruncMonth returns datetimes and TruncDate dates; key both by calendar date.
    rows = {
        (row["bucket"].date() if hasattr(row["bucket"], "date") else row["bucket"]): row
        for row in completed.annotate(bucket=trunc).values("bucket").annotate(
            orders=Count("id"), gross=Sum(GROSS), net=Sum(f"{ESCROW}__payee_amount_xaf"),
        )
    }
    buckets = []
    if monthly:
        first = min((b for b in rows), default=None)
        if first is not None:
            cursor, last = first.replace(day=1), timezone.localdate(now).replace(day=1)
            while cursor <= last:
                buckets.append(cursor)
                cursor = (cursor + timedelta(days=32)).replace(day=1)
    else:
        start = timezone.localdate(since)
        buckets = [start + timedelta(days=i) for i in range((timezone.localdate(now) - start).days + 1)]
    return {
        "bucket": "month" if monthly else "day",
        "points": [
            {
                "date": (b.strftime("%Y-%m") if monthly else b.isoformat()),
                "orders": rows.get(b, {}).get("orders", 0),
                "gross_xaf": _money(rows.get(b, {}).get("gross")),
                "net_xaf": _money(rows.get(b, {}).get("net")),
            }
            for b in buckets
        ],
    }


def dashboard(user, period: str = DEFAULT_PERIOD, now=None) -> dict:
    from monetization.models import Wallet
    from .models import MarketplaceListingBase, MarketplaceOrderStatus, MarketplaceReturnRequest, ReturnStatus
    now = now or timezone.now()
    since = period_start(period, now)
    completed = _completed(user, since)
    totals = completed.aggregate(
        count=Count("id"), units=Sum("quantity"), gross=Sum(GROSS), fee=Sum(f"{ESCROW}__platform_fee_xaf"),
        net=Sum(f"{ESCROW}__payee_amount_xaf"),
    )
    in_window = _orders(user)
    in_window = in_window.filter(created_at__gte=since) if since else in_window
    by_status = {row["status"]: row["count"] for row in in_window.values("status").annotate(count=Count("id"))}
    refunded = in_window.filter(**{f"{ESCROW}__isnull": False}).aggregate(total=Sum(f"{ESCROW}__refunded_amount_xaf"))["total"]
    held = _orders(user).filter(status__in=OPEN_ORDER_STATUSES).aggregate(total=Sum("amount_xaf"), count=Count("id"))
    views = MarketplaceListingBase.objects.filter(lister_user=user).aggregate(total=Sum("view_count"))["total"] or 0
    sold_ever = _orders(user).filter(status=MarketplaceOrderStatus.COMPLETED).count()
    wallet = Wallet.objects.filter(owner=user).first()
    gross = _zero(totals["gross"])

    by_category, top = [], []
    for category, relation in CATEGORY_RELATIONS.items():
        rows = completed.filter(**{f"listing__{relation}__isnull": False})
        agg = rows.aggregate(orders=Count("id"), gross=Sum(GROSS), net=Sum(f"{ESCROW}__payee_amount_xaf"))
        if agg["orders"]:
            by_category.append({"category": category, "orders": agg["orders"], "gross_xaf": _money(agg["gross"]), "net_xaf": _money(agg["net"])})
            for row in rows.values("listing_id", "listing__title").annotate(orders=Count("id"), gross=Sum(GROSS)).order_by("-gross")[:5]:
                top.append({
                    "listing_id": str(row["listing_id"]), "title": row["listing__title"], "category": category,
                    "orders": row["orders"], "gross_xaf": _money(row["gross"]),
                })
    by_category.sort(key=lambda row: -Decimal(row["gross_xaf"]))
    top.sort(key=lambda row: -Decimal(row["gross_xaf"]))

    return {
        "period": period,
        "since": since.isoformat() if since else None,
        "summary": {
            "orders_total": sum(by_status.values()),
            "orders_completed": by_status.get(MarketplaceOrderStatus.COMPLETED, 0),
            "orders_cancelled": by_status.get(MarketplaceOrderStatus.CANCELLED, 0),
            "orders_open": held["count"] or 0,
            "items_sold": totals["units"] or 0,
            "gross_sales_xaf": _money(gross),
            "platform_fees_xaf": _money(totals["fee"]),
            "net_earnings_xaf": _money(totals["net"]),
            "refunded_xaf": _money(refunded),
            "held_in_escrow_xaf": _money(held["total"]),
            "average_order_xaf": _money(gross / totals["count"]) if totals["count"] else "0",
            "wallet_balance_xaf": _money(wallet.balance_xaf) if wallet else "0",
            "listing_views": views,
            "conversion_pct": round(100 * sold_ever / views, 1) if views else None,
        },
        "series": _series(user, since, now),
        "by_category": by_category,
        "top_listings": top[:5],
        "returns": {
            "open": MarketplaceReturnRequest.objects.filter(order__listing__lister_user=user, status=ReturnStatus.REQUESTED).count(),
        },
    }


def payouts(user, since=None):
    """Orders whose payment reached the seller's wallet, newest first, one row each."""
    rows = _completed(user, since).filter(**{f"{ESCROW}__payee_amount_xaf__gt": 0}).select_related("buyer", "listing", ESCROW)
    return rows.order_by(F(f"{ESCROW}__released_at").desc(nulls_last=True), "-completed_at")


def payout_row(order) -> dict:
    escrow = order.booking.escrow
    return {
        "order_id": str(order.pk),
        "listing_id": str(order.listing_id),
        "listing_title": order.listing.title,
        "buyer_name": order.buyer.full_name or order.buyer.username,
        "quantity": order.quantity,
        "paid_at": escrow.released_at or order.completed_at,
        "gross_xaf": _money(escrow.payee_amount_xaf + escrow.platform_fee_xaf),
        "fee_xaf": _money(escrow.platform_fee_xaf),
        "refunded_xaf": _money(escrow.refunded_amount_xaf),
        "net_xaf": _money(escrow.payee_amount_xaf),
    }


CSV_COLUMNS = [
    "order_id", "created_at", "completed_at", "status", "category", "listing", "buyer", "quantity", "order_amount_xaf",
    "delivery_fee_xaf", "platform_fee_xaf", "refunded_xaf", "net_payout_xaf", "delivery_method", "courier",
    "tracking_number", "shipment_status",
]


def _cell(value) -> str:
    """Text a spreadsheet won't run as a formula (names and titles are typed by users)."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def sales_csv(user, since=None) -> str:
    rows = _orders(user).select_related(
        "buyer", "listing", "booking__escrow", *(f"listing__{relation}" for relation in CATEGORY_RELATIONS.values()),
    ).order_by("created_at")
    if since:
        rows = rows.filter(created_at__gte=since)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    for order in rows:
        escrow = getattr(order.booking, "escrow", None)
        settled = escrow is not None and escrow.status in ("RELEASED", "REFUNDED")
        category = next((name for name, relation in CATEGORY_RELATIONS.items() if getattr(order.listing, relation, None) is not None), "")
        writer.writerow([
            order.pk, timezone.localtime(order.created_at).strftime("%Y-%m-%d %H:%M"),
            timezone.localtime(order.completed_at).strftime("%Y-%m-%d %H:%M") if order.completed_at else "",
            order.status, category, _cell(order.listing.title), _cell(order.buyer.full_name or order.buyer.username),
            order.quantity, order.amount_xaf, order.delivery_fee_xaf,
            escrow.platform_fee_xaf if settled else "", escrow.refunded_amount_xaf if settled else "",
            escrow.payee_amount_xaf if settled else "", order.delivery_method, _cell(order.courier_name),
            _cell(order.tracking_number), order.shipment_status,
        ])
    return out.getvalue()
