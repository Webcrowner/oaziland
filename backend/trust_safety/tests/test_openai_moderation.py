"""The real moderation provider: how it reads OpenAI's answer, what it does when the service fails, and that videos
(which software can't look at) reach the admin review queue."""
from types import SimpleNamespace

import pytest
import requests

from identity.models import User
from social.models import Post, PostMedia
from trust_safety import openai_moderation
from trust_safety.models import AIModerationResult
from trust_safety.moderation_providers import SandboxModerationProvider, get_active_moderation_provider
from trust_safety.services import publish_post_with_moderation


def _answer(**scores):
    return {"results": [{"categories": {name: score >= 0.5 for name, score in scores.items()}, "category_scores": scores}]}


@pytest.fixture
def real_provider(settings, monkeypatch):
    settings.OPENAI_API_KEY = "test-key"
    settings.MODERATION_FLAG_UNSCANNED_VIDEOS = True
    sent = []

    def fake_post(url, json=None, **kwargs):
        sent.append(json)
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: sent_answers.pop(0))

    sent_answers = []
    monkeypatch.setattr(openai_moderation.requests, "post", fake_post)
    return SimpleNamespace(answers=sent_answers, sent=sent)


def test_the_sandbox_is_used_until_a_key_is_set(settings):
    settings.OPENAI_API_KEY = ""
    assert isinstance(get_active_moderation_provider(), SandboxModerationProvider)
    settings.OPENAI_API_KEY = "k"
    assert isinstance(get_active_moderation_provider(), openai_moderation.OpenAIModerationProvider)


def test_clean_text_is_allowed(real_provider):
    real_provider.answers.append(_answer(sexual=0.001, hate=0.0))
    [score] = openai_moderation.OpenAIModerationProvider().analyze_text("A bright 3-bedroom in Bastos")
    assert score.action == "ALLOW"


def test_flagged_text_goes_to_review_and_severe_text_is_blocked(real_provider):
    provider = openai_moderation.OpenAIModerationProvider()
    real_provider.answers.append(_answer(harassment=0.8))
    assert [s.action for s in provider.analyze_text("rude")] == ["FLAG_FOR_REVIEW"]
    real_provider.answers.append(_answer(**{"sexual/minors": 0.6}))
    assert [s.action for s in provider.analyze_text("x")] == ["AUTO_REMOVE"]
    real_provider.answers.append(_answer(hate=0.7))
    assert [s.action for s in provider.analyze_text("x")] == ["ESCALATE_ADMIN"]


def test_images_are_sent_by_url_and_a_failure_goes_to_review(real_provider, monkeypatch):
    provider = openai_moderation.OpenAIModerationProvider()
    real_provider.answers.append(_answer(sexual=0.95))
    [score] = provider.analyze_image("https://example.com/a.jpg")
    assert (score.category, score.action) == ("IMAGE_NUDITY", "AUTO_REMOVE")
    assert real_provider.sent[-1]["input"][0]["image_url"]["url"] == "https://example.com/a.jpg"

    def down(*args, **kwargs):
        raise requests.ConnectionError("offline")

    monkeypatch.setattr(openai_moderation.requests, "post", down)
    [score] = provider.analyze_text("anything")
    assert (score.category, score.action) == ("NOT_SCANNED", "FLAG_FOR_REVIEW")


@pytest.mark.django_db
def test_a_video_post_stays_online_but_is_queued_for_review(real_provider):
    real_provider.answers.append(_answer(sexual=0.0))
    author = User.objects.create(username="vid_mod_author", phone="+237699900101")
    post = Post.objects.create(author=author, caption="Tour")
    PostMedia.objects.create(post=post, media_type="VIDEO", file_url="https://example.com/tour.mp4")

    publish_post_with_moderation(post)

    post.refresh_from_db()
    assert post.status == "PUBLISHED"
    flag = AIModerationResult.objects.get(target_post=post, action="FLAG_FOR_REVIEW")
    assert flag.category == "NOT_SCANNED" and flag.model_version == "openai-omni-moderation"


@pytest.mark.django_db
def test_unscanned_videos_can_be_let_through_by_setting(real_provider, settings):
    settings.MODERATION_FLAG_UNSCANNED_VIDEOS = False
    real_provider.answers.append(_answer(sexual=0.0))
    author = User.objects.create(username="vid_mod_author2", phone="+237699900102")
    post = Post.objects.create(author=author, caption="Tour")
    PostMedia.objects.create(post=post, media_type="VIDEO", file_url="https://example.com/tour.mp4")

    publish_post_with_moderation(post)

    assert not AIModerationResult.objects.filter(target_post=post, action="FLAG_FOR_REVIEW").exists()
