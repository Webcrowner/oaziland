"""Admins browse published content and can pull an item down, with a reason, and put it back."""
from decimal import Decimal

import pytest

from identity.models import User, AdminProfile
from marketplace.models import MarketplaceListingBase
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from notifications.models import Notification
from property.models import Listing, ListingStatus, ListingType, PropertyAsset
from social.models import ContentStatus, Post, PostMedia
from trust_safety.models import AuditLog, ContentTakedown


@pytest.fixture
def admin(db):
    user = User.objects.create(username="cb_admin", phone="+237699840001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def owner(db):
    return _verify(User.objects.create(username="cb_owner", phone="+237699840002", first_name="Amina", last_name="Fotso"))


@pytest.fixture
def car(owner, quarter):
    created = _auth_client(owner).post("/api/cars/", {
        "title": "Toyota Corolla 2012", "description": "Clean car", "price_basis": "SALE", "price_xaf": "4000000",
        "quarter": str(quarter.id), "vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2012},
    }, format="json")
    assert created.status_code == 201, created.data
    return MarketplaceListingBase.objects.get(pk=created.data["id"])


@pytest.fixture
def flat(owner, quarter):
    asset = PropertyAsset.objects.create(owner=owner, quarter=quarter, type="HOUSE", description="Three bedrooms near the market")
    return Listing.objects.create(
        property_asset=asset, listed_by=owner, listing_type=ListingType.RENT, price_xaf=Decimal("150000"), status=ListingStatus.PUBLISHED,
    )


@pytest.fixture
def video(owner):
    post = Post.objects.create(author=owner, caption="House tour in Bastos", status=ContentStatus.PUBLISHED)
    PostMedia.objects.create(post=post, media_type="VIDEO", file_url="https://example.com/tour.mp4")
    return post


def browse(admin, **params):
    response = _auth_client(admin).get("/api/admin/content/", params)
    assert response.status_code == 200, response.data
    return response.data


def act(admin, verb, content_type, content_id, **extra):
    return _auth_client(admin).post(
        f"/api/admin/content/{verb}/", {"type": content_type, "id": str(content_id), **extra}, format="json",
    )


# ---------------------------------------------------------------- browsing

@pytest.mark.django_db
def test_only_admins_can_browse_or_act(owner, car):
    assert _auth_client(owner).get("/api/admin/content/").status_code == 403
    assert act(owner, "remove", "marketplace", car.id, reason="x").status_code == 403
    assert not ContentTakedown.objects.exists()


@pytest.mark.django_db
def test_each_kind_is_listed_with_owner_and_page(admin, car, flat, video):
    cars = browse(admin, type="marketplace")["results"]
    assert [r["id"] for r in cars] == [str(car.id)]
    assert cars[0]["title"] == "Toyota Corolla 2012" and cars[0]["owner_username"] == "cb_owner"
    assert cars[0]["kind"] == "cars" and cars[0]["path"] == f"/marketplace/cars/{car.id}"

    props = browse(admin, type="property")["results"]
    assert props[0]["id"] == str(flat.id) and props[0]["path"] == f"/listing/{flat.id}" and props[0]["price_xaf"] == "150000.00"

    posts = browse(admin, type="post")["results"]
    assert posts[0]["id"] == str(video.id) and posts[0]["kind"] == "video" and posts[0]["path"] == f"/videos/{video.id}"


@pytest.mark.django_db
def test_drafts_and_unpublished_items_are_not_in_the_live_list(admin, owner, quarter):
    asset = PropertyAsset.objects.create(owner=owner, quarter=quarter, type="HOUSE")
    Listing.objects.create(property_asset=asset, listed_by=owner, listing_type=ListingType.RENT, price_xaf=1, status=ListingStatus.PENDING_REVIEW)
    Post.objects.create(author=owner, caption="draft", status=ContentStatus.DRAFT)

    assert browse(admin, type="property")["count"] == 0
    assert browse(admin, type="post")["count"] == 0


@pytest.mark.django_db
def test_search_matches_title_owner_and_neighbourhood(admin, car, flat):
    assert browse(admin, type="marketplace", q="corolla")["count"] == 1
    assert browse(admin, type="marketplace", q="amina fotso")["count"] == 1
    assert browse(admin, type="marketplace", q="nothing-like-this")["count"] == 0
    assert browse(admin, type="property", q="market")["count"] == 1
    assert browse(admin, type="property", q="bastos")["count"] == 1
    assert browse(admin, type="property", q="nowhere")["count"] == 0


@pytest.mark.django_db
def test_bad_type_or_state_is_rejected(admin):
    client = _auth_client(admin)
    assert client.get("/api/admin/content/", {"type": "cats"}).status_code == 400
    assert client.get("/api/admin/content/", {"type": "post", "state": "weird"}).status_code == 400


# ---------------------------------------------------------------- removing and restoring

@pytest.mark.django_db
@pytest.mark.parametrize("kind", ["marketplace", "property", "post"])
def test_remove_hides_the_item_tells_the_owner_and_is_audited(admin, owner, car, flat, video, kind):
    target = {"marketplace": car, "property": flat, "post": video}[kind]

    response = act(admin, "remove", kind, target.id, reason="Misleading photos")
    assert response.status_code == 200, response.data

    assert browse(admin, type=kind)["count"] == 0
    removed = browse(admin, type=kind, state="removed")["results"]
    assert len(removed) == 1 and removed[0]["takedown"]["reason"] == "Misleading photos"
    assert removed[0]["takedown"]["removed_by"] == "cb_admin"

    notice = Notification.objects.get(recipient=owner, notification_type="CONTENT_MODERATION")
    assert "Misleading photos" in notice.message
    entry = AuditLog.objects.get(action="admin-content/remove")
    assert entry.actor_username == "cb_admin" and entry.details["reason"] == "Misleading photos"
    assert entry.details["content_id"] == str(target.id) and entry.status_code == 200


@pytest.mark.django_db
def test_a_removed_marketplace_listing_cannot_be_reopened_by_its_lister(admin, owner, car):
    act(admin, "remove", "marketplace", car.id, reason="Fake")

    car.refresh_from_db()
    assert car.removed_by_moderation and car.availability_status == "UNAVAILABLE"
    assert _auth_client(owner).post(f"/api/cars/{car.id}/set-status/", {"status": "AVAILABLE"}, format="json").status_code == 403
    car.refresh_from_db()
    assert car.removed_by_moderation


@pytest.mark.django_db
def test_a_removed_property_listing_cannot_be_reopened_by_its_lister(admin, owner, flat):
    act(admin, "remove", "property", flat.id, reason="Fake")

    reopen = _auth_client(owner).post(f"/api/listings/{flat.id}/set-status/", {"status": "PUBLISHED"}, format="json")
    assert reopen.status_code == 400
    flat.refresh_from_db()
    assert flat.status == ListingStatus.REJECTED


@pytest.mark.django_db
@pytest.mark.parametrize("kind", ["marketplace", "property", "post"])
def test_restore_brings_the_item_back_as_it_was(admin, owner, car, flat, video, kind):
    target = {"marketplace": car, "property": flat, "post": video}[kind]
    act(admin, "remove", kind, target.id, reason="Mistake")

    assert act(admin, "restore", kind, target.id).status_code == 200

    assert browse(admin, type=kind)["count"] == 1
    assert browse(admin, type=kind, state="removed")["count"] == 0
    takedown = ContentTakedown.objects.get(content_id=target.id)
    assert takedown.restored_at is not None and takedown.restored_by == admin
    assert Notification.objects.filter(recipient=owner, title="Your content is back online").exists()


@pytest.mark.django_db
def test_an_under_offer_listing_comes_back_under_offer(admin, flat):
    flat.status = ListingStatus.UNDER_OFFER
    flat.save(update_fields=["status"])
    act(admin, "remove", "property", flat.id, reason="Check")
    act(admin, "restore", "property", flat.id)

    flat.refresh_from_db()
    assert flat.status == ListingStatus.UNDER_OFFER


@pytest.mark.django_db
def test_a_reason_is_required_and_bounded(admin, car):
    assert act(admin, "remove", "marketplace", car.id).status_code == 400
    assert act(admin, "remove", "marketplace", car.id, reason="   ").status_code == 400
    assert act(admin, "remove", "marketplace", car.id, reason="x" * 501).status_code == 400
    car.refresh_from_db()
    assert not car.removed_by_moderation and not ContentTakedown.objects.exists()


@pytest.mark.django_db
def test_removing_twice_or_restoring_live_content_is_refused(admin, car, flat):
    assert act(admin, "remove", "marketplace", car.id, reason="a").status_code == 200
    assert act(admin, "remove", "marketplace", car.id, reason="b").status_code == 400
    assert act(admin, "restore", "property", flat.id).status_code == 400
    assert ContentTakedown.objects.count() == 1


@pytest.mark.django_db
def test_a_listing_pulled_by_a_report_can_be_restored_too(admin, car):
    from marketplace.services import take_down_listing
    take_down_listing(car.id)

    assert browse(admin, type="marketplace", state="removed")["count"] == 1
    assert act(admin, "restore", "marketplace", car.id).status_code == 200
    car.refresh_from_db()
    assert not car.removed_by_moderation and car.availability_status == "AVAILABLE"


@pytest.mark.django_db
def test_unknown_ids_and_types_are_handled(admin):
    import uuid
    assert act(admin, "remove", "post", uuid.uuid4(), reason="x").status_code == 404
    assert act(admin, "remove", "cats", uuid.uuid4(), reason="x").status_code == 400
    assert _auth_client(admin).post("/api/admin/content/remove/", {"type": "post", "id": "nope", "reason": "x"}, format="json").status_code == 400


@pytest.mark.django_db
def test_a_blocked_attempt_by_a_regular_user_is_not_recorded_as_admin_work(owner, car):
    act(owner, "remove", "marketplace", car.id, reason="x")
    assert not AuditLog.objects.filter(action="admin-content/remove").exists()
