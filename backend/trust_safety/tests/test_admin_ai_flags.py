"""Content the automated moderation flagged for review: the admin queue, keeping and removing it."""
from decimal import Decimal

import pytest

from identity.models import User, AdminProfile
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from notifications.models import Notification
from property.models import Listing, ListingStatus, ListingType, PropertyAsset
from social.models import ContentStatus, Post
from trust_safety.models import AIModerationResult, AuditLog, ContentTakedown, UserWarning
from trust_safety.services import publish_post_with_moderation


@pytest.fixture
def admin(db):
    user = User.objects.create(username="af_admin", phone="+237699850001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def owner(db):
    return _verify(User.objects.create(username="af_owner", phone="+237699850002", first_name="Bea", last_name="Nkou"))


def make_post(owner, caption):
    post = Post.objects.create(author=owner, caption=caption)
    publish_post_with_moderation(post)
    post.refresh_from_db()
    return post


def queue(admin, **params):
    response = _auth_client(admin).get("/api/admin/ai-flags/", params)
    assert response.status_code == 200, response.data
    return response.data


def act(admin, verb, content_type, content_id, **extra):
    return _auth_client(admin).post(
        f"/api/admin/ai-flags/{verb}/", {"type": content_type, "id": str(content_id), **extra}, format="json",
    )


def create_car(owner, quarter, description):
    created = _auth_client(owner).post("/api/cars/", {
        "title": "Toyota Corolla 2012", "description": description, "price_basis": "SALE", "price_xaf": "4000000",
        "quarter": str(quarter.id), "vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2012},
    }, format="json")
    assert created.status_code == 201, created.data
    return created.data["id"]


# ---------------------------------------------------------------- the queue

@pytest.mark.django_db
def test_a_flagged_post_is_published_and_shows_in_the_queue(admin, owner):
    post = make_post(owner, "Please reviewtest this offer")
    clean = make_post(owner, "A perfectly normal caption")

    assert post.status == ContentStatus.PUBLISHED
    rows = queue(admin)["results"]
    assert [r["id"] for r in rows] == [str(post.id)]
    row = rows[0]
    assert row["type"] == "post" and row["owner_username"] == "af_owner" and row["escalated"] is False
    assert row["flags"][0]["category"] == "SPAM" and row["flags"][0]["action"] == "FLAG_FOR_REVIEW"
    assert str(clean.id) not in [r["id"] for r in rows]


@pytest.mark.django_db
def test_an_escalated_item_is_marked_and_each_item_appears_once(admin, owner):
    post = make_post(owner, "escalatetest and reviewtest")
    make_post(owner, "escalatetest")
    AIModerationResult.objects.create(
        category="SPAM", confidence_score=Decimal("0.700"), action="FLAG_FOR_REVIEW", model_version="t", target_post=post,
    )

    data = queue(admin)
    assert data["count"] == 2
    assert all(r["escalated"] for r in data["results"])
    assert [r["id"] for r in data["results"]].count(str(post.id)) == 1


@pytest.mark.django_db
def test_flagged_marketplace_and_property_listings_are_queued(admin, owner, quarter):
    car_id = create_car(owner, quarter, "reviewtest cheap car")
    asset = PropertyAsset.objects.create(owner=owner, quarter=quarter, type="HOUSE", description="reviewtest house")
    flat = Listing.objects.create(
        property_asset=asset, listed_by=owner, listing_type=ListingType.RENT, price_xaf=Decimal("90000"), status=ListingStatus.PENDING_REVIEW,
    )
    from discovery.services import publish_listing_and_notify
    publish_listing_and_notify(flat)

    rows = {r["id"]: r for r in queue(admin)["results"]}
    assert rows[car_id]["type"] == "marketplace" and rows[car_id]["path"] == f"/marketplace/cars/{car_id}"
    assert rows[str(flat.id)]["type"] == "property" and rows[str(flat.id)]["path"] == f"/listing/{flat.id}"


@pytest.mark.django_db
def test_results_about_items_that_do_not_exist_are_ignored(admin):
    import uuid
    AIModerationResult.objects.create(
        category="SPAM", confidence_score=Decimal("0.700"), action="FLAG_FOR_REVIEW", model_version="t", target_listing_id=uuid.uuid4(),
    )
    assert queue(admin)["count"] == 0


@pytest.mark.django_db
def test_only_admins_can_use_the_queue(owner):
    post = make_post(owner, "reviewtest")
    assert _auth_client(owner).get("/api/admin/ai-flags/").status_code == 403
    assert act(owner, "keep", "post", post.id).status_code == 403
    assert not AIModerationResult.objects.filter(reviewed_at__isnull=False).exists()


@pytest.mark.django_db
def test_the_console_summary_counts_pending_items(admin, owner):
    make_post(owner, "reviewtest one")
    make_post(owner, "reviewtest two")

    summary = _auth_client(admin).get("/api/admin/console-summary/")
    assert summary.data["ai_flags_pending"] == 2


# ---------------------------------------------------------------- reviewing

@pytest.mark.django_db
def test_keeping_closes_the_flags_and_leaves_the_post_live(admin, owner):
    post = make_post(owner, "reviewtest fine actually")

    assert act(admin, "keep", "post", post.id).status_code == 200

    post.refresh_from_db()
    assert post.status == ContentStatus.PUBLISHED
    assert queue(admin)["count"] == 0
    done = queue(admin, state="reviewed")["results"]
    assert done[0]["review"]["outcome"] == "KEPT" and done[0]["review"]["reviewed_by"] == "af_admin"
    assert AuditLog.objects.filter(action="admin-ai-flag/keep", actor_username="af_admin", status_code=200).exists()
    assert not Notification.objects.filter(recipient=owner, notification_type="CONTENT_MODERATION").exists()


@pytest.mark.django_db
def test_removing_takes_it_down_tells_the_owner_and_closes_the_flags(admin, owner):
    post = make_post(owner, "escalatetest spam spam")

    response = act(admin, "remove", "post", post.id, reason="Hateful wording")
    assert response.status_code == 200, response.data

    post.refresh_from_db()
    assert post.status == ContentStatus.CLOSED
    assert queue(admin)["count"] == 0
    assert queue(admin, state="reviewed")["results"][0]["review"]["outcome"] == "REMOVED"
    assert ContentTakedown.objects.filter(content_id=post.id, reason="Hateful wording").exists()
    assert "Hateful wording" in Notification.objects.get(recipient=owner, notification_type="CONTENT_MODERATION").message
    assert not UserWarning.objects.filter(subject=owner).exists()
    assert AuditLog.objects.get(action="admin-ai-flag/remove").details["reason"] == "Hateful wording"


@pytest.mark.django_db
def test_removing_can_also_strike_the_owner(admin, owner):
    post = make_post(owner, "escalatetest")

    assert act(admin, "remove", "post", post.id, reason="Hate", issue_strike=True).status_code == 200

    assert UserWarning.objects.filter(subject=owner).count() == 1


@pytest.mark.django_db
def test_an_admin_owner_is_never_struck(admin):
    other = User.objects.create(username="af_admin2", phone="+237699850003")
    AdminProfile.objects.create(user=other)
    post = make_post(other, "escalatetest")

    assert act(admin, "remove", "post", post.id, reason="Hate", issue_strike=True).status_code == 200
    assert not UserWarning.objects.filter(subject=other).exists()


@pytest.mark.django_db
def test_a_marketplace_listing_can_be_removed_from_the_queue(admin, owner, quarter):
    from marketplace.models import MarketplaceListingBase
    car_id = create_car(owner, quarter, "escalatetest car")

    assert act(admin, "remove", "marketplace", car_id, reason="Hate").status_code == 200

    assert MarketplaceListingBase.objects.get(pk=car_id).removed_by_moderation is True
    assert queue(admin)["count"] == 0


@pytest.mark.django_db
def test_a_reason_is_required_and_nothing_changes_without_one(admin, owner):
    post = make_post(owner, "reviewtest")

    assert act(admin, "remove", "post", post.id).status_code == 400
    assert act(admin, "remove", "post", post.id, reason="  ").status_code == 400

    post.refresh_from_db()
    assert post.status == ContentStatus.PUBLISHED and queue(admin)["count"] == 1
    assert not ContentTakedown.objects.exists()


@pytest.mark.django_db
def test_an_item_without_open_flags_cannot_be_reviewed(admin, owner):
    clean = make_post(owner, "nothing wrong here")
    flagged = make_post(owner, "reviewtest")
    act(admin, "keep", "post", flagged.id)

    assert act(admin, "keep", "post", clean.id).status_code == 400
    assert act(admin, "keep", "post", flagged.id).status_code == 400  # already closed
    assert act(admin, "remove", "post", clean.id, reason="x").status_code == 400
    clean.refresh_from_db()
    assert clean.status == ContentStatus.PUBLISHED


@pytest.mark.django_db
def test_bad_input_is_rejected(admin):
    import uuid
    assert queue_status(admin, state="weird") == 400
    assert act(admin, "keep", "cats", uuid.uuid4()).status_code == 400
    assert _auth_client(admin).post("/api/admin/ai-flags/keep/", {"type": "post", "id": "nope"}, format="json").status_code == 400
    assert act(admin, "keep", "post", uuid.uuid4()).status_code == 404


def queue_status(admin, **params):
    return _auth_client(admin).get("/api/admin/ai-flags/", params).status_code
