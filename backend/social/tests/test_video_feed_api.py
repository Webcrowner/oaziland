"""
Tests for the TikTok-style video feed: only posts with a video appear, the
scope/search/kind filters work, views/saves/shares are counted, and a video
linked to a listing carries a preview card for the description page.
"""
import uuid
from decimal import Decimal

import pytest
from django.conf import settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from identity.models import User
from property.models import House, Listing, ListingPhoto, ListingType, ListingStatus
from social.models import Favorite, Follow, Post, ShareEvent

MEDIA = f"{settings.BACKEND_BASE_URL.rstrip('/')}/media/"
VIDEO = f"{MEDIA}clips/tour.mp4"
PHOTO = f"{MEDIA}clips/front.jpg"


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _user(name, phone):
    return User.objects.create(username=name, phone=phone)


def _post_video(author, caption="A tour", **extra):
    payload = {"caption": caption, "post_type": "REEL", "media_urls": [VIDEO], **extra}
    response = _auth_client(author).post("/api/posts/", payload, format="json")
    assert response.status_code == 201, response.data
    return response.data


def _listing(owner, listing_type=ListingType.RENT):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Bastos District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")
    house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE", bedrooms=3, bathrooms=2)
    listing = Listing.objects.create(
        property_asset=house, listed_by=owner, listing_type=listing_type,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("90000"),
    )
    ListingPhoto.objects.create(listing=listing, url="https://cdn.example.com/cover.jpg", media_type="PHOTO")
    return listing


@pytest.mark.django_db
def test_reels_only_lists_posts_with_a_video_and_is_public():
    author = _user("reel_author", "+237699700001")
    video = _post_video(author)
    photo_only = _auth_client(author).post("/api/posts/", {"caption": "photo", "media_urls": [PHOTO]}, format="json")
    assert photo_only.status_code == 201

    response = APIClient().get("/api/posts/reels/")

    assert response.status_code == 200
    assert [p["id"] for p in response.data["results"]] == [video["id"]]
    assert response.data["results"][0]["media"][0]["media_type"] == "VIDEO"


