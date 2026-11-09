"""Places, comments, reviews and job postings can be reported; confirming a report takes the item down and strikes its owner."""
from datetime import date
from decimal import Decimal

import pytest

from careers.models import JobPosting
from events.models import Venue, VenueReview
from hotels.models import Hotel
from identity.models import AdminProfile, User
from marketplace.tests.test_marketplace_api import _auth_client, quarter  # noqa: F401
from notifications.models import Notification
from social.models import Comment, ContentStatus, Post
from trust_safety.models import ContentReport, ReportStatus, UserWarning

FILE = "/api/content-reports/"


@pytest.fixture
def admin(db):
    user = User.objects.create(username="rk_admin", phone="+237699850001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def reporter(db):
    return User.objects.create(username="rk_reporter", phone="+237699850002")


@pytest.fixture
def owner(db):
    return User.objects.create(username="rk_owner", phone="+237699850003", first_name="Paul", last_name="Owner")


@pytest.fixture
def hotel(owner, quarter):
    return Hotel.objects.create(owner=owner, quarter=quarter, type="HOTEL", name="Hotel Fake Stars", verified=True, description="Pay to reserve")


def _file(user, **body):
    return _auth_client(user).post(FILE, {"reason": "SCAM_SUSPECTED", **body}, format="json")


def _resolve(admin, report_id, strike):
    response = _auth_client(admin).post(
        f"/api/admin/content-reports/{report_id}/resolve/", {"action_taken": "Fake listing", "issue_strike": strike}, format="json",
    )
    assert response.status_code == 200, response.data
    return response.data


@pytest.mark.django_db
def test_a_hotel_can_be_reported_and_the_admin_queue_describes_it(admin, reporter, owner, hotel):
    response = _file(reporter, target_kind="hotel", target_id=str(hotel.pk), notes="Asked for money by WhatsApp")
    assert response.status_code == 201, response.data
    assert response.data["target_kind"] == "hotel" and response.data["target_object_id"] == str(hotel.pk)

    queue = _auth_client(admin).get("/api/admin/content-reports/").data["results"]
    target = next(row for row in queue if row["id"] == response.data["id"])["target"]
    assert target == {
        "type": "hotel", "title": "Hotel Fake Stars", "excerpt": "Pay to reserve", "author_id": str(owner.pk),
        "author_name": "Paul Owner", "path": f"/hotels/{hotel.pk}", "available": True,
    }


@pytest.mark.django_db
def test_owners_cannot_report_their_own_item_nor_report_twice_and_unknown_items_are_404(reporter, owner, hotel):
    assert _file(owner, target_kind="hotel", target_id=str(hotel.pk)).status_code == 400
    assert _file(reporter, target_kind="hotel", target_id=str(hotel.pk)).status_code == 201
    again = _file(reporter, target_kind="hotel", target_id=str(hotel.pk))
    assert again.status_code == 400 and "already reported" in again.data["detail"]
    assert _file(reporter, target_kind="hotel", target_id="not-a-uuid").status_code == 404
    assert _file(reporter, target_kind="spaceship", target_id="1").status_code == 400
    assert _file(reporter, target_kind="hotel").status_code == 400


@pytest.mark.django_db
def test_confirming_a_hotel_report_hides_it_from_the_public_strikes_and_tells_the_owner(admin, reporter, owner, hotel):
    report_id = _file(reporter, target_kind="hotel", target_id=str(hotel.pk)).data["id"]

    data = _resolve(admin, report_id, strike=True)

    assert data["status"] == ReportStatus.REVIEWED and data["target"]["available"] is False
    hotel.refresh_from_db()
    assert hotel.deleted_at is not None and hotel.verified is True
    assert _auth_client(reporter).get(f"/api/hotels/{hotel.pk}/").status_code == 404
    assert str(hotel.pk) not in {row["id"] for row in _auth_client(reporter).get("/api/hotels/").data["results"]}
    assert _auth_client(owner).get(f"/api/hotels/{hotel.pk}/").status_code == 200
    assert UserWarning.objects.filter(subject=owner).count() == 1
    assert Notification.objects.filter(recipient=owner, title="Your content was removed").exists()


@pytest.mark.django_db
def test_dismissing_a_report_leaves_the_item_up(admin, reporter, owner, hotel):
    report_id = _file(reporter, target_kind="hotel", target_id=str(hotel.pk)).data["id"]

    assert _resolve(admin, report_id, strike=False)["status"] == ReportStatus.DISMISSED
    hotel.refresh_from_db()
    assert hotel.deleted_at is None and not UserWarning.objects.filter(subject=owner).exists()


@pytest.mark.django_db
def test_comments_can_be_reported_by_their_number_and_confirming_deletes_them_but_keeps_the_report(admin, reporter, owner):
    post = Post.objects.create(author=reporter, caption="My flat", status=ContentStatus.PUBLISHED)
    comment = Comment.objects.create(author=owner, post=post, text="You are a thief")

    response = _file(reporter, target_comment=comment.pk, reason="HARASSMENT")
    assert response.status_code == 201, response.data
    assert response.data["target_kind"] == "comment"

    _resolve(admin, response.data["id"], strike=True)

    assert not Comment.objects.filter(pk=comment.pk).exists()
    report = ContentReport.objects.get(pk=response.data["id"])
    assert "[Removed comment]: You are a thief" in report.notes
    assert UserWarning.objects.filter(subject=owner).count() == 1


@pytest.mark.django_db
def test_a_job_posting_report_closes_the_job_when_confirmed(admin, reporter, owner):
    job = JobPosting.objects.create(posted_by=owner, title="Agent wanted, pay a training fee", role_category="AGENT", description="Fee first")

    report_id = _file(reporter, target_kind="job_posting", target_id=str(job.pk)).data["id"]
    _resolve(admin, report_id, strike=True)

    job.refresh_from_db()
    assert job.status == "CLOSED"


@pytest.mark.django_db
def test_a_review_can_be_reported_by_anyone_but_its_author(admin, reporter, owner, quarter):
    venue = Venue.objects.create(owner=reporter, quarter=quarter, type="EVENT_CENTER", verified=True)
    review = VenueReview.objects.create(venue=venue, organiser=owner, rating=1, review_text="Worst place, owner is a criminal", event_date=date(2026, 5, 1))

    assert _file(owner, target_kind="venue_review", target_id=str(review.pk)).status_code == 400
    response = _file(reporter, target_kind="venue_review", target_id=str(review.pk), reason="HARASSMENT")
    assert response.status_code == 201, response.data

    target = _resolve(admin, response.data["id"], strike=True)["target"]
    assert target["type"] == "deleted"
    assert not VenueReview.objects.filter(pk=review.pk).exists()


@pytest.mark.django_db
def test_confirming_a_property_listing_report_takes_the_listing_down(admin, reporter, owner, quarter):
    from property.models import Listing, ListingStatus, ListingType, PropertyAsset
    from trust_safety.models import ContentTakedown

    asset = PropertyAsset.objects.create(owner=owner, quarter=quarter, type="HOUSE", description="Too good to be true")
    listing = Listing.objects.create(
        property_asset=asset, listed_by=owner, listing_type=ListingType.RENT, price_xaf=Decimal("20000"), status=ListingStatus.PUBLISHED,
    )
    assert _file(owner, target_listing_id=str(listing.pk)).status_code == 400

    report_id = _file(reporter, target_listing_id=str(listing.pk)).data["id"]
    _resolve(admin, report_id, strike=True)

    listing.refresh_from_db()
    assert listing.status == ListingStatus.REJECTED
    assert ContentTakedown.objects.filter(content_id=listing.pk, restored_at__isnull=True).exists()
    assert UserWarning.objects.filter(subject=owner).count() == 1
