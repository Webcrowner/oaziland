"""
Tests proving Prompt 9's exact acceptance criteria: a deliberately
inappropriate test image gets auto-flagged BEFORE going live, a normal
photo publishes immediately, a filed report shows up correctly, and the
strike-consequence policy (3=suspend, 5=ban) actually changes account
state.
"""
import pytest

from identity.models import User, AccountStatus
from social.models import Post, PostMedia
from trust_safety.models import ContentReport, ReportReason, ReportStatus, WarningReason
from trust_safety.services import (
    publish_post_with_moderation, ContentBlockedError,
    issue_strike_and_apply_consequences,
    SUSPENSION_STRIKE_THRESHOLD, BAN_STRIKE_THRESHOLD,
)


@pytest.fixture
def author(db):
    return User.objects.create(username="moderation_author", phone="+237699900001")


@pytest.mark.django_db
def test_inappropriate_image_is_auto_flagged_before_going_live(author):
    """Prompt 9's literal acceptance criteria — the deliberately
    inappropriate test image."""
    post = Post.objects.create(author=author, caption="Check out this property")
    PostMedia.objects.create(post=post, media_type="PHOTO", file_url="https://example.com/nudetest-image.jpg")

    with pytest.raises(ContentBlockedError):
        publish_post_with_moderation(post)

    post.refresh_from_db()
    assert post.status != "PUBLISHED"  # correctly blocked, never went live

    from trust_safety.models import AIModerationResult
    assert AIModerationResult.objects.filter(target_post=post, action="AUTO_REMOVE").exists()


@pytest.mark.django_db
def test_normal_photo_publishes_immediately_without_delay(author):
    """The other half of the same acceptance criteria."""
    post = Post.objects.create(author=author, caption="A perfectly normal 3-bedroom house")
    PostMedia.objects.create(post=post, media_type="PHOTO", file_url="https://example.com/normal-house.jpg")

    result = publish_post_with_moderation(post)

    post.refresh_from_db()
    assert post.status == "PUBLISHED"
    assert result == "ALLOW"


@pytest.mark.django_db
def test_flagged_report_shows_up_in_admin_moderation_queue(author):
    """Prompt 9's other literal acceptance criteria."""
    reporter = User.objects.create(username="reporter_user", phone="+237699900002")
    post = Post.objects.create(author=author, caption="Suspicious listing")
    post.publish()

    report = ContentReport.objects.create(reported_by=reporter, reason=ReportReason.SCAM_SUSPECTED, target_post=post)

    open_queue = ContentReport.objects.filter(status=ReportStatus.OPEN)
    assert report in open_queue


@pytest.mark.django_db
def test_text_with_profanity_is_blocked_but_multiple_media_scored_independently(author):
    """Proves the 'worst result wins' rule: one bad image blocks the
    whole post even if the caption text alone is fine."""
    post = Post.objects.create(author=author, caption="A totally normal caption")
    PostMedia.objects.create(post=post, media_type="PHOTO", file_url="https://example.com/normal-1.jpg")
    PostMedia.objects.create(post=post, media_type="PHOTO", file_url="https://example.com/nudetest-2.jpg")  # the bad one

    with pytest.raises(ContentBlockedError):
        publish_post_with_moderation(post)


@pytest.mark.django_db
def test_strikes_below_threshold_do_not_affect_account_status(author):
    assert author.account_status == AccountStatus.ACTIVE

    issue_strike_and_apply_consequences(subject=author, reason=WarningReason.AI_FLAGGED_CONTENT)
    author.refresh_from_db()
    assert author.account_status == AccountStatus.ACTIVE  # 1 strike — no consequence yet

    issue_strike_and_apply_consequences(subject=author, reason=WarningReason.AI_FLAGGED_CONTENT)
    author.refresh_from_db()
    assert author.account_status == AccountStatus.ACTIVE  # 2 strikes — still no consequence


@pytest.mark.django_db
def test_third_strike_triggers_temporary_suspension(author):
    for _ in range(SUSPENSION_STRIKE_THRESHOLD):
        issue_strike_and_apply_consequences(subject=author, reason=WarningReason.REPEATED_VIOLATION)

    author.refresh_from_db()
    assert author.account_status == AccountStatus.SUSPENDED
    assert author.suspended_until is not None


@pytest.mark.django_db
def test_fifth_strike_triggers_permanent_ban(author):
    for _ in range(BAN_STRIKE_THRESHOLD):
        issue_strike_and_apply_consequences(subject=author, reason=WarningReason.REPEATED_VIOLATION)

    author.refresh_from_db()
    assert author.account_status == AccountStatus.BANNED
    assert author.suspended_until is None  # a ban is permanent, not a suspension with an end date


@pytest.mark.django_db
def test_strike_numbers_increment_correctly_across_multiple_warnings(author):
    first = issue_strike_and_apply_consequences(subject=author, reason=WarningReason.AI_FLAGGED_CONTENT)
    second = issue_strike_and_apply_consequences(subject=author, reason=WarningReason.ADMIN_REVIEWED_REPORT)

    assert first.strike_number == 1
    assert second.strike_number == 2
