import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

from transactions.locks import InMemoryLockClient, RedisLockClient


def test_in_memory_lock_only_releases_for_its_owner():
    client = InMemoryLockClient()
    key = "booking-lock:test:1"

    assert client.acquire_owned(key, 60, "first") is True
    client.release_owned(key, "stale")
    assert client.acquire_owned(key, 60, "second") is False
    client.release_owned(key, "first")
    assert client.acquire_owned(key, 60, "second") is True
    client.release_owned(key, "second")


def test_redis_lock_uses_compare_and_delete(monkeypatch):
    redis_client = MagicMock()
    redis_client.set.return_value = True
    monkeypatch.setitem(
        sys.modules,
        "redis",
        SimpleNamespace(Redis=SimpleNamespace(from_url=lambda url: redis_client)),
    )
    client = RedisLockClient("redis://example/0")

    assert client.acquire_owned("booking-lock:test:2", 420, "booking-token") is True
    client.release_owned("booking-lock:test:2", "booking-token")

    redis_client.set.assert_called_once_with(
        "booking-lock:test:2", "booking-token", nx=True, ex=420,
    )
    assert redis_client.eval.call_args.args[-2:] == ("booking-lock:test:2", "booking-token")
