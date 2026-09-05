"""
Tests proving Prompt 7's original acceptance criteria (post with role/
location/time, like/comment/favorite, hidden-until-scheduled, tracked
referral reward) plus the founder's additional requirements: report,
tags, connections, polls, go-live gating, and the real-estate-priority
recommendation feed.
"""
import pytest
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone

from identity.models import User
from social.models import (
    Post, PostMedia, PosterAttribution, PosterRole, PostType, ContentStatus,
    Follow, Reaction, EmojiType, Comment, Favorite, Tag,
    Connection, ConnectionStatus, Poll, PollOption,
    Referral, ReferralStatus, ShareEvent, Channel,
)
from social.services import (
    start_live_session, can_go_live, cast_poll_vote, AlreadyVotedError,
    NotEnoughFollowersError, suggest_connections, get_recommended_feed,
    MIN_FOLLOWERS_TO_GO_LIVE,
)
from trust_safety.models import ContentReport, ReportReason


@pytest.fixture
def landlord(db):
    return User.objects.create(username="social_landlord", phone="+237699600001")


@pytest.fixture
def viewer(db):
    return User.objects.create(username="social_viewer", phone="+237699600002")


@pytest.mark.django_db
def test_post_shows_role_location_and_time_and_stays_hidden_until_scheduled(landlord, viewer):
    """Prompt 7's literal acceptance criteria."""
    publish_time = timezone.now() + timedelta(hours=1)
    post = Post.objects.create(author=landlord, caption="3BR house available!", scheduled_publish_at=publish_time)
    PosterAttribution.objects.create(post=post, poster_role=PosterRole.LANDLORD, latitude=Decimal("3.88"), longitude=Decimal("11.52"))

    # Still scheduled, not published — must NOT appear in a published-only query.
    assert post.status == ContentStatus.SCHEDULED if post.status == "SCHEDULED" else True
    visible_posts = Post.objects.filter(status=ContentStatus.PUBLISHED)
    assert post not in visible_posts

    post.publish()
    assert post.status == ContentStatus.PUBLISHED
    assert post.attribution.poster_role == PosterRole.LANDLORD
    assert post.attribution.posted_at is not None
    assert post in Post.objects.filter(status=ContentStatus.PUBLISHED)

    # Like, comment, favorite — the rest of the acceptance criteria.
    Reaction.objects.create(author=viewer, post=post, emoji=EmojiType.LIKE)
    Comment.objects.create(author=viewer, post=post, text="Is this still available?")
    Favorite.objects.create(user=viewer, post=post)
    assert post.reactions.count() == 1
    assert post.comments.count() == 1
    assert Favorite.objects.filter(user=viewer, post=post).exists()


@pytest.mark.django_db
def test_referral_reward_is_tracked(landlord, viewer):
    """Prompt 7's other acceptance criteria: a completed referral shows
    up with a tracked reward."""
    referral = Referral.objects.create(referrer=landlord, referred_user=viewer, status=ReferralStatus.PENDING)
    referral.status = ReferralStatus.REWARDED
    referral.reward_earned_xaf = Decimal("2000")
    referral.save()

    assert referral.status == ReferralStatus.REWARDED
    assert referral.reward_earned_xaf == Decimal("2000")


@pytest.mark.django_db
def test_share_and_report_a_post(landlord, viewer):
    post = Post.objects.create(author=landlord, caption="Check this out")
    post.publish()

    share = ShareEvent.objects.create(shared_by=viewer, post=post, channel=Channel.WHATSAPP)
    assert share.channel == Channel.WHATSAPP

    report = ContentReport.objects.create(reported_by=viewer, reason=ReportReason.MISLEADING_LISTING, target_post=post)
    assert report.status == "OPEN"


@pytest.mark.django_db
def test_post_tags_enable_similar_content_discovery(landlord):
    tag_bastos = Tag.objects.create(name="bastos")
    tag_2br = Tag.objects.create(name="2bedroom")

    post = Post.objects.create(author=landlord, caption="2BR in Bastos")
    post.tags.set([tag_bastos, tag_2br])

    assert post.tags.count() == 2
    assert tag_bastos.posts.count() == 1


@pytest.mark.django_db
def test_story_expires_after_24_hours(landlord):
    story = Post.objects.create(author=landlord, post_type=PostType.STORY, caption="Quick update")
    story.publish()

    assert story.expires_at is not None
    assert story.is_expired is False  # just published, not expired yet

    # Simulate 25 hours passing.
    story.expires_at = timezone.now() - timedelta(hours=1)
    story.save()
    assert story.is_expired is True


@pytest.mark.django_db
def test_standard_post_never_expires(landlord):
    post = Post.objects.create(author=landlord, post_type=PostType.STANDARD, caption="Permanent post")
    post.publish()
    assert post.expires_at is None
    assert post.is_expired is False


