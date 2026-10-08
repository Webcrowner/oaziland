"""
engagement.support_agent — the AI customer-support chatbot, following
the exact same interface pattern as PaymentGateway/ContentModeration
Provider/NotificationDispatcher/VisualSearchProvider: nothing else
should call an AI API directly.
"""
import logging
import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)


@dataclass
class SupportAgentReply:
    response_text: str
    should_escalate_to_human: bool


_SITE_PATH_RE = re.compile(
    r"^/(?:listing|hotels|student-hostels|guest-houses|events|search|marketplace|taskln-service|oazigo|faq|contact|how-it-works)\b"
)
_MARKDOWN_LINK_RE = re.compile(r"`?\[([^\]]*)\]\(\s*([^\s)`]+)[`\s]*\)?`?")


def _site_path(url: str):
    """The in-site path (no host, no /en|/fr prefix) for a link to one of our pages, else None."""
    url = url.strip("`'\" ")
    if url.startswith(("http://", "https://")):
        parsed = urlparse(url)
        url = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
    url = re.sub(r"^/(en|fr)(?=/|\?|$)", "", url) or "/"
    return url if _SITE_PATH_RE.match(url) else None


def clean_reply_links(text: str) -> str:
    """Free models often mangle links (full http://localhost URLs, stray backticks, a trailing arrow in
    the label). A stray backtick inside the URL even broke the area filter, so every link to one of our
    pages is rewritten to a clean [label](/path)."""
    def fix(match):
        path = _site_path(match.group(2))
        if path is None:
            return match.group(0)
        label = match.group(1).strip().rstrip("\u2192 ").strip() or "Open page"
        return f"[{label}]({path})"

    return _MARKDOWN_LINK_RE.sub(fix, text)


class SupportAgentProvider(ABC):
    @abstractmethod
    def generate_response(
        self, *, ticket_subject: str, conversation_history: list, latest_message: str, platform_context: str = "",
    ) -> SupportAgentReply:
        raise NotImplementedError


class SandboxSupportAgentProvider(SupportAgentProvider):
    """A working, deterministic stand-in: answers a small set of common
    questions directly, and escalates immediately if the user explicitly
    asks for a human or the message doesn't match anything it knows —
    proving the ESCALATION logic works correctly, not real general-
    purpose AI conversation."""

    _FAQ = {
        "refund": "Refunds for a disputed booking are handled through our Dispute process — response within 48 hours, resolution within 7 days.",
        "verify": "To get verified, submit a supporting document through your profile — an admin reviews it, usually within 24 hours.",
        "fee": "Oaziland takes a small platform fee on transactions; the exact rate depends on the transaction type.",
    }
    _ESCALATION_TRIGGERS = {"human", "agent", "person", "representative"}

    def generate_response(self, *, ticket_subject: str, conversation_history: list, latest_message: str, platform_context: str = "") -> SupportAgentReply:
        lowered = latest_message.lower()

        if any(trigger in lowered for trigger in self._ESCALATION_TRIGGERS):
            return SupportAgentReply(
                response_text="Of course — connecting you with a member of our support team now.",
                should_escalate_to_human=True,
            )

        for keyword, answer in self._FAQ.items():
            if keyword in lowered:
                return SupportAgentReply(response_text=answer, should_escalate_to_human=False)

        return SupportAgentReply(
            response_text="I'm not sure I can help with that one — let me get a member of our team to assist you.",
            should_escalate_to_human=True,
        )


