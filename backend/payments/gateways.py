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
import os
import json
import re
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
import requests

logger = logging.getLogger(__name__)


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
    external_id: str = ""
    amount_xaf: Decimal | None = None


@dataclass
class DisbursementResult:
    """What every gateway returns after attempting to send funds out to
    a payee's Mobile Money account — same shape across all providers."""
    success: bool
    provider_reference: str
    raw_provider_response: dict


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

    def initiate_disbursement(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DisbursementResult:
        """Transfers funds from platform escrow/treasury to a payee's
        Mobile Money (MTN MoMo / Orange Money) wallet."""
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
        try:
            data = json.loads(raw_payload.decode("utf-8")) if raw_payload else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            data = {}
        return WebhookVerificationResult(
            is_valid_signature=signature_header != "invalid",
            provider_reference=data.get("transId") or data.get("provider_reference") or "",
            payment_succeeded=data.get("status", "SUCCESSFUL") in ("SUCCESSFUL", "PAID", "CONFIRMED"),
            external_id=data.get("externalId") or data.get("booking_id") or "",
            amount_xaf=Decimal(str(data["amount"])) if data.get("amount") is not None else None,
        )

    def initiate_disbursement(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DisbursementResult:
        return DisbursementResult(
            success=True,
            provider_reference=f"SANDBOX-DISBURSE-{idempotency_key}",
            raw_provider_response={"status": "sandbox_disbursed", "amount": str(amount_xaf), "phone": phone_number},
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

    def initiate_disbursement(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DisbursementResult:
        raise NotImplementedError("CinetPay payout integration requires live API credentials.")


class MonetbilGateway(PaymentGateway):
    """NOT YET CONNECTED — same status as CinetPayGateway above, kept as
    a second real option since Monetbil and CinetPay have different
    strengths (see the API cost-comparison document)."""

    def initiate_debit(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DebitResult:
        raise NotImplementedError("Monetbil integration not yet built.")

    def verify_webhook(self, *, raw_payload: bytes, signature_header: str) -> WebhookVerificationResult:
        raise NotImplementedError("Monetbil integration not yet built.")

    def initiate_disbursement(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DisbursementResult:
        raise NotImplementedError("Monetbil payout integration requires live API credentials.")


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

    def initiate_disbursement(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DisbursementResult:
        raise NotImplementedError("Flutterwave payout integration requires live API credentials.")


class FapshiGateway(PaymentGateway):
    """Production payment gateway for Cameroon — implements the official
    Fapshi API specification (https://docs.fapshi.com/en/api-reference/getting-started).

    Provides native support for:
    1. Direct Pay (USSD push to MTN Mobile Money / Orange Money in Cameroon)
    2. Initiate Pay (Hosted checkout page for card and mobile money)
    3. Payout / Disbursement (Automated withdrawal to payee MoMo accounts)
    4. Webhook and payment status validation against Fapshi API.

    Environment variables:
    - FAPSHI_API_USER: API User ID issued by Fapshi dashboard
    - FAPSHI_API_KEY: API Key issued by Fapshi dashboard
    - FAPSHI_BASE_URL: https://live.fapshi.com or https://sandbox.fapshi.com (default: sandbox)
    """

    def __init__(self):
        self.api_user = os.environ.get("FAPSHI_API_USER", "").strip()
        self.api_key = os.environ.get("FAPSHI_API_KEY", "").strip()
        self.base_url = os.environ.get("FAPSHI_BASE_URL", "https://live.fapshi.com").strip().rstrip("/")
        self.timeout = int(os.environ.get("FAPSHI_TIMEOUT", "15"))
        self.allow_test_fallback = os.environ.get("FAPSHI_ALLOW_TEST_FALLBACK", "False").lower() in ("true", "1")

    @staticmethod
    def normalize_phone(phone_number: str) -> str:
        """Normalizes any Cameroonian phone format (+237 6XX, 2376XX, 6XX)
        to the 9-digit format required by Fapshi and local telecoms."""
        digits = re.sub(r"\D", "", str(phone_number or ""))
        if digits.startswith("237") and len(digits) > 9:
            digits = digits[3:]
        return digits

    def _headers(self) -> dict:
        return {
            "apiuser": self.api_user,
            "apikey": self.api_key,
            "Content-Type": "application/json",
        }

    def initiate_debit(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DebitResult:
        clean_phone = self.normalize_phone(phone_number)
        amount_int = int(Decimal(str(amount_xaf)))

        if not self.api_user or not self.api_key:
            if self.allow_test_fallback:
                return DebitResult(
                    success=True,
                    provider_reference=f"FAPSHI-SANDBOX-{idempotency_key}",
                    raw_provider_response={
                        "status": "sandbox_success",
                        "transId": f"FAPSHI-SANDBOX-{idempotency_key}",
                        "amount": amount_int,
                        "phone": clean_phone,
                    },
                )
            raise ValueError("FAPSHI_API_USER and FAPSHI_API_KEY must be set to initiate live payments.")

        payload = {
            "amount": amount_int,
            "phone": clean_phone,
            "userId": clean_phone,
            "externalId": str(idempotency_key),
            "message": f"Oaziland Booking #{str(idempotency_key)[:8]}",
        }

        try:
            resp = requests.post(
                f"{self.base_url}/direct-pay",
                json=payload,
                headers=self._headers(),
                timeout=self.timeout,
            )
            res_data = resp.json() if resp.content else {}
            if resp.status_code in (200, 201):
                trans_id = res_data.get("transId", f"FAPSHI-{idempotency_key}")
                return DebitResult(success=True, provider_reference=trans_id, raw_provider_response=res_data)
            logger.warning("Fapshi direct-pay failed (%s): %s", resp.status_code, res_data)
            return DebitResult(success=False, provider_reference="", raw_provider_response=res_data)
        except Exception as e:
            logger.exception("Fapshi direct-pay network error: %s", e)
            if self.allow_test_fallback:
                return DebitResult(
                    success=True,
                    provider_reference=f"FAPSHI-SANDBOX-{idempotency_key}",
                    raw_provider_response={"status": "sandbox_fallback", "error": str(e)},
                )
            return DebitResult(success=False, provider_reference="", raw_provider_response={"error": str(e)})

    def initiate_hosted_pay(self, *, amount_xaf, email: str = "", redirect_url: str = "", idempotency_key: str = "") -> dict:
        """Generates a hosted payment link for card & mobile money checkout."""
        amount_int = int(Decimal(str(amount_xaf)))
        if not self.api_user or not self.api_key:
            return {"link": f"https://sandbox.fapshi.com/pay/{idempotency_key}", "transId": f"FAPSHI-HOSTED-{idempotency_key}"}

        payload = {
            "amount": amount_int,
            "email": email,
            "externalId": str(idempotency_key),
            "redirectUrl": redirect_url,
            "message": f"Oaziland Booking #{str(idempotency_key)[:8]}",
        }
        resp = requests.post(
            f"{self.base_url}/initiate-pay",
            json=payload,
            headers=self._headers(),
            timeout=self.timeout,
        )
        return resp.json() if resp.content else {}

    def verify_webhook(self, *, raw_payload: bytes, signature_header: str) -> WebhookVerificationResult:
        try:
            data = json.loads(raw_payload.decode("utf-8")) if raw_payload else {}
        except Exception:
            data = {}

        trans_id = data.get("transId") or data.get("provider_reference") or ""
        external_id = data.get("externalId") or data.get("booking_id") or ""
        if not self.api_user or not self.api_key or not trans_id:
            logger.error("Cannot verify Fapshi webhook without credentials and a transaction id.")
            return WebhookVerificationResult(False, trans_id, False, external_id=external_id)

        try:
            resp = requests.get(
                f"{self.base_url}/payment-status/{trans_id}",
                headers=self._headers(),
                timeout=self.timeout,
            )
            if resp.status_code != 200:
                logger.warning("Fapshi status verification returned HTTP %s.", resp.status_code)
                return WebhookVerificationResult(False, trans_id, False, external_id=external_id)
            status_data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning("Fapshi status verification failed: %s", exc)
            return WebhookVerificationResult(False, trans_id, False, external_id=external_id)

        verified_reference = status_data.get("transId") or trans_id
        verified_external_id = status_data.get("externalId") or external_id
        verified_amount = status_data.get("amount")
        return WebhookVerificationResult(
            is_valid_signature=verified_reference == trans_id,
            provider_reference=verified_reference,
            payment_succeeded=status_data.get("status") in ("SUCCESSFUL", "PAID"),
            external_id=str(verified_external_id or ""),
            amount_xaf=Decimal(str(verified_amount)) if verified_amount is not None else None,
        )

    def get_balance(self) -> dict:
        """Retrieves live account balance from Fapshi."""
        if not self.api_user or not self.api_key:
            return {"balance": 0}
        try:
            resp = requests.get(
                f"{self.base_url}/balance",
                headers=self._headers(),
                timeout=self.timeout,
            )
            return resp.json() if resp.content else {}
        except Exception as e:
            logger.warning("Fapshi get_balance failed: %s", e)
            return {"error": str(e)}

    def get_payment_status(self, trans_id: str) -> dict:
        """Queries live payment status for a specific transaction."""
        if not self.api_user or not self.api_key:
            return {"status": "SANDBOX"}
        try:
            resp = requests.get(
                f"{self.base_url}/payment-status/{trans_id}",
                headers=self._headers(),
                timeout=self.timeout,
            )
            return resp.json() if resp.content else {}
        except Exception as e:
            logger.warning("Fapshi get_payment_status failed: %s", e)
            return {"error": str(e)}

    def expire_pay(self, trans_id: str) -> dict:
        """Expires an unpaid initiated payment."""
        if not self.api_user or not self.api_key:
            return {"status": "EXPIRED"}
        try:
            resp = requests.post(
                f"{self.base_url}/expire-pay",
                json={"transId": trans_id},
                headers=self._headers(),
                timeout=self.timeout,
            )
            return resp.json() if resp.content else {}
        except Exception as e:
            logger.warning("Fapshi expire_pay failed: %s", e)
            return {"error": str(e)}

    def initiate_disbursement(self, *, phone_number: str, amount_xaf, idempotency_key: str) -> DisbursementResult:
        clean_phone = self.normalize_phone(phone_number)
        amount_int = int(Decimal(str(amount_xaf)))

        if not self.api_user or not self.api_key:
            if self.allow_test_fallback:
                return DisbursementResult(
                    success=True,
                    provider_reference=f"FAPSHI-PAYOUT-SANDBOX-{idempotency_key}",
                    raw_provider_response={
                        "status": "sandbox_disbursed",
                        "amount": amount_int,
                        "phone": clean_phone,
                    },
                )
            raise ValueError("FAPSHI_API_USER and FAPSHI_API_KEY must be set to initiate live payouts.")

        payload = {
            "amount": amount_int,
            "phone": clean_phone,
            "userId": clean_phone,
            "externalId": str(idempotency_key),
            "message": f"Oaziland Earnings Payout #{str(idempotency_key)[:8]}",
        }

        try:
            resp = requests.post(
                f"{self.base_url}/payout",
                json=payload,
                headers=self._headers(),
                timeout=self.timeout,
            )
            res_data = resp.json() if resp.content else {}
            if resp.status_code in (200, 201):
                trans_id = res_data.get("transId", f"FAPSHI-PAYOUT-{idempotency_key}")
                return DisbursementResult(success=True, provider_reference=trans_id, raw_provider_response=res_data)
            logger.warning("Fapshi payout failed (%s): %s", resp.status_code, res_data)
            return DisbursementResult(success=False, provider_reference="", raw_provider_response=res_data)
        except Exception as e:
            logger.exception("Fapshi payout network error: %s", e)
            if self.allow_test_fallback:
                return DisbursementResult(
                    success=True,
                    provider_reference=f"FAPSHI-PAYOUT-SANDBOX-{idempotency_key}",
                    raw_provider_response={"status": "sandbox_fallback", "error": str(e)},
                )
            return DisbursementResult(success=False, provider_reference="", raw_provider_response={"error": str(e)})


def get_active_gateway() -> PaymentGateway:
    """The ONE place that decides which gateway is actually in use.
    Supports FAPSHI (the premier gateway for Cameroon), CINETPAY,
    MONETBIL, FLUTTERWAVE, or SANDBOX.

    Unconditionally falls back to SandboxGateway during automated test runs
    so unit tests never trigger live billable API calls or external API
    restrictions (same pattern as get_active_support_agent_provider)."""
    if "PYTEST_CURRENT_TEST" in os.environ:
        return SandboxGateway()

    provider = os.environ.get("PAYMENT_GATEWAY_PROVIDER", "").strip().upper()
    if provider == "FAPSHI":
        return FapshiGateway()
    elif provider == "CINETPAY":
        return CinetPayGateway()
    elif provider == "MONETBIL":
        return MonetbilGateway()
    elif provider == "FLUTTERWAVE":
        return FlutterwaveGateway()
    if provider == "SANDBOX":
        return SandboxGateway()
    raise RuntimeError(
        "PAYMENT_GATEWAY_PROVIDER must name a configured production gateway. "
        "Use SANDBOX explicitly only for local development."
    )
