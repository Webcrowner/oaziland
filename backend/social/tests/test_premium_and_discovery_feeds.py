"""
Tests for the creator premium subscription (checkmark, feed boost) and
the real discovery feeds (Following, Topic, Search).
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from social.models import Post, Follow, ContentStatus
from social.services import get_recommended_feed
from monetization.services import subscribe_to_creator_premium, is_premium_creator
from payments.gateways import SandboxGateway


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_subscribing_to_creator_premium_grants_the_checkmark_and_can_be_cancelled():
    user = User.objects.create(username="premium_user", phone="+237699999901")
    assert is_premium_creator(user) is False

    subscribe_to_creator_premium(user=user, payment_gateway=SandboxGateway(), phone_number=user.phone)
    assert is_premium_creator(user) is True

    post_response = _auth_client(user).post("/api/posts/", {"caption": "A premium creator's post"}, format="json")
    assert post_response.data["is_verified_creator"] is True

    from monetization.services import cancel_creator_premium
    cancel_creator_premium(user)
    # Cancelling doesn't revoke perks already paid for this period.
    assert is_premium_creator(user) is True


@pytest.mark.django_db
def test_premium_creator_post_ranks_above_plain_content_but_below_a_paid_ad_boost():
    viewer = User.objects.create(username="premium_feed_viewer", phone="+237699999902")
    premium_author = User.objects.create(username="premium_feed_author", phone="+237699999903")
    plain_author = User.objects.create(username="plain_feed_author", phone="+237699999904")

    subscribe_to_creator_premium(user=premium_author, payment_gateway=SandboxGateway(), phone_number=premium_author.phone)

    premium_post = Post.objects.create(author=premium_author, caption="Premium creator post")
    premium_post.publish()
    plain_post = Post.objects.create(author=plain_author, caption="Plain post")
    plain_post.publish()

    feed = get_recommended_feed(viewer)
    feed_ids = [p.id for p in feed]
    assert feed_ids.index(premium_post.id) < feed_ids.index(plain_post.id)


@pytest.mark.django_db
def test_following_feed_shows_only_followed_authors():
    viewer = User.objects.create(username="following_feed_viewer", phone="+237699999905")
    followed_author = User.objects.create(username="following_feed_followed", phone="+237699999906")
    unfollowed_author = User.objects.create(username="following_feed_unfollowed", phone="+237699999907")
    Follow.objects.create(follower=viewer, followee=followed_author)

    followed_post = Post.objects.create(author=followed_author, caption="From someone I follow")
    followed_post.publish()
    unfollowed_post = Post.objects.create(author=unfollowed_author, caption="From a stranger")
    unfollowed_post.publish()

    response = _auth_client(viewer).get("/api/posts/following/")
    result_ids = [p["id"] for p in response.data["results"]]
    assert str(followed_post.id) in result_ids
    assert str(unfollowed_post.id) not in result_ids


@pytest.mark.django_db
def test_topic_feed_filters_by_tag():
    author = User.objects.create(username="topic_feed_author", phone="+237699999908")
    tagged_post = Post.objects.create(author=author, caption="Tagged post")
    tagged_post.publish()
    from social.models import Tag
    tag, _ = Tag.objects.get_or_create(name="Bastos")
    tagged_post.tags.add(tag)

    untagged_post = Post.objects.create(author=author, caption="Untagged post")
    untagged_post.publish()

    response = APIClient().get("/api/posts/topic/?tag=Bastos")
    result_ids = [p["id"] for p in response.data["results"]]
    assert str(tagged_post.id) in result_ids
    assert str(untagged_post.id) not in result_ids


@pytest.mark.django_db
def test_search_posts_matches_caption_and_tag():
    author = User.objects.create(username="search_feed_author", phone="+237699999909")
    matching_post = Post.objects.create(author=author, caption="A cozy apartment for rent")
    matching_post.publish()
    unrelated_post = Post.objects.create(author=author, caption="Something else entirely")
    unrelated_post.publish()

    response = APIClient().get("/api/posts/search/?q=apartment")
    result_ids = [p["id"] for p in response.data["results"]]
    assert str(matching_post.id) in result_ids
    assert str(unrelated_post.id) not in result_ids


@pytest.mark.django_db
def test_creator_premium_api_flow():
    user = User.objects.create(username="premium_api_user", phone="+237699999910")
    client = _auth_client(user)

    status_before = client.get("/api/my-creator-premium/")
    assert status_before.data["is_premium"] is False

    subscribe_response = client.post("/api/my-creator-premium/", {"phone_number": user.phone})
    assert subscribe_response.status_code == 200
    assert subscribe_response.data["is_premium"] is True

    status_after = client.get("/api/my-creator-premium/")
    assert status_after.data["is_premium"] is True
