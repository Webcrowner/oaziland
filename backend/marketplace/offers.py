"""
"Make an offer", the way Leboncoin and Facebook Marketplace work: the buyer proposes a price, the seller accepts,
declines or counters, and once a price is agreed the buyer has PAY_WINDOW_HOURS to pay exactly that price through
escrow. Meanwhile the item is reserved for them (except a car rented by the day, where the agreed price is the daily
rate and other renters can still book other dates). Unanswered offers lapse after RESPONSE_WINDOW_HOURS.
"""
from datetime import timedelta
from decimal import Decimal

PAY_WINDOW_HOURS = 24
RESPONSE_WINDOW_HOURS = 48
# Offers below this share of the asking price are refused outright, to spare sellers from lowball spam.
MIN_OFFER_SHARE = Decimal("0.3")
OPEN_STATUSES = ("PENDING", "COUNTERED", "ACCEPTED")


class OfferError(Exception):
    pass


def category_of(listing) -> str:
    for name, relation in (
        ("warehouses", "warehouselisting"), ("stores", "storelisting"), ("businesses", "businesslisting"),
        ("cars", "carlisting"), ("goods", "goodslisting"),
    ):
        if getattr(listing, relation, None) is not None:
            return name
    return ""


def _notify(recipient, title, message, offer):
    from notifications.services import notify
    notify(recipient=recipient, notification_type="MARKETPLACE_OFFER", title=title, message=message, related_reference=str(offer.id))


def _xaf(amount) -> str:
    return f"{Decimal(amount):,.0f} XAF"


def _is_dated(listing) -> bool:
    from .car_rentals import is_dated_car_rental, as_car
    car = as_car(listing)
    return car is not None and is_dated_car_rental(car)


def respond_by(offer):
    """When an unanswered offer (or counter-offer) lapses."""
    if offer.status not in ("PENDING", "COUNTERED"):
        return None
    return (offer.responded_at or offer.created_at) + timedelta(hours=RESPONSE_WINDOW_HOURS)


def reserving_offer(listing, *, now=None):
    """The accepted, not-yet-paid offer currently holding this listing for one buyer, if any."""
    from django.utils import timezone
    from .models import MarketplaceOffer, OfferStatus
    if _is_dated(listing):
        return None
    return MarketplaceOffer.objects.filter(
        listing_id=listing.pk, status=OfferStatus.ACCEPTED, pay_by__gt=now or timezone.now(),
    ).first()


def make_offer(*, listing, buyer, amount_xaf: Decimal, message: str = ""):
    from django.db import transaction as db_transaction
    from .engagement import is_expired
    from .models import MarketplaceOffer, AvailabilityStatus
    if listing.lister_user_id == buyer.id:
        raise OfferError("You can't make an offer on your own listing.")
    if listing.removed_by_moderation or listing.availability_status != AvailabilityStatus.AVAILABLE or is_expired(listing):
        raise OfferError("This listing isn't available any more.")
    if not listing.allow_offers:
        raise OfferError("The seller isn't taking offers on this listing.")
    if listing.on_sale():
        raise OfferError("This item is on a flash sale: buy it at the sale price.")
    if hasattr(listing, "has_variants") and listing.has_variants():
        raise OfferError("Offers aren't available on items with options (size, colour...): buy the version you want.")
    from .shops import ensure_not_on_vacation, ShopOnVacationError
    try:
        ensure_not_on_vacation(listing.lister_user_id)
    except ShopOnVacationError as e:
        raise OfferError(str(e))
    if amount_xaf >= listing.price_xaf:
        raise OfferError("Your offer is at or above the asking price: just buy or book it at that price.")
    if amount_xaf < (listing.price_xaf * MIN_OFFER_SHARE).quantize(Decimal("1")):
        raise OfferError(f"Offers must be at least {int(MIN_OFFER_SHARE * 100)}% of the asking price.")
    with db_transaction.atomic():
        if MarketplaceOffer.objects.select_for_update().filter(listing_id=listing.pk, buyer=buyer, status__in=OPEN_STATUSES).exists():
            raise OfferError("You already have an open offer on this listing. Withdraw it to make a new one.")
        offer = MarketplaceOffer.objects.create(listing=listing, buyer=buyer, amount_xaf=amount_xaf, message=message.strip())
    _notify(
        listing.lister_user, "New offer on your listing",
        f"{buyer.full_name or buyer.username} offers {_xaf(amount_xaf)} for \"{listing.title}\" "
        f"(asking {_xaf(listing.price_xaf)}). Accept, decline or counter within {RESPONSE_WINDOW_HOURS} hours.",
        offer,
    )
    return offer


