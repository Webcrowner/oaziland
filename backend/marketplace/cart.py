"""
The marketplace cart. A buyer collects goods from one or more sellers and checks out one seller at a time:

* one payment per seller (one Mobile Money prompt), however many items;
* when that payment is confirmed it is split into one order, and one escrow, per item (the same idea as a rental
  deposit's split), so every item is handed over, tracked, returned, refunded, reviewed and paid out on its own;
* if the payment fails or expires, every item's stock and the coupon use are given back together.

The charge is made on the first ("lead") order's booking for the whole amount; the other orders carry placeholder
bookings until the split. Prices are never stored in the cart: it always shows what each listing costs now.
"""
from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils import timezone

from . import services
from .services import OrderError, ListingNotAvailableError

MAX_CART_ITEMS = 50
MAX_QUANTITY = 1000


def _xaf(amount) -> str:
    """Whole-XAF text for the API ("25000", not "25000.00")."""
    return str(Decimal(amount).quantize(Decimal("1")))


def _photo(listing):
    media = next((m for m in listing.media.all() if m.media_type == "PHOTO"), None)
    return media.file_url if media else None


def _line_state(item, now):
    """(available, reason) for a cart line, from the listing (and chosen version) as it is now."""
    from .engagement import is_expired
    from .shops import seller_on_vacation
    listing = item.listing
    if listing.removed_by_moderation or listing.availability_status != "AVAILABLE" or is_expired(listing):
        return False, "No longer available"
    if seller_on_vacation(listing.lister_user_id):
        return False, "The shop is on vacation"
    if item.variant_id is None and listing.has_variants():
        return False, "Choose an option"
    stock = listing.quantity
    if item.variant_id is not None:
        if not item.variant.is_active:
            return False, "This option is no longer available"
        stock = item.variant.quantity
    if stock < 1:
        return False, "Sold out"
    if item.quantity > stock:
        return False, f"Only {stock} left"
    return True, ""


def _unit_price(item, now):
    unit = item.listing.current_price_xaf(now)
    return unit + item.variant.price_delta_xaf if item.variant_id is not None else unit


def _delivery_options(listings):
    """The delivery methods every listed item offers, each with the highest fee among them (charged once)."""
    from .models import DeliveryMethod
    options = []
    for method, flag, fee in (
        (DeliveryMethod.PICKUP, "pickup_available", None),
        (DeliveryMethod.SELLER, "seller_delivery", "seller_delivery_fee_xaf"),
        (DeliveryMethod.COURIER, "courier_shipping", "courier_fee_xaf"),
    ):
        if all(getattr(listing, flag) for listing in listings):
            options.append({"method": method, "fee_xaf": _xaf(max((getattr(l, fee) for l in listings), default=Decimal("0")) if fee else Decimal("0"))})
    return options


def cart_for(user) -> dict:
    from .models import CartItem
    now = timezone.now()
    items = list(
        CartItem.objects.filter(user=user).select_related("listing__lister_user", "listing__quarter", "variant")
        .prefetch_related("listing__media", "listing__variants").order_by("added_at")
    )
    groups = {}
    for item in items:
        listing = item.listing
        available, reason = _line_state(item, now)
        unit = _unit_price(item, now)
        group = groups.setdefault(str(listing.lister_user_id), {
            "seller_id": str(listing.lister_user_id), "seller_name": listing.lister_user.full_name or listing.lister_user.username,
            "items": [], "_listings": [],
        })
        group["_listings"].append(listing)
        variant = item.variant
        group["items"].append({
            "listing_id": str(listing.pk), "title": listing.title, "photo_url": (variant.photo_url if variant and variant.photo_url else _photo(listing)),
            "variant_id": str(variant.pk) if variant else None, "variant_label": variant.label if variant else "",
            "unit_price_xaf": _xaf(unit), "list_price_xaf": _xaf(listing.price_xaf + (variant.price_delta_xaf if variant else 0)),
            "on_sale": listing.on_sale(now),
            "compare_at_price_xaf": _xaf(listing.compare_at_price_xaf + (variant.price_delta_xaf if variant else 0)) if listing.compare_at_price_xaf else None,
            "sale_ends_at": listing.sale_ends_at, "quantity": item.quantity, "stock": variant.quantity if variant else listing.quantity,
            "available": available, "reason": reason, "line_total_xaf": _xaf(unit * item.quantity),
            "allow_offers": False,
        })
    out = []
    for group in groups.values():
        listings = group.pop("_listings")
        buyable = [i for i in group["items"] if i["available"]]
        group["subtotal_xaf"] = _xaf(sum((Decimal(i["line_total_xaf"]) for i in buyable), Decimal("0")))
        group["delivery_options"] = _delivery_options(listings)
        group["can_checkout"] = bool(buyable) and len(buyable) == len(group["items"])
        out.append(group)
    return {"groups": out, "item_count": len(items)}


