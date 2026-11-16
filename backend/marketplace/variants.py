"""
Product variants for goods (Red / XL): each has its own stock, an optional price difference and a SKU.

A listing with live variants keeps `quantity` equal to the sum of their stock, so browsing, sold-out handling and
returning stock keep working; every sale and every give-back touches both. The seller edits the whole set at once
(replace_variants), buyers choose a variant at checkout, and offers aren't available on listings with options.
"""
import re
import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction as db_transaction
from django.db.models import Sum

from .services import OrderError

MAX_VARIANTS = 60
MAX_OPTION_NAMES = 3
MAX_STOCK = 100000


class VariantError(Exception):
    """Invalid variant data; `errors` is a list of {index?, field, message} for the API."""

    def __init__(self, errors):
        super().__init__(errors[0]["message"] if errors else "Invalid variants.")
        self.errors = errors


def _slug(text: str, size: int) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())[:size] or "ITEM"


def live_stock(listing) -> int:
    from .models import GoodsVariant
    return GoodsVariant.objects.filter(listing=listing, is_active=True).aggregate(total=Sum("quantity"))["total"] or 0


def sync_listing_quantity(listing_id) -> int:
    """Makes the listing's stock the sum of its live variants and puts a restocked, sold-out listing back on sale."""
    from .models import AvailabilityStatus, GoodsListing, GoodsVariant
    total = GoodsVariant.objects.filter(listing_id=listing_id, is_active=True).aggregate(total=Sum("quantity"))["total"] or 0
    listing = GoodsListing.objects.select_for_update().get(pk=listing_id)
    was_sold_out = listing.quantity == 0
    listing.quantity = total
    fields = ["quantity"]
    if was_sold_out and total > 0 and not listing.removed_by_moderation and listing.availability_status != AvailabilityStatus.AVAILABLE:
        listing.availability_status = AvailabilityStatus.AVAILABLE
        fields.append("availability_status")
    listing.save(update_fields=fields)
    return total


def _clean(listing, rows):
    """Validated variant dicts, or VariantError."""
    errors = []
    if not isinstance(rows, list):
        raise VariantError([{"field": "variants", "message": "Send a list of variants."}])
    if len(rows) > MAX_VARIANTS:
        raise VariantError([{"field": "variants", "message": f"A listing can have at most {MAX_VARIANTS} variants."}])
    names_seen, cleaned, labels, skus = None, [], set(), set()
    for index, row in enumerate(rows):
        def problem(field, message):
            errors.append({"index": index, "field": field, "message": message})

        if not isinstance(row, dict):
            problem("variants", "Each variant must be an object.")
            continue
        options = row.get("options")
        if not isinstance(options, dict) or not 1 <= len(options) <= MAX_OPTION_NAMES:
            problem("options", f"Give 1 to {MAX_OPTION_NAMES} options, like Color and Size.")
            continue
        options = {str(k).strip(): str(v).strip() for k, v in options.items()}
        if any(not k or not v or len(k) > 30 or len(v) > 40 for k, v in options.items()):
            problem("options", "Option names and values can't be empty (30 and 40 characters at most).")
            continue
        names = list(options)
        if names_seen is None:
            names_seen = names
        elif names != names_seen:
            problem("options", "Every variant must use the same options in the same order.")
            continue
        label = " / ".join(options.values())
        if label.lower() in labels:
            problem("options", f"\"{label}\" appears twice.")
            continue
        labels.add(label.lower())
        try:
            delta = Decimal(str(row.get("price_delta_xaf") or 0)).quantize(Decimal("1"))
            stock = int(row.get("quantity", 0))
        except (InvalidOperation, ValueError, TypeError):
            problem("quantity", "Enter whole numbers for stock and the price difference.")
            continue
        if not 0 <= stock <= MAX_STOCK:
            problem("quantity", f"Stock must be between 0 and {MAX_STOCK}.")
            continue
        if listing.price_xaf + delta <= 0 or (listing.sale_price_xaf is not None and listing.sale_price_xaf + delta <= 0):
            problem("price_delta_xaf", "The price difference would make this version free or negative.")
            continue
        sku = str(row.get("sku") or "").strip().upper()
        if sku:
            if len(sku) > 40 or sku in skus:
                problem("sku", "SKUs must be unique and at most 40 characters.")
                continue
            skus.add(sku)
        cleaned.append({
            "id": row.get("id"), "options": options, "label": label, "sku": sku, "price_delta_xaf": delta, "quantity": stock,
            "photo_url": str(row.get("photo_url") or "")[:500], "is_active": bool(row.get("is_active", True)), "position": index,
        })
    if errors:
        raise VariantError(errors)
    return cleaned


def replace_variants(listing, rows):
    """Makes the listing's variants exactly `rows` (matched by id; new ones are created, missing ones removed) and
    refreshes the listing's stock."""
    from .models import GoodsVariant
    cleaned = _clean(listing, rows)
    with db_transaction.atomic():
        # Same lock order as a sale (the listing, then its variants), so the two can't deadlock.
        from .models import GoodsListing
        GoodsListing.objects.select_for_update().get(pk=listing.pk)
        existing = {str(v.pk): v for v in GoodsVariant.objects.select_for_update().filter(listing=listing)}
        keep = set()
        for item in cleaned:
            variant = existing.get(str(item["id"])) if item["id"] else None
            if variant is None:
                variant = GoodsVariant(listing=listing)
            for field in ("options", "label", "price_delta_xaf", "quantity", "photo_url", "is_active", "position"):
                setattr(variant, field, item[field])
            variant.sku = item["sku"] or variant.sku or f"{_slug(listing.title, 5)}-{uuid.uuid4().hex[:5].upper()}"
            keep.add(str(variant.pk))
            variant.save()
        GoodsVariant.objects.filter(listing=listing).exclude(pk__in=keep).delete()
        if cleaned:
            sync_listing_quantity(listing.pk)
    return list(GoodsVariant.objects.filter(listing=listing))


def public_variant(variant, listing, now=None) -> dict:
    return {
        "id": str(variant.pk), "label": variant.label, "options": variant.options, "sku": variant.sku,
        "price_xaf": str(variant.unit_price_xaf(now).quantize(Decimal("1"))), "price_delta_xaf": str(variant.price_delta_xaf.quantize(Decimal("1"))),
        "quantity": variant.quantity, "available": variant.is_active and variant.quantity > 0, "photo_url": variant.photo_url,
        "is_active": variant.is_active,
    }


def price_from(listing, now=None):
    """The lowest price among the variants in stock ("From 5 000 XAF"), or None when there are none."""
    prices = [v.unit_price_xaf(now) for v in listing.live_variants() if v.quantity > 0]
    return min(prices) if prices else None


def resolve_variant(listing, variant_id):
    """The chosen live variant of a goods listing (None for a listing without options), or OrderError."""
    live = {str(v.pk): v for v in listing.live_variants()}
    if not live:
        if variant_id:
            raise OrderError("This item has no options to choose from.")
        return None
    if not variant_id:
        raise OrderError("Choose an option (like size or colour) first.")
    variant = live.get(str(variant_id))
    if variant is None:
        raise OrderError("That option isn't available any more.")
    return variant
