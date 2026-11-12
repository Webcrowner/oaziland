"""
Tests for real ratings, reviews, and reporting a person directly —
closing genuine gaps: Rating and Review both had real models (Rating
already consumed by agent/agency dashboard aggregation) but zero way
for a real user to create either. ContentReport could target a post,
listing, or comment, but never a person — and even for those three,
nothing let a real user actually FILE one; only admin resolution of
an already-existing report was ever built.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from transactions.models import Booking, BookingType, BookingStatus
from social.models import Rating, Review
from trust_safety.models import ContentReport


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _listing_by(agent, owner=None):
    from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
    from property.models import House, Listing, ListingType, ListingStatus

    country = Country.objects.create(name=f"Cameroon {agent.username}", iso_code=agent.username[-3:].upper())
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaounde I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")
    house = House.objects.create(owner=owner or agent, quarter=quarter, type="HOUSE")
    return Listing.objects.create(
        property_asset=house, listed_by=agent, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"),
    )


def _booking(listing, requester, status=BookingStatus.COMPLETED):
    return Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=requester, status=status, amount_xaf=Decimal("100000"), idempotency_key=f"rate-{listing.id}-{requester.id}",
    )


def _completed_deal(agent, rater):
    return _booking(_listing_by(agent), rater)


# ---------------------------------------------------------------------
# Ratings — a real gap this closes
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_rating_an_agent_creates_a_real_rating():
    agent = User.objects.create(username="rate_agent", phone="+237699101001")
    rater = User.objects.create(username="rate_rater", phone="+237699101002")
    _completed_deal(agent, rater)

    response = _auth_client(rater).post("/api/ratings/", {"subject_user": str(agent.id), "score": "4.5"})

    assert response.status_code == 201
    assert Rating.objects.filter(author=rater, subject_user=agent).exists()


@pytest.mark.django_db
def test_re_rating_the_same_agent_updates_in_place_not_a_second_row():
    agent = User.objects.create(username="rate_update_agent", phone="+237699101003")
    rater = User.objects.create(username="rate_update_rater", phone="+237699101004")
    _completed_deal(agent, rater)
    client = _auth_client(rater)
    client.post("/api/ratings/", {"subject_user": str(agent.id), "score": "3.0"})

    client.post("/api/ratings/", {"subject_user": str(agent.id), "score": "5.0"})

    assert Rating.objects.filter(author=rater, subject_user=agent).count() == 1
    assert Rating.objects.get(author=rater, subject_user=agent).score == Decimal("5.0")


@pytest.mark.django_db
def test_a_new_ratings_average_is_reflected_in_the_real_agent_dashboard():
    """Proves this genuinely feeds the already-built aggregation in
    agency.services, not just that a row gets created in isolation."""
    from identity.models import AgentProfile
    agent = User.objects.create(username="rate_dashboard_agent", phone="+237699101005")
    AgentProfile.objects.create(user=agent, agent_commission_percent=Decimal("10.0"))
    rater = User.objects.create(username="rate_dashboard_rater", phone="+237699101006")
    _completed_deal(agent, rater)
    _auth_client(rater).post("/api/ratings/", {"subject_user": str(agent.id), "score": "4.0"})

    from agency.services import get_agent_public_profile
    summary = get_agent_public_profile(agent)

    assert summary["average_rating"] == 4.0
    assert summary["rating_count"] == 1


@pytest.mark.django_db
def test_cannot_rate_yourself():
    user = User.objects.create(username="rate_self_user", phone="+237699101007")
    response = _auth_client(user).post("/api/ratings/", {"subject_user": str(user.id), "score": "5.0"})
    assert response.status_code == 400


@pytest.mark.django_db
def test_rating_requires_authentication():
    agent = User.objects.create(username="rate_noauth_agent", phone="+237699101008")
    response = APIClient().post("/api/ratings/", {"subject_user": str(agent.id), "score": "4.0"})
    assert response.status_code == 401


@pytest.mark.django_db
def test_an_agent_cannot_be_rated_without_a_completed_deal():
    agent = User.objects.create(username="rate_gate_agent", phone="+237699101009")
    stranger = User.objects.create(username="rate_gate_stranger", phone="+237699101010")
    client = _auth_client(stranger)
    rate = lambda: client.post("/api/ratings/", {"subject_user": str(agent.id), "score": "5.0"})

    assert rate().status_code == 403
    booking = _booking(_listing_by(agent), stranger, status=BookingStatus.CONFIRMED)
    assert rate().status_code == 403, "a paid but not yet completed booking does not earn a rating"

    booking.status = BookingStatus.COMPLETED
    booking.save(update_fields=["status"])
    assert rate().status_code == 201
    assert not Rating.objects.filter(subject_user=agent).exclude(author=stranger).exists()


@pytest.mark.django_db
def test_both_the_listing_agent_and_the_owner_can_be_rated_and_can_rate_back():
    agent = User.objects.create(username="rate_both_agent", phone="+237699101011")
    owner = User.objects.create(username="rate_both_owner", phone="+237699101012")
    tenant = User.objects.create(username="rate_both_tenant", phone="+237699101013")
    _booking(_listing_by(agent, owner=owner), tenant)

    tenant_client = _auth_client(tenant)
    assert tenant_client.post("/api/ratings/", {"subject_user": str(agent.id), "score": "4.0"}).status_code == 201
    assert tenant_client.post("/api/ratings/", {"subject_user": str(owner.id), "score": "4.0"}).status_code == 201
    assert _auth_client(owner).post("/api/ratings/", {"subject_user": str(tenant.id), "score": "5.0"}).status_code == 201
    assert _auth_client(agent).post("/api/ratings/", {"subject_user": str(owner.id), "score": "5.0"}).status_code == 403


@pytest.mark.django_db
def test_a_property_can_only_be_rated_after_a_completed_booking_there():
    agent = User.objects.create(username="rate_prop_agent", phone="+237699101014")
    guest = User.objects.create(username="rate_prop_guest", phone="+237699101015")
    stranger = User.objects.create(username="rate_prop_stranger", phone="+237699101016")
    listing = _listing_by(agent)
    _booking(listing, guest)
    payload = {"subject_property_id": str(listing.property_asset_id), "score": "4.0"}

    assert _auth_client(stranger).post("/api/ratings/", payload).status_code == 403
    assert _auth_client(guest).post("/api/ratings/", payload).status_code == 201


@pytest.mark.django_db
def test_the_rating_eligibility_check_tells_the_ui_whether_to_show_stars():
    agent = User.objects.create(username="rate_check_agent", phone="+237699101017")
    customer = User.objects.create(username="rate_check_customer", phone="+237699101018")
    stranger = User.objects.create(username="rate_check_stranger", phone="+237699101019")
    _completed_deal(agent, customer)
    check = lambda user: _auth_client(user).get("/api/ratings/", {"subject_user": str(agent.id)}).data

    assert check(customer) == {"can_rate": True, "reason": ""}
    assert check(stranger)["can_rate"] is False
    assert "after completing" in check(stranger)["reason"]
    assert check(agent)["can_rate"] is False


# ---------------------------------------------------------------------
# Reviews — a real gap this closes
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_leaving_a_real_review_for_a_completed_booking():
    landlord = User.objects.create(username="review_landlord", phone="+237699101009")
    guest = User.objects.create(username="review_guest", phone="+237699101010")
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=landlord.id,
        requester=guest, status=BookingStatus.COMPLETED, amount_xaf=Decimal("50000"), idempotency_key="review-test-1",
    )

    response = _auth_client(guest).post("/api/reviews/", {"booking": str(booking.id), "score": 5, "text": "Great landlord, very responsive."})

    assert response.status_code == 201
    assert Review.objects.filter(booking=booking, author=guest).exists()


@pytest.mark.django_db
def test_cannot_review_a_booking_that_is_not_yet_completed():
    guest = User.objects.create(username="review_pending_guest", phone="+237699101011")
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=guest.id,
        requester=guest, status=BookingStatus.CONFIRMED, amount_xaf=Decimal("50000"), idempotency_key="review-test-2",
    )

    response = _auth_client(guest).post("/api/reviews/", {"booking": str(booking.id), "score": 5, "text": "Too early"})

    assert response.status_code == 400


@pytest.mark.django_db
def test_only_the_bookings_own_requester_can_review_it():
    guest = User.objects.create(username="review_perm_guest", phone="+237699101012")
    stranger = User.objects.create(username="review_perm_stranger", phone="+237699101013")
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=guest.id,
        requester=guest, status=BookingStatus.COMPLETED, amount_xaf=Decimal("50000"), idempotency_key="review-test-3",
    )

    response = _auth_client(stranger).post("/api/reviews/", {"booking": str(booking.id), "score": 5, "text": "Not my booking"})

    assert response.status_code == 403


@pytest.mark.django_db
def test_cannot_review_the_same_booking_twice():
    guest = User.objects.create(username="review_dup_guest", phone="+237699101014")
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=guest.id,
        requester=guest, status=BookingStatus.COMPLETED, amount_xaf=Decimal("50000"), idempotency_key="review-test-4",
    )
    client = _auth_client(guest)
    client.post("/api/reviews/", {"booking": str(booking.id), "score": 5, "text": "First review"})

    second_response = client.post("/api/reviews/", {"booking": str(booking.id), "score": 3, "text": "Second attempt"})

    assert second_response.status_code == 400


@pytest.mark.django_db
def test_a_real_review_appears_in_real_testimonials():
    """Proves this genuinely feeds TestimonialsView, which already
    reads from Review — not just that a row gets created in isolation."""
    guest = User.objects.create(username="review_testimonial_guest", phone="+237699101015")
    guest.first_name, guest.last_name = "Aicha", "Njoya"
    guest.save()
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=guest.id,
        requester=guest, status=BookingStatus.COMPLETED, amount_xaf=Decimal("50000"), idempotency_key="review-test-5",
    )
    _auth_client(guest).post("/api/reviews/", {"booking": str(booking.id), "score": 5, "text": "Excellent experience overall."})

    response = APIClient().get("/api/testimonials/")

    assert response.data["count"] == 1
    assert response.data["results"][0]["text"] == "Excellent experience overall."


# ---------------------------------------------------------------------
# Reporting a person directly — a real gap this closes
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_filing_a_real_report_against_an_agent():
    agent = User.objects.create(username="report_agent", phone="+237699101016")
    reporter = User.objects.create(username="report_reporter", phone="+237699101017")

    response = _auth_client(reporter).post("/api/content-reports/", {
        "reason": "HARASSMENT", "target_user": str(agent.id), "notes": "Sent threatening messages after I declined a viewing.",
    })

    assert response.status_code == 201
    assert ContentReport.objects.filter(target_user=agent, reported_by=reporter).exists()


@pytest.mark.django_db
def test_cannot_report_yourself():
    user = User.objects.create(username="report_self_user", phone="+237699101018")
    response = _auth_client(user).post("/api/content-reports/", {"reason": "OTHER", "target_user": str(user.id)})
    assert response.status_code == 400


@pytest.mark.django_db
def test_reporting_requires_exactly_one_target():
    reporter = User.objects.create(username="report_no_target_user", phone="+237699101019")
    response = _auth_client(reporter).post("/api/content-reports/", {"reason": "OTHER"})
    assert response.status_code == 400


@pytest.mark.django_db
def test_a_strike_on_a_person_report_actually_finds_the_real_subject():
    """The real fix to resolve_content_report — previously, a strike
    decision on a report targeting a user directly would silently do
    nothing, since the lookup only ever checked target_post/target_comment."""
    from trust_safety.services import resolve_content_report
    from identity.models import AdminProfile

    agent = User.objects.create(username="report_strike_agent", phone="+237699101020")
    reporter = User.objects.create(username="report_strike_reporter", phone="+237699101021")
    admin_user = User.objects.create(username="report_strike_admin", phone="+237699101022")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    report = ContentReport.objects.create(reported_by=reporter, reason="HARASSMENT", target_user=agent)

    resolve_content_report(report=report, resolved_by=admin_user, action_taken="Confirmed harassment", issue_strike=True)

    agent.refresh_from_db()
    assert agent.warnings.count() == 1


@pytest.mark.django_db
def test_reporting_requires_authentication():
    agent = User.objects.create(username="report_noauth_agent", phone="+237699101023")
    response = APIClient().post("/api/content-reports/", {"reason": "OTHER", "target_user": str(agent.id)})
    assert response.status_code == 401