def set_item(*, user, listing, quantity: int, variant_id=None):
    from .models import CartItem, GoodsListing
    from .shops import ensure_not_on_vacation
    from .variants import resolve_variant
    if not isinstance(listing, GoodsListing):
        raise OrderError("Only goods can be added to the cart.")
    if listing.lister_user_id == user.id:
        raise OrderError("You can't buy your own listing.")
    try:
        quantity = int(quantity)
    except (TypeError, ValueError):
        raise OrderError("Choose how many you want.")
    if not 1 <= quantity <= MAX_QUANTITY:
        raise OrderError("Choose how many you want.")
    ensure_not_on_vacation(listing.lister_user_id)
    variant = resolve_variant(listing, variant_id)
    stock = variant.quantity if variant is not None else listing.quantity
    if listing.removed_by_moderation or listing.availability_status != "AVAILABLE" or stock < 1:
        raise ListingNotAvailableError("This listing is not available right now.")
    quantity = min(quantity, stock)
    item = CartItem.objects.filter(user=user, listing=listing, variant=variant).first()
    if item is None:
        if CartItem.objects.filter(user=user).count() >= MAX_CART_ITEMS:
            raise OrderError(f"Your cart can hold at most {MAX_CART_ITEMS} items.")
        item = CartItem.objects.create(user=user, listing=listing, variant=variant, quantity=quantity)
    else:
        item.quantity = quantity
        item.save(update_fields=["quantity"])
    return item


def remove_item(*, user, listing_id, variant_id=None) -> bool:
    from .models import CartItem
    deleted, _ = CartItem.objects.filter(user=user, listing_id=listing_id, variant_id=variant_id or None).delete()
    return bool(deleted)


def _group_items(buyer, seller_id):
    from .models import CartItem
    items = list(
        CartItem.objects.filter(user=buyer, listing__lister_user_id=seller_id).select_related("listing", "variant")
        .prefetch_related("listing__variants").order_by("listing_id", "added_at")
    )
    if not items:
        raise OrderError("Your cart has nothing from this seller.")
    return items


def _group_delivery(items, delivery: dict):
    choices = [services._goods_delivery(item.listing, delivery) for item in items]
    methods = {c[0] for c in choices}
    if len(methods) != 1:
        raise OrderError("Choose a delivery option that every item offers.")
    return choices[0][0], max(c[1] for c in choices), choices[0][2]


def _check_cumulative_stock(items):
    """Several versions of one item can be in the cart: together they must fit the stock of the item and of each version."""
    wanted_listing, wanted_variant = {}, {}
    for item in items:
        wanted_listing[item.listing_id] = wanted_listing.get(item.listing_id, 0) + item.quantity
        if item.variant_id is not None:
            wanted_variant[item.variant_id] = wanted_variant.get(item.variant_id, 0) + item.quantity
    for item in items:
        if wanted_listing[item.listing_id] > item.listing.quantity:
            raise ListingNotAvailableError(f"Only {item.listing.quantity} of \"{item.listing.title}\" left. Lower the quantity.")
        if item.variant_id is not None and wanted_variant[item.variant_id] > item.variant.quantity:
            raise ListingNotAvailableError(f"Only {item.variant.quantity} left in \"{item.variant.label}\". Lower the quantity.")


def quote_group(*, buyer, seller_id, delivery: dict, coupon_code: str = "") -> dict:
    """The amounts a checkout with this seller would charge, or an OrderError saying what is wrong."""
    from .promotions import checked_coupon, CouponError
    items = _group_items(buyer, seller_id)
    now = timezone.now()
    for item in items:
        available, reason = _line_state(item, now)
        if not available:
            raise ListingNotAvailableError(f"\"{item.listing.title}\": {reason}.")
    method, fee, _ = _group_delivery(items, delivery)
    subtotal = sum((_unit_price(item, now) * item.quantity for item in items), Decimal("0"))
    _check_cumulative_stock(items)
    discount, coupon_message = Decimal("0"), ""
    if coupon_code:
        try:
            _, discount = checked_coupon(seller_id=seller_id, code=coupon_code, buyer=buyer, subtotal=subtotal, now=now)
        except CouponError as e:
            coupon_message = str(e)
    return {
        "subtotal_xaf": _xaf(subtotal), "discount_xaf": _xaf(discount), "delivery_fee_xaf": _xaf(fee),
        "total_xaf": _xaf(subtotal - discount + fee), "delivery_method": method, "coupon_error": coupon_message,
    }


