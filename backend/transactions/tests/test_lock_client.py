"""The booking lock: Redis in production, an in-memory stand-in only in development, a clear 503 when it is down."""
import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from transactions import locks
from transactions.locks import LockUnavailableError


def _lock_client(monkeypatch):
    """get_booking_lock_client() as it behaves outside the test suite (pytest sets PYTEST_CURRENT_TEST per test)."""
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(locks, "_redis_down_until", 0.0)
    return locks.get_booking_lock_client()


@override_settings(DEBUG=True)
def test_development_without_redis_uses_the_in_memory_lock(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://localhost:1/0")
    monkeypatch.setattr(locks, "_redis_reachable", lambda url: False)
    assert _lock_client(monkeypatch) is locks._dev_fallback
    monkeypatch.delenv("REDIS_URL")
    assert _lock_client(monkeypatch) is locks._dev_fallback


@override_settings(DEBUG=True)
def test_development_uses_redis_when_it_is_there(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(locks, "_redis_reachable", lambda url: True)
    assert isinstance(_lock_client(monkeypatch), locks.RedisLockClient)


@override_settings(DEBUG=False)
def test_production_never_falls_back_to_memory(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    with pytest.raises(LockUnavailableError):
        _lock_client(monkeypatch)
    monkeypatch.setenv("REDIS_URL", "redis://localhost:1/0")
    monkeypatch.setattr(locks, "_redis_reachable", lambda url: pytest.fail("production must not probe or fall back"))
    assert isinstance(_lock_client(monkeypatch), locks.RedisLockClient)


def test_a_redis_outage_is_reported_as_unavailable_and_answered_with_503():
    import redis

    class Down:
        def set(self, *a, **k):
            raise redis.exceptions.ConnectionError("refused")

        def eval(self, *a, **k):
            raise redis.exceptions.ConnectionError("refused")

    client = locks.RedisLockClient("redis://localhost:1/0")
    client.client = Down()
    with pytest.raises(LockUnavailableError):
        client.acquire_owned("k", 5, "t")
    client.release_owned("k", "t")  # releasing early is best effort: the lock expires by itself

    from oaziland.exceptions import exception_handler
    handled = exception_handler(LockUnavailableError("down"), {"request": None})
    assert handled.status_code == 503 and "Nothing was charged" in handled.data["detail"]