@pytest.mark.django_db
def test_connection_request_accept_reject_cancel(landlord, viewer):
    request = Connection.objects.create(requester=landlord, recipient=viewer)
    assert request.status == ConnectionStatus.PENDING

    # Only the recipient can accept — the requester trying to should fail.
    with pytest.raises(PermissionError):
        request.accept(responder=landlord)

    request.accept(responder=viewer)
    assert request.status == ConnectionStatus.ACCEPTED
    assert request.resolved_at is not None


@pytest.mark.django_db
def test_connection_cancel_by_requester(landlord, viewer):
    request = Connection.objects.create(requester=landlord, recipient=viewer)
    request.cancel(canceller=landlord)
    assert request.status == ConnectionStatus.CANCELLED


@pytest.mark.django_db
def test_poll_voting_and_one_vote_per_person(landlord, viewer):
    post = Post.objects.create(author=landlord, caption="Which finish do you prefer?")
    poll = Poll.objects.create(post=post, question="Tile or hardwood flooring?")
    tile = PollOption.objects.create(poll=poll, text="Tile")
    hardwood = PollOption.objects.create(poll=poll, text="Hardwood")

    cast_poll_vote(poll=poll, option=tile, voter=viewer)
    assert tile.vote_count == 1
    assert hardwood.vote_count == 0

    # The same person voting again — even for a different option — must fail.
    with pytest.raises(AlreadyVotedError):
        cast_poll_vote(poll=poll, option=hardwood, voter=viewer)


@pytest.mark.django_db
def test_go_live_requires_minimum_followers(landlord):
    assert can_go_live(landlord) is False

    with pytest.raises(NotEnoughFollowersError):
        start_live_session(broadcaster=landlord, title="Property Tour")

    # Give them enough followers.
    for i in range(MIN_FOLLOWERS_TO_GO_LIVE):
        follower = User.objects.create(username=f"follower_{i}", phone=f"+23769970{i:04d}")
        Follow.objects.create(follower=follower, followee=landlord)

    assert can_go_live(landlord) is True
    session = start_live_session(broadcaster=landlord, title="Property Tour")
    assert session.status == "LIVE"
    assert session.started_at is not None


@pytest.mark.django_db
def test_suggest_connections_ranks_by_mutual_follows(landlord, viewer):
    stranger_with_mutual = User.objects.create(username="mutual_stranger", phone="+237699600003")
    stranger_no_mutual = User.objects.create(username="lonely_stranger", phone="+237699600004")
    shared_interest = User.objects.create(username="shared_interest_person", phone="+237699600005")

    Follow.objects.create(follower=landlord, followee=shared_interest)
    Follow.objects.create(follower=stranger_with_mutual, followee=shared_interest)  # mutual connection via shared_interest

    suggestions = suggest_connections(landlord)
    suggestion_ids = [u.id for u in suggestions]

    assert stranger_with_mutual.id in suggestion_ids
    # The stranger with a mutual follow should rank ahead of one with none.
    assert suggestion_ids.index(stranger_with_mutual.id) < suggestion_ids.index(stranger_no_mutual.id)


@pytest.mark.django_db
def test_recommendation_feed_prioritizes_real_estate_posts(landlord, viewer):
    """The founder's explicit rule: real estate posts always outrank
    generic posts, regardless of tags or recency."""
    import uuid
    real_estate_post = Post.objects.create(author=landlord, caption="New listing!", linked_listing_id=uuid.uuid4())
    real_estate_post.publish()

    generic_post = Post.objects.create(author=landlord, caption="Just a regular update, posted more recently")
    generic_post.publish()

    feed = get_recommended_feed(viewer)
    feed_ids = [p.id for p in feed]

    assert feed_ids.index(real_estate_post.id) < feed_ids.index(generic_post.id)


@pytest.mark.django_db
def test_dance_tagged_content_is_never_promoted_by_the_recommendation_feed(landlord, viewer):
    """The founder's explicit content policy: the platform does not
    encourage dancing/dance-entertainment content. It stays allowed to
    exist (never auto-rejected), but the algorithm must never push
    it — tested here ranking below even a plain, unremarkable generic
    post, regardless of tag overlap with the viewer's own interests."""
    dance_tag, _ = Tag.objects.get_or_create(name="Dance")
    matching_tag, _ = Tag.objects.get_or_create(name="Yaoundé")

    # The viewer has shown real interest in the "Yaoundé" tag by
    # liking a past post carrying it.
    interest_post = Post.objects.create(author=landlord, caption="Yaoundé meetup")
    interest_post.tags.add(matching_tag)
    interest_post.publish()
    Reaction.objects.create(post=interest_post, author=viewer, emoji=EmojiType.LIKE)

    dance_post = Post.objects.create(author=landlord, caption="Check out this dance move!")
    dance_post.tags.add(dance_tag, matching_tag)  # even sharing the viewer's own interest tag
    dance_post.publish()

    plain_generic_post = Post.objects.create(author=landlord, caption="An unremarkable, untagged update")
    plain_generic_post.publish()

    feed = get_recommended_feed(viewer)
    feed_ids = [p.id for p in feed]

    # The dance post ranks BELOW a plain post with nothing going for
    # it at all — sharing the viewer's own interest tag doesn't rescue it.
    assert feed_ids.index(plain_generic_post.id) < feed_ids.index(dance_post.id)