def place_cart_checkout(*, buyer, seller_id, payment_gateway, phone_number: str, delivery: dict, coupon_code: str = ""):
    """Charges once for everything the buyer has from one seller and creates one order per item. Returns the orders."""
    import uuid
    from transactions.locks import get_booking_lock_client
    from transactions.models import Booking, BookingStatus, BookingType
    from transactions.services import HOLD_TTL_SECONDS, initiate_booking_payment, fail_payment
    from .engagement import expiry_cutoff
    from .models import (
        CartItem, GoodsListing, GoodsVariant, MarketplaceCheckout, MarketplaceOrder, MarketplaceOrderStatus, AvailabilityStatus,
    )
    from .offers import reserving_offer, _has_live_order
    from .promotions import checked_coupon, redeem, split_discount
    from .shops import ensure_not_on_vacation

    if str(seller_id) == str(buyer.id):
        raise OrderError("You can't buy your own listing.")
    ensure_not_on_vacation(seller_id)
    items = _group_items(buyer, seller_id)
    method, fee, address = _group_delivery(items, delivery)
    now = timezone.now()

    with db_transaction.atomic():
        stocks = {
            s.pk: s for s in GoodsListing.objects.select_for_update().filter(pk__in=[i.listing_id for i in items]).order_by("pk")
        }
        variants = {
            v.pk: v for v in GoodsVariant.objects.select_for_update().filter(pk__in=[i.variant_id for i in items if i.variant_id]).order_by("pk")
        }
        lines = []
        taken_listing, taken_variant = {}, {}
        for item in items:
            stock = stocks.get(item.listing_id)
            variant = variants.get(item.variant_id) if item.variant_id else None
            title = item.listing.title
            if (
                stock is None or stock.removed_by_moderation or stock.availability_status != AvailabilityStatus.AVAILABLE
                or stock.renewed_at < expiry_cutoff() or stock.quantity < 1
            ):
                raise ListingNotAvailableError(f"\"{title}\" is no longer available. Remove it from your cart to continue.")
            if item.variant_id and (variant is None or not variant.is_active):
                raise ListingNotAvailableError(f"The option you chose for \"{title}\" is no longer available. Remove it from your cart to continue.")
            if variant is None and stock.has_variants():
                raise ListingNotAvailableError(f"Choose an option for \"{title}\" to continue.")
            holder = reserving_offer(stock)
            held = 1 if holder is not None and holder.buyer_id != buyer.id and not _has_live_order(holder) else 0
            taken_listing[stock.pk] = taken_listing.get(stock.pk, 0) + item.quantity
            if stock.quantity - held < taken_listing[stock.pk]:
                raise ListingNotAvailableError(f"Only {max(stock.quantity - held, 0)} of \"{title}\" left. Lower the quantity.")
            unit = stock.current_price_xaf(now)
            if variant is not None:
                taken_variant[variant.pk] = taken_variant.get(variant.pk, 0) + item.quantity
                if variant.quantity < taken_variant[variant.pk]:
                    raise ListingNotAvailableError(f"Only {variant.quantity} left in \"{variant.label}\". Lower the quantity.")
                unit += variant.price_delta_xaf
            lines.append((item, stock, variant, unit, unit * item.quantity))
        prices = [line[4] for line in lines]
        subtotal = sum(prices, Decimal("0"))
        coupon, discount = None, Decimal("0")
        if coupon_code:
            coupon, discount = checked_coupon(seller_id=seller_id, code=coupon_code, buyer=buyer, subtotal=subtotal, now=now)
            redeem(coupon)
        discounts = split_discount(discount, prices)
        amounts = [p - d for p, d in zip(prices, discounts)]
        amounts[0] += fee
        total = sum(amounts, Decimal("0"))

        checkout = MarketplaceCheckout.objects.create(buyer=buyer, seller_id=seller_id, total_xaf=total)
        hold = now + timezone.timedelta(seconds=HOLD_TTL_SECONDS)
        lead_key = str(uuid.uuid4())
        orders = []
        for index, ((item, stock, variant, unit, price), discount_i, amount) in enumerate(zip(lines, discounts, amounts)):
            stock.quantity -= item.quantity
            fields = ["quantity"]
            if stock.quantity == 0:
                stock.availability_status = AvailabilityStatus.UNDER_OFFER
                fields.append("availability_status")
            stock.save(update_fields=fields)
            if variant is not None:
                variant.quantity -= item.quantity
                variant.save(update_fields=["quantity"])
            booking = Booking.objects.create(
                booking_type=BookingType.MARKETPLACE_ITEM, target_content_type="marketplace.GoodsListing", target_id=stock.pk,
                requester=buyer, status=BookingStatus.PENDING, amount_xaf=total if index == 0 else amount,
                idempotency_key=lead_key if index == 0 else f"{lead_key}-line-{index}", hold_expires_at=hold,
            )
            line_fee = fee if index == 0 else Decimal("0")
            breakdown = {
                "stock": True, "unit_price_xaf": str(unit), "quantity": item.quantity, "price_xaf": str(price),
                "delivery_fee_xaf": str(line_fee), "cart": True,
            }
            if variant is not None:
                breakdown.update(variant_label=variant.label, sku=variant.sku)
            if coupon is not None:
                breakdown.update(discount_xaf=str(discount_i), coupon_code=coupon.code)
            orders.append(MarketplaceOrder.objects.create(
                listing=stock, buyer=buyer, booking=booking, amount_xaf=amount, status=MarketplaceOrderStatus.PAYMENT_PENDING,
                delivery_method=method, delivery_fee_xaf=line_fee, delivery_address=address, quantity=item.quantity,
                stock_taken=item.quantity, price_breakdown=breakdown, coupon=coupon, discount_xaf=discount_i,
                checkout=checkout, checkout_lead=index == 0, variant=variant, variant_label=variant.label if variant else "",
            ))
    lead = orders[0]
    try:
        debit = initiate_booking_payment(booking=lead.booking, payment_gateway=payment_gateway, phone_number=phone_number)
    except Exception:
        fail_payment(lock_client=get_booking_lock_client(), booking=lead.booking)
        services.fail_marketplace_order_payment(booking=lead.booking)
        raise
    if not debit.success:
        fail_payment(lock_client=get_booking_lock_client(), booking=lead.booking)
        services.fail_marketplace_order_payment(booking=lead.booking)
        raise services.OrderPaymentFailedError("The payment could not be completed. Please try again.")
    CartItem.objects.filter(user=buyer, pk__in=[i.pk for i in items]).delete()
    return orders