class OpenRouterSupportAgentProvider(SupportAgentProvider):
    """Real AI backing via OpenRouter's OpenAI-compatible /chat/completions
    API (https://openrouter.ai/docs). Every answer is grounded in real
    platform data (platform_context, built by
    engagement.services.build_platform_context()) so it can quote real
    listings/prices/services instead of inventing them — and falls back
    to escalating to a human on any request failure rather than ever
    showing a broken reply.

    Environment variables:
    - OPENROUTER_API_KEY: secret key from https://openrouter.ai/keys
    - OPENROUTER_MODEL: model slug (default: openai/gpt-4o-mini)
    """
    API_URL = "https://openrouter.ai/api/v1/chat/completions"

    SYSTEM_PROMPT = (
        "You are Oazi, the customer-support assistant for Oaziland — a real-estate "
        "and services super-app in Cameroon covering property rentals/sales, hotels, "
        "student hostels, event venues, guest houses, a marketplace, artisan/technician "
        "services, and OaziGo rides. Only answer questions directly related to Oaziland "
        "and the platform data given to you below — politely decline anything unrelated "
        "(e.g. general trivia, other companies). When asked to recommend or compare "
        "options, use ONLY the PLATFORM DATA section for real names/prices/ids — never "
        "invent a listing, price, or policy that isn't in that data or general platform "
        "knowledge. If the data doesn't cover the question, say so plainly rather than "
        "guessing. If the user explicitly asks for a human, say you're connecting them "
        "with the support team.\n\n"
        "LINKS: finding something is only useful if the user can open it. Whenever PLATFORM DATA "
        "contains a link (a path starting with /), share it as a markdown link such as "
        "[Bastos rentals](/search?quarter=...) and copy the path EXACTLY as given — never invent, "
        "shorten or change a path or id, and never turn it into a full http URL. Use a short human label "
        "such as \"View listing\" or \"Browse Bastos\" — never the path itself as the label. Whenever you list areas, hotels, listings or options, put the "
        "link next to EACH one — never say you will share links later. If the user answers a question "
        "you asked (for example just an area name), treat it as the answer and give results with links "
        "right away, consistent with what you offered earlier.\n"
        "FINDING PLACES (properties, hotels, student hostels, guest houses, venues): say what you "
        "found (how many, prices) and give the specific links plus the area page link. If nothing "
        "matches the requested budget or filters, say so plainly, mention the closest option if the "
        "data lists one, and STILL give the area page link. If the data says the user did not name an "
        "area, ask ONE short question for the neighborhood or city (and budget if useful) and offer the "
        "general page link meanwhile; if an area exists in several cities, ask which city.\n"
        "You are still the assistant for the WHOLE platform — answer questions about payments, "
        "escrow, verification, bookings, accounts and services normally. Keep replies short.\n\n"
        "PLATFORM DATA:\n{platform_context}"
    )

    def __init__(self):
        self.api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        self.timeout = int(os.environ.get("OPENROUTER_TIMEOUT", "20"))
        # A primary model plus fallbacks — OpenRouter's `:free` models share
        # a per-provider capacity pool across ALL of its users, so a single
        # free model returning 429 "temporarily rate-limited upstream" is a
        # real, common, transient condition, not a bug. Trying the next
        # model in the list (OpenRouter's own documented remedy: "add
        # fallback models") means one congested free model doesn't take
        # the whole chatbot down.
        primary = os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini").strip()
        fallbacks = [m.strip() for m in os.environ.get("OPENROUTER_FALLBACK_MODELS", "").split(",") if m.strip()]
        self.models = [primary] + [m for m in fallbacks if m != primary]

    def generate_response(self, *, ticket_subject: str, conversation_history: list, latest_message: str, platform_context: str = "") -> SupportAgentReply:
        if not self.api_key:
            raise NotImplementedError("OPENROUTER_API_KEY is not set — cannot use the OpenRouter support agent.")

        messages = [{
            "role": "system",
            "content": self.SYSTEM_PROMPT.format(platform_context=platform_context or "No specific matching records found."),
        }]
        for entry in conversation_history:
            role = "assistant" if entry.get("sender_type") in ("AI_AGENT", "HUMAN_AGENT") else "user"
            messages.append({"role": role, "content": entry.get("text", "")})
        messages.append({"role": "user", "content": latest_message})

        last_error = None
        for model in self.models:
            try:
                resp = requests.post(
                    self.API_URL,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        # OpenRouter uses these purely for its own public leaderboard attribution.
                        "HTTP-Referer": "https://oaziland.com",
                        "X-Title": "Oaziland Support",
                    },
                    json={"model": model, "messages": messages, "temperature": 0.4},
                    timeout=self.timeout,
                )
                resp.raise_for_status()
                reply_text = clean_reply_links(resp.json()["choices"][0]["message"]["content"].strip())
            except Exception as e:
                last_error = e
                logger.warning("OpenRouter model %s failed, trying next fallback: %s", model, e)
                continue

            wants_human = any(t in latest_message.lower() for t in ("human", "agent", "representative", "real person"))
            return SupportAgentReply(response_text=reply_text, should_escalate_to_human=wants_human)

        logger.exception("OpenRouter support agent request failed on all configured models: %s", last_error)
        return SupportAgentReply(
            response_text="I'm having trouble reaching our AI assistant right now — connecting you with a member of our support team.",
            should_escalate_to_human=True,
        )


def get_active_support_agent_provider() -> SupportAgentProvider:
    # Never let an automated test suite make a real, billed network call —
    # same reasoning as every other provider factory in this codebase,
    # just enforced unconditionally here since a real OPENROUTER_API_KEY
    # is expected to actually be present in local/prod .env files.
    if "PYTEST_CURRENT_TEST" in os.environ:
        return SandboxSupportAgentProvider()

    provider = os.environ.get("SUPPORT_AGENT_PROVIDER", "").upper()
    if provider == "OPENROUTER" or (not provider and os.environ.get("OPENROUTER_API_KEY")):
        return OpenRouterSupportAgentProvider()
    return SandboxSupportAgentProvider()