@pytest.mark.django_db
def test_a_video_post_must_include_a_video_file():
    author = _user("reel_no_video", "+237699700002")

    response = _auth_client(author).post(
        "/api/posts/", {"caption": "x", "post_type": "REEL", "media_urls": [PHOTO]}, format="json",
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_search_matches_caption_tag_and_author_and_tag_filter_narrows():
    author = _user("tour_guy", "+237699700003")
    other = _user("someone_else", "+237699700004")
    first = _post_video(author, caption="Studio in Bastos", tags=["Bastos"])
    _post_video(other, caption="Beach day", tags=["Kribi"])
    client = APIClient()

    by_caption = client.get("/api/posts/reels/?q=studio").data["results"]
    by_tag = client.get("/api/posts/reels/?q=%23kribi").data["results"]
    by_author = client.get("/api/posts/reels/?q=tour_guy").data["results"]
    by_filter = client.get("/api/posts/reels/?tag=bastos").data["results"]

    assert [p["id"] for p in by_caption] == [first["id"]]
    assert len(by_tag) == 1 and by_tag[0]["caption"] == "Beach day"
    assert [p["id"] for p in by_author] == [first["id"]]
    assert [p["id"] for p in by_filter] == [first["id"]]


@pytest.mark.django_db
def test_following_and_saved_scopes_need_login_and_filter_correctly():
    viewer = _user("reel_viewer", "+237699700005")
    followed = _user("reel_followed", "+237699700006")
    stranger = _user("reel_stranger", "+237699700007")
    mine = _post_video(followed, caption="From someone I follow")
    other = _post_video(stranger, caption="From a stranger")
    Follow.objects.create(follower=viewer, followee=followed)
    client = _auth_client(viewer)

    assert APIClient().get("/api/posts/reels/?scope=following").data["results"] == []
    assert [p["id"] for p in client.get("/api/posts/reels/?scope=following").data["results"]] == [mine["id"]]

    assert client.post(f"/api/posts/{other['id']}/save/").data == {"saved": True}
    saved = client.get("/api/posts/reels/?scope=saved").data["results"]
    assert [p["id"] for p in saved] == [other["id"]] and saved[0]["is_saved"] is True
    assert client.post(f"/api/posts/{other['id']}/save/").data == {"saved": False}
    assert Favorite.objects.filter(user=viewer).count() == 0


@pytest.mark.django_db
def test_views_count_for_everyone_except_the_author():
    author = _user("view_author", "+237699700008")
    post_id = _post_video(author)["id"]

    assert APIClient().post(f"/api/posts/{post_id}/view/", REMOTE_ADDR="10.0.0.1").data["view_count"] == 1
    assert APIClient().post(f"/api/posts/{post_id}/view/", REMOTE_ADDR="10.0.0.2").data["view_count"] == 2
    assert _auth_client(author).post(f"/api/posts/{post_id}/view/").data["view_count"] == 2
    assert Post.objects.get(id=post_id).view_count == 2


@pytest.mark.django_db
def test_trending_orders_by_engagement():
    author = _user("trend_author", "+237699700009")
    quiet = _post_video(author, caption="quiet")
    popular = _post_video(author, caption="popular")
    for i in range(3):
        APIClient().post(f"/api/posts/{popular['id']}/view/", REMOTE_ADDR=f"10.1.0.{i}")

    results = APIClient().get("/api/posts/reels/?scope=trending").data["results"]

    assert [p["id"] for p in results] == [popular["id"], quiet["id"]]


@pytest.mark.django_db
def test_sharing_is_recorded_and_validated():
    author = _user("share_author", "+237699700010")
    sharer = _user("sharer", "+237699700011")
    post_id = _post_video(author)["id"]
    client = _auth_client(sharer)

    assert client.post(f"/api/posts/{post_id}/share/", {"channel": "WHATSAPP"}, format="json").data == {"share_count": 1}
    assert client.post(f"/api/posts/{post_id}/share/", {"channel": "NOPE"}, format="json").status_code == 400
    assert APIClient().post(f"/api/posts/{post_id}/share/", {"channel": "IN_APP"}, format="json").status_code == 401
    assert ShareEvent.objects.filter(post_id=post_id).count() == 1
    assert APIClient().get(f"/api/posts/{post_id}/reel/").data["share_count"] == 1


@pytest.mark.django_db
def test_linked_listing_gets_a_preview_and_kind_filter():
    owner = _user("reel_owner", "+237699700012")
    listing = _listing(owner)
    with_listing = _post_video(owner, caption="Tour", linked_listing_id=str(listing.id))
    _post_video(owner, caption="General clip")
    client = APIClient()

    detail = client.get(f"/api/posts/{with_listing['id']}/reel/").data
    assert detail["listing_preview"] == {
        "id": str(listing.id), "listing_type": "RENT", "property_type": "HOUSE", "price_xaf": "90000.00",
        "quarter": "Bastos", "cover_url": "https://cdn.example.com/cover.jpg", "is_available": True,
    }
    assert [p["id"] for p in client.get("/api/posts/reels/?kind=rent").data["results"]] == [with_listing["id"]]
    assert client.get("/api/posts/reels/?kind=sale").data["results"] == []
    assert len(client.get("/api/posts/reels/?kind=general").data["results"]) == 1
    assert [p["id"] for p in client.get(f"/api/posts/reels/?listing={listing.id}").data["results"]] == [with_listing["id"]]
    assert client.get("/api/posts/reels/?listing=not-a-uuid").data["results"] == []
    assert uuid.UUID(detail["listing_preview"]["id"]) == listing.id


@pytest.mark.django_db
def test_trending_tags_lists_tags_on_video_posts_only():
    author = _user("tag_author", "+237699700013")
    _post_video(author, tags=["Bastos", "ForRent"])
    _post_video(author, tags=["Bastos"])
    _auth_client(author).post("/api/posts/", {"caption": "photo", "tags": ["PhotoOnly"], "media_urls": [PHOTO]}, format="json")

    tags = APIClient().get("/api/posts/trending-tags/").data

    assert tags[0] == {"name": "Bastos", "count": 2}
    assert {t["name"] for t in tags} == {"Bastos", "ForRent"}


@pytest.mark.django_db
def test_a_video_can_only_be_linked_to_a_property_its_author_listed():
    owner = _user("link_owner", "+237699700020")
    stranger = _user("link_stranger", "+237699700021")
    listing = _listing(owner)
    payload = {"caption": "Tour", "post_type": "REEL", "media_urls": [VIDEO]}

    other = _auth_client(stranger).post("/api/posts/", {**payload, "linked_listing_id": str(listing.id)}, format="json")
    missing = _auth_client(stranger).post("/api/posts/", {**payload, "linked_listing_id": str(uuid.uuid4())}, format="json")
    own = _auth_client(owner).post("/api/posts/", {**payload, "linked_listing_id": str(listing.id)}, format="json")

    assert other.status_code == 400 and "linked_listing_id" in other.data
    assert missing.status_code == 400 and "linked_listing_id" in missing.data
    assert own.status_code == 201
    assert not Post.objects.filter(author=stranger).exists()


@pytest.mark.django_db
def test_media_must_be_hosted_by_oaziland():
    author = _user("hotlink_author", "+237699700022")

    response = _auth_client(author).post(
        "/api/posts/", {"caption": "x", "post_type": "REEL", "media_urls": ["https://cdn.example.com/huge.mp4"]}, format="json",
    )

    assert response.status_code == 400 and "media_urls" in response.data
    assert not Post.objects.filter(author=author).exists()


@pytest.mark.django_db
def test_a_video_can_be_reported_once_and_not_by_its_author():
    author = _user("report_author", "+237699700023")
    viewer = _user("report_viewer", "+237699700024")
    post_id = _post_video(author)["id"]
    body = {"target_post": post_id, "reason": "INAPPROPRIATE_CONTENT", "notes": "not ok"}

    assert _auth_client(viewer).post("/api/content-reports/", body, format="json").status_code == 201
    assert _auth_client(viewer).post("/api/content-reports/", body, format="json").status_code == 400
    assert _auth_client(author).post("/api/content-reports/", body, format="json").status_code == 400

@pytest.mark.django_db
def test_the_same_viewer_counts_once_per_clip():
    author = _user("dedupe_author", "+237699700030")
    viewer = _user("dedupe_viewer", "+237699700031")
    post_id = _post_video(author)["id"]

    for _ in range(3):
        assert _auth_client(viewer).post(f"/api/posts/{post_id}/view/").status_code == 200
        APIClient().post(f"/api/posts/{post_id}/view/", REMOTE_ADDR="10.2.0.1")

    assert Post.objects.get(id=post_id).view_count == 2


@pytest.mark.django_db
def test_poster_role_follows_the_account_type():
    from decimal import Decimal
    from identity.models import AgencyProfile, AgentProfile

    owner = _user("role_owner", "+237699700032")
    independent = _user("role_independent", "+237699700033")
    agency_user = _user("role_agency", "+237699700034")
    employed = _user("role_employed", "+237699700035")
    AgentProfile.objects.create(user=independent, agent_commission_percent=Decimal("10"))
    agency = AgencyProfile.objects.create(user=agency_user, registration_number="RC-ROLE-1", agency_commission_percent=Decimal("20"))
    AgentProfile.objects.create(user=employed, agency=agency, agent_commission_percent=Decimal("10"))

    roles = {u.username: _post_video(u)["poster_role"] for u in (owner, independent, agency_user, employed)}

    assert roles == {
        "role_owner": "LANDLORD", "role_independent": "INDEPENDENT_AGENT",
        "role_agency": "AGENCY_AGENT", "role_employed": "AGENCY_AGENT",
    }


@pytest.mark.django_db
def test_comments_are_moderated():
    from trust_safety.models import ContentReport

    author = _user("cmt_author", "+237699700036")
    commenter = _user("cmt_commenter", "+237699700037")
    post_id = _post_video(author)["id"]
    client = _auth_client(commenter)

    clean = client.post("/api/comments/", {"post": post_id, "text": "Nice place"}, format="json")
    blocked = client.post("/api/comments/", {"post": post_id, "text": "this is a badword"}, format="json")
    flagged = client.post("/api/comments/", {"post": post_id, "text": "reviewtest please"}, format="json")

    assert clean.status_code == 201
    assert blocked.status_code == 400 and "text" in blocked.data
    assert flagged.status_code == 201
    assert [c["text"] for c in APIClient().get(f"/api/posts/{post_id}/comments/").data] == ["Nice place", "reviewtest please"]
    report = ContentReport.objects.get(target_kind="comment", target_object_id=str(flagged.data["id"]))
    assert report.reported_by.is_platform_account and report.status == "OPEN"
    assert ContentReport.objects.count() == 1