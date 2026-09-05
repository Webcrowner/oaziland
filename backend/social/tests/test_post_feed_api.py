"""
Tests for the real social feed API — the biggest gap found this
session: get_recommended_feed(), boosted-post ranking, and the dance-
content policy have all been built and tested on top of a feature
that had NO way to create a post, view a feed, react, or comment,
anywhere at any layer.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from social.models import Post, Comment, Reaction, ContentStatus, EmojiType


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_creating_a_post_publishes_it_with_a_real_attribution():
    author = User.objects.create(username="feed_author", phone="+237699888801")
    client = _auth_client(author)

    response = client.post("/api/posts/", {"caption": "Just listed a new place!", "tags": ["Bastos", "ForRent"]}, format="json")
    assert response.status_code == 201
    assert response.data["status"] == ContentStatus.PUBLISHED
    assert set(response.data["tag_names"]) == {"Bastos", "ForRent"}

    post = Post.objects.get(id=response.data["id"])
    assert hasattr(post, "attribution")  # the mandatory attribution the model requires


@pytest.mark.django_db
def test_moderation_blocked_post_is_rejected_with_a_clean_error():
    author = User.objects.create(username="feed_blocked_author", phone="+237699888802")
    client = _auth_client(author)

    response = client.post("/api/posts/", {"caption": "This contains a badword in it."}, format="json")
    assert response.status_code == 400
    assert Post.objects.filter(author=author).exists() is False or \
        Post.objects.get(author=author).status != ContentStatus.PUBLISHED


@pytest.mark.django_db
def test_the_public_feed_is_browsable_without_login():
    author = User.objects.create(username="feed_public_author", phone="+237699888803")
    _auth_client(author).post("/api/posts/", {"caption": "A real public post"}, format="json")

    response = APIClient().get("/api/posts/")
    assert response.status_code == 200
    assert response.data["count"] >= 1


@pytest.mark.django_db
def test_reacting_to_a_post_and_changing_the_reaction():
    author = User.objects.create(username="feed_react_author", phone="+237699888804")
    reactor = User.objects.create(username="feed_reactor", phone="+237699888805")
    create_response = _auth_client(author).post("/api/posts/", {"caption": "React to this"}, format="json")
    post_id = create_response.data["id"]

    client = _auth_client(reactor)
    like_response = client.post(f"/api/posts/{post_id}/react/", {"emoji": EmojiType.LIKE})
    assert like_response.status_code == 200
    assert like_response.data["reaction_counts"][EmojiType.LIKE] == 1

    # Changing to LOVE updates in place — still exactly one reaction from this person.
    love_response = client.post(f"/api/posts/{post_id}/react/", {"emoji": EmojiType.LOVE})
    assert love_response.data["reaction_counts"].get(EmojiType.LIKE, 0) == 0
    assert love_response.data["reaction_counts"][EmojiType.LOVE] == 1
    assert Reaction.objects.filter(post_id=post_id, author=reactor).count() == 1


@pytest.mark.django_db
def test_invalid_emoji_is_rejected():
    author = User.objects.create(username="feed_bad_emoji_author", phone="+237699888806")
    create_response = _auth_client(author).post("/api/posts/", {"caption": "React to this"}, format="json")
    post_id = create_response.data["id"]

    response = _auth_client(author).post(f"/api/posts/{post_id}/react/", {"emoji": "NOT_A_REAL_EMOJI"})
    assert response.status_code == 400


@pytest.mark.django_db
def test_commenting_on_a_post_and_deleting_your_own_comment():
    author = User.objects.create(username="feed_comment_author", phone="+237699888807")
    commenter = User.objects.create(username="feed_commenter", phone="+237699888808")
    stranger = User.objects.create(username="feed_comment_stranger", phone="+237699888809")

    create_response = _auth_client(author).post("/api/posts/", {"caption": "Comment on this"}, format="json")
    post_id = create_response.data["id"]

    comment_response = _auth_client(commenter).post("/api/comments/", {"post": post_id, "text": "Nice place!"})
    assert comment_response.status_code == 201
    comment_id = comment_response.data["id"]

    comments_list = APIClient().get(f"/api/posts/{post_id}/comments/")
    assert comments_list.data[0]["text"] == "Nice place!"

    # A stranger cannot delete someone else's comment.
    stranger_delete = _auth_client(stranger).delete(f"/api/comments/{comment_id}/")
    assert stranger_delete.status_code in (403, 404)
    assert Comment.objects.filter(id=comment_id).exists()

    # The real author can.
    own_delete = _auth_client(commenter).delete(f"/api/comments/{comment_id}/")
    assert own_delete.status_code == 204
    assert Comment.objects.filter(id=comment_id).exists() is False


@pytest.mark.django_db
def test_creating_a_post_requires_authentication():
    response = APIClient().post("/api/posts/", {"caption": "Anonymous post attempt"})
    assert response.status_code == 401