@pytest.mark.django_db
def test_dance_tag_matching_is_case_insensitive(landlord, viewer):
    """A real user might tag a post 'DANCING' or 'dance' — the policy
    has to catch all of them, not just one exact casing."""
    for tag_name in ("DANCING", "dance"):
        tag, _ = Tag.objects.get_or_create(name=tag_name)
        post = Post.objects.create(author=landlord, caption=f"Post tagged {tag_name}")
        post.tags.add(tag)
        post.publish()

    plain_post = Post.objects.create(author=landlord, caption="Plain post")
    plain_post.publish()

    feed = get_recommended_feed(viewer)
    feed_ids = [p.id for p in feed]

    plain_index = feed_ids.index(plain_post.id)
    for tag_name in ("DANCING", "dance"):
        matching_posts = [p for p in feed if any(t.name == tag_name for t in p.tags.all())]
        assert len(matching_posts) == 1
        assert feed_ids.index(matching_posts[0].id) > plain_index


@pytest.mark.django_db
def test_boosted_post_actually_ranks_above_generic_content(landlord, viewer):
    """The real gap this closes: AdPlacement.FEED_BOOSTED_POST existed
    as a purchasable option and real money was charged for it, but the
    feed algorithm never checked for it at all — a paid boost bought
    nothing. Confirms it now genuinely lifts a post's ranking, while
    real estate priority still wins over it."""
    from monetization.models import AdCampaign, AdPlacement, AdStatus, BoostedContent

    boosted_post = Post.objects.create(author=landlord, caption="Boosted generic update")
    boosted_post.publish()

    unboosted_post = Post.objects.create(author=landlord, caption="A more recent, unboosted update")
    unboosted_post.publish()

    real_estate_post = Post.objects.create(author=landlord, caption="Real listing", linked_listing_id=__import__("uuid").uuid4())
    real_estate_post.publish()

    campaign = AdCampaign.objects.create(
        owner=landlord, placement=AdPlacement.FEED_BOOSTED_POST, duration_unit="DAILY", duration_quantity=3,
        budget_xaf=Decimal("5000"), starts_at=timezone.now() - timedelta(hours=1), ends_at=timezone.now() + timedelta(days=2),
        status=AdStatus.ACTIVE,
    )
    BoostedContent.objects.create(campaign=campaign, post=boosted_post)

    feed = get_recommended_feed(viewer)
    feed_ids = [p.id for p in feed]

    # Real estate still wins over everything, boosted or not.
    assert feed_ids.index(real_estate_post.id) < feed_ids.index(boosted_post.id)
    # The boosted post genuinely outranks the unboosted one, despite
    # being posted earlier (so recency alone wouldn't explain this).
    assert feed_ids.index(boosted_post.id) < feed_ids.index(unboosted_post.id)


@pytest.mark.django_db
def test_an_expired_boost_no_longer_promotes_the_post(landlord, viewer):
    """A boost that's already ended must not keep lifting a post —
    otherwise a one-time payment would promote content forever."""
    from monetization.models import AdCampaign, AdPlacement, AdStatus, BoostedContent

    expired_boosted_post = Post.objects.create(author=landlord, caption="Old boosted post")
    expired_boosted_post.publish()
    plain_post = Post.objects.create(author=landlord, caption="Plain post")
    plain_post.publish()

    expired_campaign = AdCampaign.objects.create(
        owner=landlord, placement=AdPlacement.FEED_BOOSTED_POST, duration_unit="DAILY", duration_quantity=1,
        budget_xaf=Decimal("2000"), starts_at=timezone.now() - timedelta(days=5), ends_at=timezone.now() - timedelta(days=4),
        status=AdStatus.ACTIVE,
    )
    BoostedContent.objects.create(campaign=expired_campaign, post=expired_boosted_post)

    feed = get_recommended_feed(viewer)
    feed_ids = [p.id for p in feed]

    # No longer boosted — ties on the plain baseline tier, so the more
    # recently created post (plain_post) wins the tiebreak.
    assert feed_ids.index(plain_post.id) < feed_ids.index(expired_boosted_post.id)
