"""A Redis cache that fails open: if Redis is unreachable, reads miss and writes are skipped instead of raising.

The cache holds rate-limit counters and the once-an-hour view marker, so an outage should mean "limits are briefly
not enforced", not "every API request returns a 500"."""
import logging

from django.core.cache.backends.redis import RedisCache
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)


def _fail_open(default):
    def decorate(method):
        def wrapper(self, *args, **kwargs):
            try:
                return method(self, *args, **kwargs)
            except RedisError:
                logger.warning("Redis cache unavailable; %s skipped.", method.__name__, exc_info=True)
                return default() if callable(default) else default
        wrapper.__name__ = method.__name__
        return wrapper
    return decorate


class FailOpenRedisCache(RedisCache):
    get = _fail_open(lambda: None)(RedisCache.get)
    add = _fail_open(False)(RedisCache.add)
    set = _fail_open(None)(RedisCache.set)
    delete = _fail_open(False)(RedisCache.delete)
    get_many = _fail_open(dict)(RedisCache.get_many)
    set_many = _fail_open(list)(RedisCache.set_many)
    has_key = _fail_open(False)(RedisCache.has_key)
    incr = _fail_open(None)(RedisCache.incr)
    touch = _fail_open(False)(RedisCache.touch)
