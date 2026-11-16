import os
import threading
import uuid


class InMemoryLockClient:
    _locked = {}
    _guard = threading.Lock()

    def acquire(self, key, ttl_seconds):
        with self._guard:
            if key in self._locked:
                return False
            self._locked[key] = None
            return True

    def release(self, key, permanent=False):
        with self._guard:
            self._locked.pop(key, None)

    def acquire_owned(self, key, ttl_seconds, owner_token):
        with self._guard:
            if key in self._locked:
                return False
            self._locked[key] = owner_token
            return True

    def release_owned(self, key, owner_token):
        with self._guard:
            if self._locked.get(key) == owner_token:
                self._locked.pop(key, None)


class RedisLockClient:
    def __init__(self, url: str):
        import redis

        self.client = redis.Redis.from_url(url)
        self.tokens = {}

    def acquire(self, key, ttl_seconds):
        token = uuid.uuid4().hex
        return self.acquire_owned(key, ttl_seconds, token)

    def acquire_owned(self, key, ttl_seconds, owner_token):
        import redis

        try:
            acquired = bool(self.client.set(key, owner_token, nx=True, ex=ttl_seconds))
        except redis.exceptions.RedisError as exc:
            raise LockUnavailableError("The lock service is unreachable.") from exc
        if acquired:
            self.tokens[key] = owner_token
        return acquired

    def release(self, key, permanent=False):
        token = self.tokens.pop(key, None)
        if token is None:
            return
        self.release_owned(key, token)

    def release_owned(self, key, owner_token):
        import redis

        self.tokens.pop(key, None)
        try:
            self.client.eval(
                """
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                end
                return 0
                """,
                1,
                key,
                owner_token,
            )
        except redis.exceptions.RedisError:
            # The lock expires by itself; failing to release it early must never break the action that finished.
            pass


_test_lock = InMemoryLockClient()
_dev_fallback = InMemoryLockClient()
_REDIS_RETRY_SECONDS = 30
_redis_down_until = 0.0


class LockUnavailableError(Exception):
    """The lock service (Redis) can't be reached, so a payment can't be started safely. The API answers 503 and
    nothing is charged."""


def _redis_reachable(url: str) -> bool:
    import redis

    try:
        redis.Redis.from_url(url, socket_connect_timeout=1, socket_timeout=1).ping()
        return True
    except redis.exceptions.RedisError:
        return False


def get_booking_lock_client():
    global _redis_down_until
    import logging
    import time

    from django.conf import settings

    if "PYTEST_CURRENT_TEST" in os.environ:
        return _test_lock
    redis_url = os.environ.get("REDIS_URL", "").strip()
    if settings.DEBUG:
        # Local development without Redis: one process, so an in-memory lock is safe. Never done in production,
        # where several workers share the lock and a silent fallback would allow double-booking.
        if not redis_url or time.monotonic() < _redis_down_until or not _redis_reachable(redis_url):
            if redis_url and time.monotonic() >= _redis_down_until:
                logging.getLogger(__name__).warning("Redis is not reachable at %s: using an in-memory booking lock (development only).", redis_url)
                _redis_down_until = time.monotonic() + _REDIS_RETRY_SECONDS
            return _dev_fallback
    elif not redis_url:
        raise LockUnavailableError("REDIS_URL must be configured for booking and marketplace payments.")
    return RedisLockClient(redis_url)
