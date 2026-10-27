from django.test import override_settings

from payments.checks import warn_about_incomplete_payment_setup

LIVE_ENV = {
    "PAYMENT_GATEWAY_PROVIDER": "FAPSHI",
    "FAPSHI_API_USER": "user",
    "FAPSHI_API_KEY": "key",
    "FAPSHI_BASE_URL": "https://live.fapshi.com",
    "FAPSHI_ALLOW_TEST_FALLBACK": "False",
    "REDIS_URL": "redis://localhost:6379/0",
}


def _set_env(monkeypatch, **overrides):
    for key, value in {**LIVE_ENV, **overrides}.items():
        monkeypatch.setenv(key, value)


@override_settings(DEBUG=False)
def test_a_complete_live_setup_raises_no_warning(monkeypatch):
    _set_env(monkeypatch)
    assert warn_about_incomplete_payment_setup(None) == []


@override_settings(DEBUG=False)
def test_every_missing_piece_is_named(monkeypatch):
    _set_env(monkeypatch, PAYMENT_GATEWAY_PROVIDER="SANDBOX", REDIS_URL="")
    (warning,) = warn_about_incomplete_payment_setup(None)
    assert warning.id == "payments.W001"
    assert "SANDBOX" in warning.msg and "REDIS_URL" in warning.msg
    assert "/api/webhooks/payment/" in warning.hint


@override_settings(DEBUG=False)
def test_fapshi_with_sandbox_url_missing_credentials_and_fallback_is_flagged(monkeypatch):
    _set_env(
        monkeypatch, FAPSHI_API_KEY="", FAPSHI_BASE_URL="https://sandbox.fapshi.com", FAPSHI_ALLOW_TEST_FALLBACK="true",
    )
    (warning,) = warn_about_incomplete_payment_setup(None)
    assert "FAPSHI_API_KEY" in warning.msg and "sandbox" in warning.msg and "FAPSHI_ALLOW_TEST_FALLBACK" in warning.msg


@override_settings(DEBUG=True)
def test_nothing_is_raised_in_local_development(monkeypatch):
    _set_env(monkeypatch, PAYMENT_GATEWAY_PROVIDER="SANDBOX", REDIS_URL="")
    assert warn_about_incomplete_payment_setup(None) == []
