"""
trust_safety.openai_moderation - the real moderation provider, backed by OpenAI's moderation endpoint
(omni-moderation: text and images, free of charge). Used automatically once OPENAI_API_KEY is set.

It can look at text and pictures but not at video. A video is therefore sent to the flag queue for a person to
watch (unless MODERATION_FLAG_UNSCANNED_VIDEOS is turned off), and so is anything the service could not check
because it was unreachable: a failure never lets unchecked content through silently.
"""
import logging
from decimal import Decimal

import requests
from django.conf import settings

from .models import ModerationAction, ModerationCategory
from .moderation_providers import ContentModerationProvider, ModerationScore

logger = logging.getLogger(__name__)

ENDPOINT = "https://api.openai.com/v1/moderations"
MODEL = "omni-moderation-latest"
TIMEOUT_SECONDS = 10

# OpenAI category -> ours. Categories not listed here are ignored.
_CATEGORY_MAP = {
    "sexual": ModerationCategory.SEXUAL_CONTENT,
    "sexual/minors": ModerationCategory.SEXUAL_CONTENT,
    "hate": ModerationCategory.HATE_SPEECH,
    "hate/threatening": ModerationCategory.HATE_SPEECH,
    "harassment": ModerationCategory.HARASSMENT,
    "harassment/threatening": ModerationCategory.HARASSMENT,
    "violence": ModerationCategory.VIOLENCE,
    "violence/graphic": ModerationCategory.VIOLENCE,
    "self-harm": ModerationCategory.SELF_HARM,
    "self-harm/intent": ModerationCategory.SELF_HARM,
    "self-harm/instructions": ModerationCategory.SELF_HARM,
}
# Blocked outright; everything else the service flags goes to a person.
_BLOCK_RULES = {"sexual/minors": Decimal("0.0"), "sexual": Decimal("0.9"), "hate/threatening": Decimal("0.9")}
_ESCALATE = {"hate", "hate/threatening", "harassment/threatening", "self-harm/intent", "self-harm/instructions", "violence/graphic"}
_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif")


def _decision(result: dict, *, image: bool) -> list[ModerationScore]:
    flagged = [name for name, hit in (result.get("categories") or {}).items() if hit and name in _CATEGORY_MAP]
    scores = result.get("category_scores") or {}
    if not flagged:
        return [ModerationScore(ModerationCategory.SPAM, Decimal("0.000"), ModerationAction.ALLOW)]
    out = []
    for name in flagged:
        confidence = Decimal(str(round(float(scores.get(name, 0)), 3)))
        if name in _BLOCK_RULES and confidence >= _BLOCK_RULES[name]:
            action = ModerationAction.AUTO_REMOVE
        elif name in _ESCALATE:
            action = ModerationAction.ESCALATE_ADMIN
        else:
            action = ModerationAction.FLAG_FOR_REVIEW
        category = _CATEGORY_MAP[name]
        if image and category == ModerationCategory.SEXUAL_CONTENT:
            category = ModerationCategory.IMAGE_NUDITY
        out.append(ModerationScore(category, min(confidence, Decimal("0.999")), action))
    return out


def _not_scanned() -> list[ModerationScore]:
    return [ModerationScore(ModerationCategory.NOT_SCANNED, Decimal("0.000"), ModerationAction.FLAG_FOR_REVIEW)]


class OpenAIModerationProvider(ContentModerationProvider):
    model_version = "openai-omni-moderation"
    def _moderate(self, payload) -> dict:
        response = requests.post(
            ENDPOINT, json={"model": MODEL, "input": payload}, timeout=TIMEOUT_SECONDS,
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
        )
        response.raise_for_status()
        return response.json()["results"][0]

    def analyze_text(self, text: str) -> list:
        try:
            return _decision(self._moderate(text), image=False)
        except (requests.RequestException, KeyError, IndexError, ValueError):
            logger.warning("Text moderation was unavailable; the post goes to the review queue.", exc_info=True)
            return _not_scanned()

    def analyze_image(self, image_url: str) -> list:
        path = image_url.split("?", 1)[0].lower()
        if not path.endswith(_IMAGE_EXTENSIONS):
            return _not_scanned()
        try:
            return _decision(self._moderate([{"type": "image_url", "image_url": {"url": image_url}}]), image=True)
        except (requests.RequestException, KeyError, IndexError, ValueError):
            logger.warning("Image moderation was unavailable; the post goes to the review queue.", exc_info=True)
            return _not_scanned()

    def analyze_video(self, video_url: str) -> list:
        if not settings.MODERATION_FLAG_UNSCANNED_VIDEOS:
            return [ModerationScore(ModerationCategory.NOT_SCANNED, Decimal("0.000"), ModerationAction.ALLOW)]
        return _not_scanned()
