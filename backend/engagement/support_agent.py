"""
engagement.support_agent — the AI customer-support chatbot, following
the exact same interface pattern as PaymentGateway/ContentModeration
Provider/NotificationDispatcher/VisualSearchProvider: nothing else
should call an AI API directly.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class SupportAgentReply:
    response_text: str
    should_escalate_to_human: bool


class SupportAgentProvider(ABC):
    @abstractmethod
    def generate_response(self, *, ticket_subject: str, conversation_history: list, latest_message: str) -> SupportAgentReply:
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

    def generate_response(self, *, ticket_subject: str, conversation_history: list, latest_message: str) -> SupportAgentReply:
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


class OpenAISupportAgentProvider(SupportAgentProvider):
    """NOT YET CONNECTED — needs OPENAI_API_KEY. Same status as the
    other real-provider stubs throughout the codebase."""
    def generate_response(self, *, ticket_subject, conversation_history, latest_message):
        raise NotImplementedError("OpenAI-backed support agent not yet built — requires real API credentials.")


def get_active_support_agent_provider() -> SupportAgentProvider:
    return SandboxSupportAgentProvider()