def split_checkout(lead):
    """Called once the lead order's payment is confirmed (inside its transaction): the escrow made for the whole charge
    is cut down to the lead item, and every other item gets its own booking confirmation and escrow."""
    from monetization.models import PlatformFeePolicy, TransactionCategory
    from transactions.models import EscrowStatus, PaymentEscrow
    from .models import MarketplaceOrder, MarketplaceOrderStatus

    escrow = lead.booking.escrow
    fee = PlatformFeePolicy.fee_for(TransactionCategory.MARKETPLACE_SALE, lead.amount_xaf)
    escrow.gross_amount_xaf, escrow.platform_fee_xaf, escrow.payee_amount_xaf = lead.amount_xaf, fee, lead.amount_xaf - fee
    escrow.save(update_fields=["gross_amount_xaf", "platform_fee_xaf", "payee_amount_xaf"])
    siblings = list(lead.checkout.orders.filter(checkout_lead=False, status=MarketplaceOrderStatus.PAYMENT_PENDING).select_related("booking", "listing__lister_user", "buyer"))
    for index, order in enumerate(siblings, start=1):
        fee = PlatformFeePolicy.fee_for(TransactionCategory.MARKETPLACE_SALE, order.amount_xaf)
        order.booking.confirm()
        PaymentEscrow.objects.create(
            booking=order.booking, gross_amount_xaf=order.amount_xaf, platform_fee_xaf=fee, payee_amount_xaf=order.amount_xaf - fee,
            status=EscrowStatus.HELD, provider=escrow.provider, provider_reference=f"{escrow.provider_reference}-LINE{index}",
        )
        MarketplaceOrder.objects.filter(pk=order.pk).update(status=MarketplaceOrderStatus.PAID)
    return siblings


def cancel_checkout_siblings(lead):
    """Called when the lead order's payment failed: the other items of the cart checkout are cancelled with it."""
    from .models import AvailabilityStatus, MarketplaceOrder, MarketplaceOrderStatus
    for order in lead.checkout.orders.filter(checkout_lead=False, status=MarketplaceOrderStatus.PAYMENT_PENDING).select_related("booking"):
        if MarketplaceOrder.objects.filter(pk=order.pk, status=MarketplaceOrderStatus.PAYMENT_PENDING).update(status=MarketplaceOrderStatus.CANCELLED):
            services._set_order_listing_status(order, AvailabilityStatus.AVAILABLE)
            order.booking.fail_payment()
