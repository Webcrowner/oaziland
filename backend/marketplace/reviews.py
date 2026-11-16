"""
Written reviews of marketplace purchases, like the product reviews on Amazon or Jumia: only the buyer of a completed
order can review it (so every review is a "verified purchase"), once per order, with a 1-5 score and an optional
comment. Reviews are stored as social.Review rows on the order's booking and shown on the listing they were bought from.
"""
from django.db.models import Avg, Count

MAX_REVIEWS_SHOWN = 50


class ReviewError(Exception):
    pass


def public_author_name(user) -> str:
    """First name and the initial of the last one ("Jean K."): enough to read as a person, not enough to look up."""
    parts = (user.full_name or user.username or "").split()
    if not parts:
        return "Buyer"
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0]}."


def can_review(order, user) -> bool:
    from .models import MarketplaceOrderStatus
    from transactions.models import BookingStatus
    return (
        order.buyer_id == user.id
        and order.status == MarketplaceOrderStatus.COMPLETED
        and order.booking.status == BookingStatus.COMPLETED
    )


def review_order(*, order, buyer, score: int, text: str = ""):
    from social.services import create_review, ReviewRequiresCompletedBookingError, AlreadyReviewedError
    from trust_safety.services import score_text, _worst_action, ContentBlockedError
    from trust_safety.models import ModerationAction

    if order.buyer_id != buyer.id:
        raise PermissionError("Only the buyer can review this order.")
    if not can_review(order, buyer):
        raise ReviewError("You can review an order once it is completed.")
    text = text.strip()
    if text and _worst_action(score_text(text)) == ModerationAction.AUTO_REMOVE:
        raise ContentBlockedError("This review was blocked by content moderation. Please remove inappropriate wording and try again.")
    try:
        return create_review(author=buyer, booking=order.booking, score=score, text=text)
    except (ReviewRequiresCompletedBookingError, AlreadyReviewedError) as e:
        raise ReviewError(str(e))


def listing_reviews(listing) -> dict:
    """Average, count and the latest verified-purchase reviews of one listing."""
    from social.models import Review
    rows = Review.objects.filter(booking__marketplace_order__listing_id=listing.pk)
    summary = rows.aggregate(avg=Avg("score"), count=Count("id"))
    distribution = {str(star): 0 for star in range(1, 6)}
    for row in rows.values("score").annotate(n=Count("id")):
        distribution[str(row["score"])] = row["n"]
    latest = rows.select_related("author").order_by("-created_at")[:MAX_REVIEWS_SHOWN]
    return {
        "average": round(float(summary["avg"]), 1) if summary["avg"] is not None else None,
        "count": summary["count"],
        "distribution": distribution,
        "results": [
            {
                "id": review.id,
                "author_name": public_author_name(review.author),
                "score": review.score,
                "text": review.text,
                "created_at": review.created_at,
                "verified_purchase": True,
            }
            for review in latest
        ],
    }
