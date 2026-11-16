"""
Coupons and flash sales for the marketplace.

* A coupon is a code a seller creates for their own shop (percentage or fixed amount off, optional minimum order,
  use limit and dates). It discounts the price of the goods in an order, never the delivery fee, and the seller bears
  it: the buyer is charged less and the platform fee is taken on what was charged. Coupons are for goods and can't be
  combined with an accepted offer.
* A flash sale is a time-limited sale price on a goods listing (see MarketplaceListingBase.current_price_xaf).

A coupon use is counted when the order is placed and given back if the payment fails or expires, so a limited coupon
can't be over-used by simultaneous checkouts.
"""
from decimal import Decimal, ROUND_DOWN

from django.db.models import F
from django.utils import timezone

from .services import OrderError

MAX_PERCENT = 90
MAX_SALE_DAYS = 30


class CouponError(OrderError):
    pass


def normalize_code(code) -> str:
    return "".join(str(code or "").split()).upper()


def whole(amount) -> Decimal:
    return Decimal(amount).quantize(Decimal("1"), rounding=ROUND_DOWN)


def find_coupon(seller_id, code):
    from .models import MarketplaceCoupon
    code = normalize_code(code)
    return MarketplaceCoupon.objects.filter(seller_id=seller_id, code=code).first() if code else None


def discount_for(coupon, subtotal, *, now=None) -> Decimal:
    """The discount this coupon gives on goods worth `subtotal`, or CouponError saying why it can't be used."""
    from .models import CouponKind
    now = now or timezone.now()
    if not coupon.is_active:
        raise CouponError("This coupon is no longer valid.")
    if coupon.starts_at and coupon.starts_at > now:
        raise CouponError("This coupon is not valid yet.")
    if coupon.expires_at and coupon.expires_at <= now:
        raise CouponError("This coupon has expired.")
    if coupon.max_uses is not None and coupon.uses >= coupon.max_uses:
        raise CouponError("This coupon has been used up.")
    subtotal = Decimal(subtotal)
    if subtotal < coupon.min_order_xaf:
        raise CouponError(f"This coupon needs an order of at least {coupon.min_order_xaf:,.0f} XAF from this seller.")
    raw = subtotal * coupon.value / 100 if coupon.kind == CouponKind.PERCENT else coupon.value
    # The buyer always pays something for the items.
    return min(whole(raw), subtotal - 1)


def checked_coupon(*, seller_id, code, buyer, subtotal, now=None):
    """(coupon, discount) for a code typed by `buyer`, or CouponError."""
    coupon = find_coupon(seller_id, code)
    if coupon is None:
        raise CouponError("That coupon code isn't valid for this seller.")
    if coupon.seller_id == buyer.id:
        raise CouponError("You can't use your own coupon.")
    return coupon, discount_for(coupon, subtotal, now=now)


def redeem(coupon) -> None:
    """Counts one use, atomically against the use limit. Call inside the order's transaction."""
    from .models import MarketplaceCoupon
    now = timezone.now()
    rows = MarketplaceCoupon.objects.filter(pk=coupon.pk, is_active=True)
    if coupon.max_uses is not None:
        rows = rows.filter(uses__lt=coupon.max_uses)
    if not rows.update(uses=F("uses") + 1):
        raise CouponError("This coupon has been used up.")


def release(order) -> None:
    """Gives a coupon use back when an order's payment failed or expired."""
    from .models import MarketplaceCoupon
    if order.coupon_id:
        MarketplaceCoupon.objects.filter(pk=order.coupon_id, uses__gt=0).update(uses=F("uses") - 1)


def split_discount(discount, amounts) -> list:
    """Shares a discount over line amounts in proportion, in whole XAF; the rounding remainder goes to the first line."""
    total = sum(amounts)
    if not total:
        return [Decimal("0")] * len(amounts)
    parts = [whole(Decimal(discount) * a / total) for a in amounts]
    parts[0] += Decimal(discount) - sum(parts)
    return parts


def validate_sale(*, price, sale_price, starts_at, ends_at, now=None):
    """Checks a flash sale's fields; returns an error message or None."""
    now = now or timezone.now()
    if sale_price is None and not (starts_at or ends_at):
        return None
    if sale_price is None or ends_at is None:
        return "Set both the sale price and when the sale ends."
    if sale_price <= 0 or sale_price >= price:
        return "The sale price must be above 0 and below the normal price."
    if ends_at <= now:
        return "The sale must end in the future."
    if starts_at and starts_at >= ends_at:
        return "The sale must start before it ends."
    if (ends_at - (starts_at or now)).days > MAX_SALE_DAYS:
        return f"A flash sale can run for at most {MAX_SALE_DAYS} days."
    return None