def _require(offer, user, side: str):
    if side == "seller" and offer.listing.lister_user_id != user.id:
        raise PermissionError("Only the seller can do this.")
    if side == "buyer" and offer.buyer_id != user.id:
        raise PermissionError("Only the buyer who made the offer can do this.")


_STATE_FIELDS = ("status", "counter_amount_xaf", "responded_at", "accepted_at", "pay_by")


def _sync_locked(offer, locked=None):
    """Reloads the offer's state from a row locked FOR UPDATE (call inside a transaction), so a status check made
    after this can't be overtaken by a concurrent request changing the same offer."""
    from .models import MarketplaceOffer
    if locked is None:
        locked = MarketplaceOffer.objects.select_for_update().get(pk=offer.pk)
    for field in _STATE_FIELDS:
        setattr(offer, field, getattr(locked, field))
    return offer


def _accept(offer, now, expected_status: str, error: str):
    from django.db import transaction as db_transaction
    from .models import MarketplaceOffer, OfferStatus
    with db_transaction.atomic():
        # Locking the listing's offers stops two offers being accepted at the same moment.
        locked = {o.pk: o for o in MarketplaceOffer.objects.select_for_update().filter(listing_id=offer.listing_id).order_by("pk")}
        _sync_locked(offer, locked[offer.pk])
        if offer.status != expected_status:
            raise OfferError(error)
        other = reserving_offer(offer.listing, now=now)
        if other is not None and other.pk != offer.pk:
            raise OfferError(f"Another offer is already accepted on this item until {other.pay_by:%d %b %H:%M}.")
        offer.status = OfferStatus.ACCEPTED
        offer.accepted_at = offer.responded_at = now
        offer.pay_by = now + timedelta(hours=PAY_WINDOW_HOURS)
        offer.save(update_fields=["status", "accepted_at", "responded_at", "pay_by"])
    return offer


def accept_offer(*, offer, seller):
    from django.utils import timezone
    _require(offer, seller, "seller")
    _accept(offer, timezone.now(), "PENDING", "Only an offer waiting for your answer can be accepted.")
    _notify(
        offer.buyer, "Your offer was accepted",
        f"The seller accepted {_xaf(offer.agreed_amount_xaf)} for \"{offer.listing.title}\". Pay within {PAY_WINDOW_HOURS} hours "
        "to secure it; it's reserved for you until then.",
        offer,
    )
    return offer


def counter_offer(*, offer, seller, amount_xaf: Decimal):
    from django.db import transaction as db_transaction
    from django.utils import timezone
    _require(offer, seller, "seller")
    if not offer.amount_xaf < amount_xaf < offer.listing.price_xaf:
        raise OfferError(f"A counter-offer must be between the buyer's {_xaf(offer.amount_xaf)} and your asking {_xaf(offer.listing.price_xaf)}.")
    with db_transaction.atomic():
        _sync_locked(offer)
        if offer.status != "PENDING":
            raise OfferError("You can only counter an offer that's waiting for your answer.")
        offer.status, offer.counter_amount_xaf, offer.responded_at = "COUNTERED", amount_xaf, timezone.now()
        offer.save(update_fields=["status", "counter_amount_xaf", "responded_at"])
    _notify(
        offer.buyer, "The seller made a counter-offer",
        f"The seller of \"{offer.listing.title}\" would accept {_xaf(amount_xaf)} (you offered {_xaf(offer.amount_xaf)}). "
        f"Accept or decline within {RESPONSE_WINDOW_HOURS} hours.",
        offer,
    )
    return offer


