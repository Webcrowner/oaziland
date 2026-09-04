"""
payments.gateways — the PaymentGateway interface and its implementations.

WHY an interface (an abstract base class) instead of just calling MTN
MoMo's API directly wherever a payment happens: without this, "charge
the guest" would mean different code depending on which provider they
chose, scattered across the codebase. With this interface, the Booking/
Escrow logic (transactions/services.py) calls initiate_debit() and
verify_webhook() WITHOUT caring which provider is behind them — adding
a brand-new payment provider later means writing one new class here,
and touching nothing in transactions/.

Real API credentials are NOT wired in yet (that needs the founder to
create the actual CinetPay/Monetbil accounts first). SandboxGateway
below is a working, deterministic stand-in used by tests and local
development until then — it behaves exactly like a real gateway from
the caller's point of view, it just doesn't call a real bank.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class DebitResult:
    """What every gateway returns after attempting to charge someone —
    the SAME shape regardless of which real provider was used, which is
    what lets calling code stay provider-agnostic."""
    success: bool
    provider_reference: str
    raw_provider_response: dict


@dataclass
class WebhookVerificationResult:
    is_valid_signature: bool
    provider_reference: str
    payment_succeeded: bool


class PaymentGateway(ABC):
    """The interface every payment provider must implement. Nothing in
    this codebase should ever import a specific provider (CinetPay,
    Monetbil...) directly outside of this file — everything else talks
    to 'a PaymentGateway', never to a specific one by name."""

    @abstractmethod
    def initiate_debit(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DebitResult:
        """Starts a charge against the guest's Mobile Money account or
        card. Returns immediately — real Mobile Money payments are
        confirmed later via a webhook, not synchronously."""
        raise NotImplementedError

    @abstractmethod
    def verify_webhook(self, *, raw_payload: bytes, signature_header: str) -> WebhookVerificationResult:
        """Checks that an incoming payment-confirmation webhook really
        came from the provider (not a forged request) and reports
        whether the payment succeeded."""
        raise NotImplementedError


class SandboxGateway(PaymentGateway):
    """A working stand-in for local development and automated tests —
    deterministic, no network calls, no real money. Every real provider
    below will need its OWN class implementing the same two methods,
    using that provider's actual API."""

    def initiate_debit(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DebitResult:
        return DebitResult(
            success=True,
            provider_reference=f"SANDBOX-{idempotency_key}",
            raw_provider_response={"status": "sandbox_success", "amount": str(amount_xaf)},
        )

    def verify_webhook(self, *, raw_payload: bytes, signature_header: str) -> WebhookVerificationResult:
        return WebhookVerificationResult(
            is_valid_signature=True, provider_reference="SANDBOX-REF", payment_succeeded=True,
        )


class CinetPayGateway(PaymentGateway):
    """NOT YET CONNECTED to the real CinetPay API — this class exists so
    the shape of a real implementation is visible, and so switching from
    SandboxGateway to this one later is a one-line change (see
    get_active_gateway() below), not a rewrite of the booking flow.
    Needs CINETPAY_API_KEY and CINETPAY_SITE_ID (see .env.example)."""

    def initiate_debit(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DebitResult:
        raise NotImplementedError(
            "CinetPay integration not yet built — requires real API credentials. "
            "See Prompt 13 in the Build Prompts document."
        )

    def verify_webhook(self, *, raw_payload: bytes, signature_header: str) -> WebhookVerificationResult:
        raise NotImplementedError("CinetPay integration not yet built.")


class MonetbilGateway(PaymentGateway):
    """NOT YET CONNECTED — same status as CinetPayGateway above, kept as
    a second real option since Monetbil and CinetPay have different
    strengths (see the API cost-comparison document)."""

    def initiate_debit(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DebitResult:
        raise NotImplementedError("Monetbil integration not yet built.")

    def verify_webhook(self, *, raw_payload: bytes, signature_header: str) -> WebhookVerificationResult:
        raise NotImplementedError("Monetbil integration not yet built.")


class FlutterwaveGateway(PaymentGateway):
    """NOT YET CONNECTED — needs real Flutterwave API credentials. A
    third real option alongside CinetPay and Monetbil.

    WHY this is just another PaymentGateway implementation and NOT a
    replacement for PaymentEscrow: PaymentEscrow is the ledger/business-
    logic layer (gross amount, platform fee, payee amount, held/
    released/refunded/disputed status) — it doesn't know or care HOW
    money moved. Flutterwave, like CinetPay and Monetbil, is only ever
    the HOW. Activating it is a one-line change in get_active_gateway()
    below; nothing about escrow, commission splitting, or dispute
    handling changes."""

    def initiate_debit(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DebitResult:
        raise NotImplementedError(
            "Flutterwave integration not yet built — requires real API credentials. "
            "See FLUTTERWAVE_API_KEY in .env.example."
        )

    def verify_webhook(self, *, raw_payload: bytes, signature_header: str) -> WebhookVerificationResult:
        raise NotImplementedError("Flutterwave integration not yet built.")


def get_active_gateway() -> PaymentGateway:
    """The ONE place that decides which gateway is actually in use. Right
    now it always returns the sandbox. Once real credentials exist, this
    function changes to read an environment variable and return the real
    gateway — and nothing else in the codebase needs to change."""
    return SandboxGateway()
