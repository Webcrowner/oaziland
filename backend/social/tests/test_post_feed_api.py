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


def _make_post(author, caption="A post", **kwargs):
    response = _auth_client(author).post("/api/posts/", {"caption": caption, **kwargs}, format="json")
    assert response.status_code == 201, response.data
    return response.data


@pytest.mark.django_db
def test_only_the_author_can_delete_a_post_and_nobody_can_edit_one():
    author = User.objects.create(username="own_author", phone="+237699888811")
    stranger = User.objects.create(username="own_stranger", phone="+237699888812")
    post_id = _make_post(author)["id"]

    assert _auth_client(stranger).delete(f"/api/posts/{post_id}/").status_code == 404
    assert Post.objects.filter(id=post_id).exists()
    assert _auth_client(stranger).patch(f"/api/posts/{post_id}/", {"caption": "hijacked"}, format="json").status_code == 405
    assert _auth_client(author).delete(f"/api/posts/{post_id}/").status_code == 204
    assert Post.objects.filter(id=post_id).exists() is False


@pytest.mark.django_db
def test_unpublished_posts_are_not_visible_reactable_or_commentable_by_others():
    author = User.objects.create(username="draft_author", phone="+237699888813")
    viewer = User.objects.create(username="draft_viewer", phone="+237699888814")
    post_id = _make_post(author)["id"]
    Post.objects.filter(id=post_id).update(status=ContentStatus.DRAFT)

    assert APIClient().get(f"/api/posts/{post_id}/").status_code == 404
    assert _auth_client(viewer).post(f"/api/posts/{post_id}/react/", {"emoji": EmojiType.LIKE}).status_code == 404
    assert _auth_client(viewer).post("/api/comments/", {"post": post_id, "text": "hi"}).status_code == 400
    assert _auth_client(author).get(f"/api/posts/{post_id}/").status_code == 200


@pytest.mark.django_db
def test_logged_in_feed_keeps_the_ranking_order_real_estate_first():
    import uuid
    author = User.objects.create(username="rank_author", phone="+237699888815")
    viewer = User.objects.create(username="rank_viewer", phone="+237699888816")
    plain_ids = [_make_post(author, f"plain {i}")["id"] for i in range(3)]
    property_id = _make_post(author, "a property", linked_listing_id=str(uuid.uuid4()))["id"]

    results = _auth_client(viewer).get("/api/posts/").data["results"]
    assert results[0]["id"] == property_id
    assert {r["id"] for r in results} == {property_id, *plain_ids}


@pytest.mark.django_db
def test_anonymous_feed_and_topic_feed_put_real_estate_first():
    import uuid
    author = User.objects.create(username="anon_rank_author", phone="+237699888817")
    _make_post(author, "newer plain", tags=["Bastos"])
    property_id = _make_post(author, "older property", tags=["Bastos"], linked_listing_id=str(uuid.uuid4()))["id"]
    _make_post(author, "newest plain", tags=["Bastos"])

    assert APIClient().get("/api/posts/").data["results"][0]["id"] == property_id
    assert APIClient().get("/api/posts/topic/?tag=bastos").data["results"][0]["id"] == property_id


@pytest.mark.django_db
def test_expired_stories_and_blocked_authors_are_hidden_everywhere():
    from datetime import timedelta
    from django.utils import timezone
    from engagement.models import BlockRelationship

    author = User.objects.create(username="hide_author", phone="+237699888818")
    blocked_author = User.objects.create(username="hide_blocked", phone="+237699888819")
    viewer = User.objects.create(username="hide_viewer", phone="+237699888820")
    expired_id = _make_post(author, "expired story zzz")["id"]
    Post.objects.filter(id=expired_id).update(expires_at=timezone.now() - timedelta(hours=1))
    _make_post(blocked_author, "blocked content zzz")
    BlockRelationship.objects.create(blocker=viewer, blocked=blocked_author)

    for url in ("/api/posts/", "/api/posts/search/?q=zzz"):
        ids = {r["caption"] for r in _auth_client(viewer).get(url).data["results"]}
        assert "expired story zzz" not in ids and "blocked content zzz" not in ids


@pytest.mark.django_db
def test_my_posts_and_reaction_state_are_reported_to_the_viewer():
    author = User.objects.create(username="mine_author", phone="+237699888821")
    viewer = User.objects.create(username="mine_viewer", phone="+237699888822")
    post_id = _make_post(author)["id"]

    mine = _auth_client(author).get("/api/posts/mine/").data["results"]
    assert [p["id"] for p in mine] == [post_id] and mine[0]["is_mine"] is True
    assert APIClient().get("/api/posts/mine/").status_code == 401

    reacted = _auth_client(viewer).post(f"/api/posts/{post_id}/react/", {"emoji": EmojiType.LOVE}).data
    assert reacted["my_reaction"] == EmojiType.LOVE and reacted["is_mine"] is False
    assert reacted["reaction_counts"] == {EmojiType.LOVE: 1}
    removed = _auth_client(viewer).post(f"/api/posts/{post_id}/remove-reaction/").data
    assert removed["my_reaction"] is None and removed["reaction_counts"] == {}


@pytest.mark.django_db
def test_post_validation_and_media_type_detection():
    author = User.objects.create(username="valid_author", phone="+237699888823")
    client = _auth_client(author)

    assert client.post("/api/posts/", {"caption": "   "}, format="json").status_code == 400
    assert client.post("/api/posts/", {"caption": "x" * 2201}, format="json").status_code == 400

    data = _make_post(
        author, "", media_urls=["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.MP4?x=1", "https://cdn.example.com/c.mp3"],
    )
    assert [m["media_type"] for m in data["media"]] == ["PHOTO", "VIDEO", "AUDIO"]


@pytest.mark.django_db
def test_comments_report_ownership_and_hide_blocked_authors():
    from engagement.models import BlockRelationship
    author = User.objects.create(username="cm_author", phone="+237699888824")
    commenter = User.objects.create(username="cm_commenter", phone="+237699888825")
    viewer = User.objects.create(username="cm_viewer", phone="+237699888826")
    post_id = _make_post(author)["id"]
    created = _auth_client(commenter).post("/api/comments/", {"post": post_id, "text": "  hello  "}).data
    assert created["is_mine"] is True and created["text"] == "hello" and created["author_name"] == "cm_commenter"

    assert _auth_client(commenter).post("/api/comments/", {"post": post_id, "text": "   "}).status_code == 400
    assert _auth_client(commenter).patch(f"/api/comments/{created['id']}/", {"text": "x"}, format="json").status_code == 405

    assert _auth_client(viewer).get(f"/api/posts/{post_id}/comments/").data[0]["is_mine"] is False
    BlockRelationship.objects.create(blocker=viewer, blocked=commenter)
    assert _auth_client(viewer).get(f"/api/posts/{post_id}/comments/").data == []

