"""
Where a notification leads when tapped, worked out on the server so web and mobile agree.

A target is {"kind": ..., "id": ..., plus extras} or None when there is nothing sensible to open. Clients map the kind
to one of their own pages. Targets are resolved for a whole page of notifications at once (a fixed number of queries).

Kinds: marketplace_order (role buying|selling), marketplace_offer (role), marketplace_listing (category),
listing (a property listing), ride.
"""
import uuid

MARKETPLACE_LISTING_TYPES = {"SAVED_SEARCH_MATCH", "PRICE_DROP", "LISTING_EXPIRING", "SHOP_NEW_LISTING", "FLASH_SALE", "LOW_STOCK"}
PROPERTY_LISTING_TYPES = {"SAVED_SEARCH_MATCH", "LISTING_EXPIRING_7D", "LISTING_EXPIRING_1D", "LISTING_EXPIRED", "PRICE_DROP"}
RIDE_PREFIX = "RIDE_"


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def resolve_targets(notifications, user) -> dict:
    """{notification id: target} for the notifications that lead somewhere."""
    from marketplace.models import MarketplaceListingBase, MarketplaceOffer, MarketplaceOrder
    from marketplace.offers import category_of
    from property.models import Listing

    rows = [(n, _uuid(n.related_reference)) for n in notifications if n.related_reference]
    rows = [(n, ref) for n, ref in rows if ref is not None]
    if not rows:
        return {}

    def refs(types=None, prefix=None):
        return {ref for n, ref in rows if (types and n.notification_type in types) or (prefix and n.notification_type.startswith(prefix))}

    orders = {
        o.pk: o for o in MarketplaceOrder.objects.filter(pk__in=refs({"MARKETPLACE_ORDER"})).select_related("listing")
    }
    offers = {
        o.pk: o for o in MarketplaceOffer.objects.filter(pk__in=refs({"MARKETPLACE_OFFER"})).select_related("listing")
    }
    market_ids = refs(MARKETPLACE_LISTING_TYPES)
    market = {
        listing.pk: category_of(listing)
        for listing in MarketplaceListingBase.objects.filter(pk__in=market_ids).select_related(
            "warehouselisting", "storelisting", "businesslisting", "carlisting", "goodslisting",
        )
    }
    property_ids = refs(PROPERTY_LISTING_TYPES) - set(market)
    properties = set(Listing.objects.filter(pk__in=property_ids).values_list("pk", flat=True))

    targets = {}
    for notification, ref in rows:
        kind = notification.notification_type
        target = None
        if kind == "MARKETPLACE_ORDER" and ref in orders:
            order = orders[ref]
            target = {"kind": "marketplace_order", "id": str(ref), "role": "selling" if order.listing.lister_user_id == user.id else "buying"}
        elif kind == "MARKETPLACE_OFFER" and ref in offers:
            offer = offers[ref]
            target = {"kind": "marketplace_offer", "id": str(ref), "role": "selling" if offer.listing.lister_user_id == user.id else "buying"}
        elif kind in MARKETPLACE_LISTING_TYPES and market.get(ref):
            target = {"kind": "marketplace_listing", "id": str(ref), "category": market[ref]}
        elif kind in PROPERTY_LISTING_TYPES and ref in properties:
            target = {"kind": "listing", "id": str(ref)}
        elif kind.startswith(RIDE_PREFIX):
            target = {"kind": "ride", "id": str(ref)}
        if target:
            targets[notification.pk] = target
    return targets
