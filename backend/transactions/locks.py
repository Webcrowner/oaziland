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
        acquired = bool(self.client.set(key, owner_token, nx=True, ex=ttl_seconds))
        if acquired:
            self.tokens[key] = owner_token
        return acquired

    def release(self, key, permanent=False):
        token = self.tokens.pop(key, None)
        if token is None:
            return
        self.release_owned(key, token)

    def release_owned(self, key, owner_token):
        self.tokens.pop(key, None)
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


_test_lock = InMemoryLockClient()


def get_booking_lock_client():
    if "PYTEST_CURRENT_TEST" in os.environ:
        return _test_lock
    redis_url = os.environ.get("REDIS_URL", "").strip()
    if not redis_url:
        raise RuntimeError("REDIS_URL must be configured for booking and marketplace payments.")
    return RedisLockClient(redis_url)