def accept_counter(*, offer, buyer):
    from django.utils import timezone
    _require(offer, buyer, "buyer")
    _accept(offer, timezone.now(), "COUNTERED", "There is no counter-offer to accept.")
    _notify(
        offer.listing.lister_user, "Your counter-offer was accepted",
        f"The buyer accepted {_xaf(offer.agreed_amount_xaf)} for \"{offer.listing.title}\" and has {PAY_WINDOW_HOURS} hours to pay.",
        offer,
    )
    return offer


def decline_offer(*, offer, seller):
    from django.db import transaction as db_transaction
    from django.utils import timezone
    _require(offer, seller, "seller")
    with db_transaction.atomic():
        _sync_locked(offer)
        if offer.status not in ("PENDING", "COUNTERED"):
            raise OfferError("This offer can no longer be declined.")
        offer.status, offer.responded_at = "DECLINED", timezone.now()
        offer.save(update_fields=["status", "responded_at"])
    _notify(offer.buyer, "Your offer was declined", f"The seller declined your offer of {_xaf(offer.amount_xaf)} for \"{offer.listing.title}\".", offer)
    return offer


def _has_live_order(offer) -> bool:
    from .models import MarketplaceOrderStatus
    return offer.orders.exclude(status=MarketplaceOrderStatus.CANCELLED).exists()


def withdraw_offer(*, offer, buyer):
    """The buyer takes back an offer (or turns down a counter-offer, or gives up an accepted price before paying)."""
    from django.db import transaction as db_transaction
    from django.utils import timezone
    _require(offer, buyer, "buyer")
    with db_transaction.atomic():
        _sync_locked(offer)
        if offer.status not in OPEN_STATUSES or (offer.status == "ACCEPTED" and _has_live_order(offer)):
            raise OfferError("This offer can no longer be withdrawn.")
        offer.status, offer.responded_at = "WITHDRAWN", timezone.now()
        offer.save(update_fields=["status", "responded_at"])
    _notify(offer.listing.lister_user, "An offer was withdrawn", f"The buyer withdrew their offer on \"{offer.listing.title}\".", offer)
    return offer


def offer_for_checkout(*, offer_id, listing, buyer, now=None):
    """The accepted offer a buyer is paying with, checked: theirs, on this listing, still within the pay window and
    not already being paid."""
    from django.utils import timezone
    from .models import MarketplaceOffer, OfferStatus
    offer = MarketplaceOffer.objects.filter(pk=offer_id, listing_id=listing.pk, buyer=buyer).first()
    if offer is None or offer.status != OfferStatus.ACCEPTED:
        raise OfferError("That offer can't be used to pay for this listing.")
    if offer.pay_by <= (now or timezone.now()):
        raise OfferError("The time to pay at the agreed price has run out.")
    if _has_live_order(offer):
        raise OfferError("You're already paying for this offer.")
    return offer


def expire_offers(now=None) -> list:
    """Scheduled sweep: unanswered offers and counter-offers lapse after RESPONSE_WINDOW_HOURS, accepted offers that
    weren't paid lapse at their pay_by (freeing the item)."""
    from django.db.models import Q
    from django.utils import timezone
    from .models import MarketplaceOffer, OfferStatus
    now = now or timezone.now()
    cutoff = now - timedelta(hours=RESPONSE_WINDOW_HOURS)
    candidates = MarketplaceOffer.objects.filter(
        Q(status__in=(OfferStatus.PENDING, OfferStatus.COUNTERED)) | Q(status=OfferStatus.ACCEPTED, pay_by__lte=now),
    ).select_related("listing__lister_user", "buyer")
    expired = []
    for offer in candidates:
        if offer.status != OfferStatus.ACCEPTED and (offer.responded_at or offer.created_at) > cutoff:
            continue
        if offer.status == OfferStatus.ACCEPTED and _has_live_order(offer):
            continue
        # Conditional update: skip the offer if a buyer/seller changed it since this sweep read it.
        if not MarketplaceOffer.objects.filter(pk=offer.pk, status=offer.status).update(status=OfferStatus.EXPIRED):
            continue
        offer.status = OfferStatus.EXPIRED
        _notify(offer.buyer, "Your offer expired", f"Your offer on \"{offer.listing.title}\" expired without a deal.", offer)
        expired.append(offer)
    return expired
