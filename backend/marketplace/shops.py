"""
Shop storefronts: the public page of a seller (profile, policies, announcement, followers, live listings) and vacation
mode. Shop staff already exist in identity.staff_access (an owner invites staff with scoped permissions), so they are
not rebuilt here; followers reuse the platform's follow system (social.Follow).
"""
from django.utils import timezone

from .services import OrderError


class ShopOnVacationError(OrderError):
    pass


def profile_of(user):
    """The seller's profile row, or an unsaved default (so every seller has a storefront)."""
    from .models import ShopProfile
    return ShopProfile.objects.filter(user=user).first() or ShopProfile(user=user)


def seller_on_vacation(user_id) -> bool:
    from .models import ShopProfile
    profile = ShopProfile.objects.filter(user_id=user_id, on_vacation=True).first()
    return bool(profile and profile.vacation_active())


def ensure_not_on_vacation(user_id) -> None:
    from .models import ShopProfile
    profile = ShopProfile.objects.filter(user_id=user_id, on_vacation=True).first()
    if profile and profile.vacation_active():
        until = f" until {profile.vacation_until:%d %b %Y}" if profile.vacation_until else ""
        raise ShopOnVacationError(f"This shop is on vacation{until}. Come back later or message the seller.")


def vacationing_seller_ids():
    """Ids of sellers whose shop is on vacation right now (their listings stay out of browsing)."""
    from .models import ShopProfile
    today = timezone.localdate()
    rows = ShopProfile.objects.filter(on_vacation=True)
    return [p.user_id for p in rows if p.vacation_active(today)]


def storefront(user, viewer=None) -> dict:
    """Everything the public shop page needs besides the listings, which come from the normal browse endpoints
    filtered by lister_id."""
    from social.services import is_following, get_follow_counts
    from .engagement import seller_summary
    from .models import AvailabilityStatus, MarketplaceListingBase, MarketplaceCoupon
    from .engagement import expiry_cutoff
    profile = profile_of(user)
    seller = seller_summary(user)
    live = MarketplaceListingBase.objects.filter(
        lister_user=user, availability_status=AvailabilityStatus.AVAILABLE, removed_by_moderation=False, renewed_at__gte=expiry_cutoff(),
    )
    now = timezone.now()
    deals = sum(1 for l in live.filter(sale_price_xaf__isnull=False, sale_ends_at__gt=now) if l.on_sale(now))
    vacation = profile.vacation_active()
    return {
        "user_id": str(user.pk),
        "name": profile.name or seller["name"],
        "tagline": profile.tagline,
        "description": profile.description,
        "logo_url": profile.logo_url or user.profile_image_url or "",
        "banner_url": profile.banner_url,
        "shipping_policy": profile.shipping_policy,
        "return_policy": profile.return_policy,
        "announcement": profile.announcement,
        "on_vacation": vacation,
        "vacation_message": profile.vacation_message if vacation else "",
        "vacation_until": profile.vacation_until.isoformat() if vacation and profile.vacation_until else None,
        "seller": seller,
        "listing_count": live.count(),
        "deal_count": deals,
        "coupon_available": MarketplaceCoupon.objects.filter(seller=user, is_active=True).exists(),
        "follower_count": get_follow_counts(user)["follower_count"],
        "is_following": bool(viewer is not None and viewer.is_authenticated and is_following(follower=viewer, followee=user)),
        "is_owner": bool(viewer is not None and viewer.is_authenticated and viewer.pk == user.pk),
    }


def notify_followers_of_listing(listing, category: str) -> int:
    """Tells the people who follow a seller that they posted something new."""
    from notifications.services import notify
    from social.models import Follow
    if listing.removed_by_moderation:
        return 0
    shop = profile_of(listing.lister_user).name or listing.lister_user.full_name or listing.lister_user.username
    count = 0
    for follow in Follow.objects.filter(followee=listing.lister_user).select_related("follower")[:500]:
        notify(
            recipient=follow.follower, notification_type="SHOP_NEW_LISTING", title=f"New from {shop}",
            message=f"\"{listing.title}\" — {listing.price_xaf:,.0f} XAF.", related_reference=str(listing.pk),
        )
        count += 1
    return count


def notify_followers_of_sale(listing) -> int:
    """Tells the people who saved a listing (and the shop's followers) that a flash sale started."""
    from notifications.services import notify
    from social.models import Favorite
    count = 0
    for favorite in Favorite.objects.filter(listing_id=listing.pk).exclude(user_id=listing.lister_user_id).select_related("user"):
        notify(
            recipient=favorite.user, notification_type="FLASH_SALE", title="Flash sale on an item you saved",
            message=f"\"{listing.title}\" is {listing.sale_price_xaf:,.0f} XAF until {timezone.localtime(listing.sale_ends_at):%d %b %H:%M}.",
            related_reference=str(listing.pk),
        )
        count += 1
    return count
