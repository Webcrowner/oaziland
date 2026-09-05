"""
Tests for the real testimonials endpoint — pulls only genuine reviews
tied to a completed booking, never fabricated content.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient

from identity.models import User
from social.models import Review
from transactions.models import Booking, BookingType, BookingStatus


@pytest.mark.django_db
def test_testimonials_only_shows_real_reviews_with_text_and_high_score():
    author = User.objects.create(username="testimonial_author", phone="+237699999201", first_name="Happy Customer")
    booking = Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id="00000000-0000-0000-0000-000000000000", requester=author, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="testimonial-1")

    Review.objects.create(author=author, booking=booking, score=5, text="Excellent experience, found my dream home!")

    response = APIClient().get("/api/testimonials/")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["author_name"] == "Happy Customer"
    assert response.data["results"][0]["text"] == "Excellent experience, found my dream home!"


@pytest.mark.django_db
def test_testimonials_excludes_low_scores_and_empty_text():
    author = User.objects.create(username="testimonial_excluded_author", phone="+237699999202")
    low_score_booking = Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id="00000000-0000-0000-0000-000000000000", requester=author, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="testimonial-2")
    no_text_booking = Booking.objects.create(booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id="00000000-0000-0000-0000-000000000000", requester=author, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="testimonial-3")

    Review.objects.create(author=author, booking=low_score_booking, score=2, text="Not great.")
    Review.objects.create(author=author, booking=no_text_booking, score=5, text="")

    response = APIClient().get("/api/testimonials/")
    assert response.data["count"] == 0


@pytest.mark.django_db
def test_testimonials_endpoint_returns_empty_honestly_when_no_reviews_exist():
    """The real gap this closes: an early-stage platform should show
    an honest empty state, never fabricated placeholder testimonials."""
    response = APIClient().get("/api/testimonials/")
    assert response.status_code == 200
    assert response.data["count"] == 0
    assert response.data["results"] == []
