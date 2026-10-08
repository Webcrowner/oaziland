import os
import json
from decimal import Decimal
from unittest.mock import patch, MagicMock
import pytest

from payments.gateways import (
    FapshiGateway,
    SandboxGateway,
    get_active_gateway,
    DebitResult,
    DisbursementResult,
    WebhookVerificationResult,
)


def test_fapshi_phone_normalization():
    normalize = FapshiGateway.normalize_phone
    assert normalize("+237677112233") == "677112233"
    assert normalize("237699001122") == "699001122"
    assert normalize("670123456") == "670123456"
    assert normalize("+237 6 55 44 33 22") == "655443322"


def test_fapshi_initiate_debit_test_fallback():
    gateway = FapshiGateway()
    gateway.api_user = ""
    gateway.api_key = ""
    gateway.allow_test_fallback = True

    result = gateway.initiate_debit(
        phone_number="+237677112233",
        amount_xaf=Decimal("15000"),
        idempotency_key="idemp-12345",
    )

    assert isinstance(result, DebitResult)
    assert result.success is True
    assert "idemp-12345" in result.provider_reference
    assert result.raw_provider_response["phone"] == "677112233"
    assert result.raw_provider_response["amount"] == 15000


@patch("requests.post")
def test_fapshi_initiate_debit_live_api(mock_post):
    gateway = FapshiGateway()
    gateway.api_user = "test_user_fapshi"
    gateway.api_key = "test_key_fapshi"
    gateway.base_url = "https://sandbox.fapshi.com"

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b'{"statusCode": 200, "message": "Success", "transId": "FAPSHI-TX-999", "status": "PENDING"}'
    mock_resp.json.return_value = {
        "statusCode": 200,
        "message": "Success",
        "transId": "FAPSHI-TX-999",
        "status": "PENDING",
    }
    mock_post.return_value = mock_resp

    result = gateway.initiate_debit(
        phone_number="+237677112233",
        amount_xaf=Decimal("25000"),
        idempotency_key="booking-live-777",
    )

    assert result.success is True
    assert result.provider_reference == "FAPSHI-TX-999"

    mock_post.assert_called_once()
    args, kwargs = mock_post.call_args
    assert args[0] == "https://sandbox.fapshi.com/direct-pay"
    assert kwargs["headers"]["apiuser"] == "test_user_fapshi"
    assert kwargs["headers"]["apikey"] == "test_key_fapshi"
    assert kwargs["json"]["amount"] == 25000
    assert kwargs["json"]["phone"] == "677112233"
    assert kwargs["json"]["externalId"] == "booking-live-777"


@patch("requests.post")
def test_fapshi_initiate_disbursement_payout(mock_post):
    gateway = FapshiGateway()
    gateway.api_user = "test_user_fapshi"
    gateway.api_key = "test_key_fapshi"
    gateway.base_url = "https://sandbox.fapshi.com"

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b'{"statusCode": 200, "message": "Payout initiated", "transId": "FAPSHI-PAY-888"}'
    mock_resp.json.return_value = {
        "statusCode": 200,
        "message": "Payout initiated",
        "transId": "FAPSHI-PAY-888",
    }
    mock_post.return_value = mock_resp

    result = gateway.initiate_disbursement(
        phone_number="+237 699 88 77 66",
        amount_xaf=Decimal("75000"),
        idempotency_key="payout-999",
    )

    assert isinstance(result, DisbursementResult)
    assert result.success is True
    assert result.provider_reference == "FAPSHI-PAY-888"

    mock_post.assert_called_once()
    args, kwargs = mock_post.call_args
    assert args[0] == "https://sandbox.fapshi.com/payout"
    assert kwargs["json"]["amount"] == 75000
    assert kwargs["json"]["phone"] == "699887766"
    assert kwargs["json"]["externalId"] == "payout-999"


def test_fapshi_webhook_verification():
    gateway = FapshiGateway()

    # Valid payload
    payload = json.dumps({
        "transId": "FAPSHI-TX-101",
        "externalId": "book-101",
        "amount": 50000,
        "status": "SUCCESSFUL",
    }).encode("utf-8")

    res = gateway.verify_webhook(raw_payload=payload, signature_header="valid")
    assert isinstance(res, WebhookVerificationResult)
    assert res.is_valid_signature is True
    assert res.payment_succeeded is True
    assert res.provider_reference == "FAPSHI-TX-101"

    # Invalid signature test rejection
    res_invalid = gateway.verify_webhook(raw_payload=payload, signature_header="invalid")
    assert res_invalid.is_valid_signature is False
    assert res_invalid.payment_succeeded is False


def test_get_active_gateway_provider_switch(monkeypatch):
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setenv("PAYMENT_GATEWAY_PROVIDER", "FAPSHI")
    gw = get_active_gateway()
    assert isinstance(gw, FapshiGateway)

    monkeypatch.setenv("PAYMENT_GATEWAY_PROVIDER", "SANDBOX")
    gw_sandbox = get_active_gateway()
    assert isinstance(gw_sandbox, SandboxGateway)

