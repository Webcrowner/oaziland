"""The admin report queue says what each report is about, who posted it and where to open it."""
import uuid
from decimal import Decimal

import pytest

from identity.models import User, AdminProfile
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from social.models import Post, PostMedia, Comment, ContentStatus
from trust_safety.models import ContentReport, ReportReason


@pytest.fixture
def admin(db):
    user = User.objects.create(username="rt_admin", phone="+237699830001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def reporter(db):
    return User.objects.create(username="rt_reporter", phone="+237699830002")


@pytest.fixture
def poster(db):
    return User.objects.create(username="rt_poster", phone="+237699830003", first_name="Amina", last_name="Fotso")


def _queue(admin):
    response = _auth_client(admin).get("/api/admin/content-reports/")
    assert response.status_code == 200, response.data
    return {row["id"]: row for row in response.data["results"]}


@pytest.mark.django_db
def test_a_post_report_shows_the_caption_the_author_and_no_link_for_a_plain_post(admin, reporter, poster):
    post = Post.objects.create(author=poster, caption="Cheap rooms, send the deposit first", status=ContentStatus.PUBLISHED)
    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.SCAM_SUSPECTED, target_post=post)

    row = _queue(admin)[str(report.id)]

    assert row["reported_by_name"] == "rt_reporter"
    assert row["target"] == {
        "type": "post", "title": "", "excerpt": "Cheap rooms, send the deposit first",
        "author_id": str(poster.id), "author_name": "Amina Fotso", "path": "", "available": True,
    }


@pytest.mark.django_db
def test_a_video_report_links_to_the_video_page(admin, reporter, poster):
    post = Post.objects.create(author=poster, caption="Tour", status=ContentStatus.PUBLISHED)
    PostMedia.objects.create(post=post, media_type="VIDEO", file_url="http://localhost:8000/media/videos/x.mp4")
    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.INAPPROPRIATE_CONTENT, target_post=post)

    target = _queue(admin)[str(report.id)]["target"]

    assert target["type"] == "video" and target["path"] == f"/videos/{post.id}"


@pytest.mark.django_db
def test_a_comment_report_shows_the_comment_text_and_its_author(admin, reporter, poster):
    post = Post.objects.create(author=reporter, caption="Nice flat", status=ContentStatus.PUBLISHED)
    comment = Comment.objects.create(author=poster, post=post, text="Call me on a private number " + "x" * 400)
    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.HARASSMENT, target_comment=comment)

    target = _queue(admin)[str(report.id)]["target"]

    assert target["type"] == "comment" and target["author_name"] == "Amina Fotso"
    assert target["excerpt"].startswith("Call me on a private number") and target["excerpt"].endswith("\u2026") and len(target["excerpt"]) <= 160


@pytest.mark.django_db
def test_a_person_report_names_the_person_and_links_to_their_profile(admin, reporter, poster):
    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.USER_BEHAVIOR, target_user=poster)

    target = _queue(admin)[str(report.id)]["target"]

    assert target["type"] == "user" and target["title"] == "Amina Fotso" and target["excerpt"] == "@rt_poster"
    assert target["path"] == f"/user/{poster.id}" and target["author_id"] == str(poster.id)


@pytest.mark.django_db
def test_a_marketplace_listing_report_shows_the_title_the_category_page_and_whether_it_is_still_up(admin, reporter, quarter):
    lister = _verify(User.objects.create(username="rt_lister", phone="+237699830004"))
    created = _auth_client(lister).post("/api/cars/", {
        "title": "Toyota Corolla 2012", "description": "Clean car", "price_basis": "SALE", "price_xaf": "4000000",
        "quarter": str(quarter.id), "vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2012},
    }, format="json")
    assert created.status_code == 201, created.data
    listing_id = created.data["id"]
    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.MISLEADING_LISTING, target_listing_id=listing_id)

    target = _queue(admin)[str(report.id)]["target"]
    assert target["type"] == "marketplace_listing" and target["title"] == "Toyota Corolla 2012"
    assert target["path"] == f"/marketplace/cars/{listing_id}" and target["author_name"] == "rt_lister" and target["available"] is True

    from marketplace.models import MarketplaceListingBase
    MarketplaceListingBase.objects.filter(pk=listing_id).update(removed_by_moderation=True)
    assert _queue(admin)[str(report.id)]["target"]["available"] is False


@pytest.mark.django_db
def test_a_property_listing_report_describes_the_property_and_links_to_the_listing_page(admin, reporter, quarter):
    from property.models import PropertyAsset, Listing, ListingStatus, ListingType

    owner = User.objects.create(username="rt_owner", phone="+237699830005")
    asset = PropertyAsset.objects.create(owner=owner, quarter=quarter, type="HOUSE", description="Three bedrooms near the market")
    listing = Listing.objects.create(
        property_asset=asset, listed_by=owner, listing_type=ListingType.RENT, price_xaf=Decimal("150000"), status=ListingStatus.PUBLISHED,
    )
    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.SCAM_SUSPECTED, target_listing_id=listing.id)

    target = _queue(admin)[str(report.id)]["target"]

    assert target["type"] == "property_listing" and "Bastos" in target["title"]
    assert target["excerpt"] == "Three bedrooms near the market" and target["path"] == f"/listing/{listing.id}" and target["author_name"] == "rt_owner"


@pytest.mark.django_db
def test_a_report_on_a_deleted_listing_still_loads_and_says_so(admin, reporter):
    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.OTHER, target_listing_id=uuid.uuid4())

    target = _queue(admin)[str(report.id)]["target"]

    assert target["type"] == "listing_deleted" and target["available"] is False and target["path"] == ""


@pytest.mark.django_db
def test_the_report_queue_stays_at_a_fixed_number_of_queries(admin, reporter, poster, django_assert_max_num_queries):
    for index in range(6):
        post = Post.objects.create(author=poster, caption=f"Post {index}", status=ContentStatus.PUBLISHED)
        ContentReport.objects.create(reported_by=reporter, reason=ReportReason.OTHER, target_post=post)
        ContentReport.objects.create(reported_by=reporter, reason=ReportReason.USER_BEHAVIOR, target_user=poster)

    # Posts need one media lookup each; nothing else grows with the number of reports.
    with django_assert_max_num_queries(25):
        assert len(_queue(admin)) == 12


@pytest.mark.django_db
def test_resolving_returns_the_same_described_shape(admin, reporter, poster):
    post = Post.objects.create(author=poster, caption="Reported", status=ContentStatus.PUBLISHED)
    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.HARASSMENT, target_post=post)

    response = _auth_client(admin).post(f"/api/admin/content-reports/{report.id}/resolve/", {"action_taken": "Warned", "issue_strike": True})

    assert response.status_code == 200 and response.data["target"]["author_name"] == "Amina Fotso"
