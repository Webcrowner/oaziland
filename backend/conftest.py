"""
Project-wide pytest configuration.

WHY this exists: DRF's throttle classes (ScopedRateThrottle, used on
the search endpoint) store their counters in Django's cache backend,
which persists for the lifetime of the test process by default —
NOT reset between individual test functions. As the test suite grows,
enough cumulative unauthenticated requests to a throttled endpoint
across UNRELATED tests can eventually trip that endpoint's rate limit
in a later, otherwise-correct test — a test-infrastructure gap, not a
real bug in the endpoint itself. Clearing the cache before every test
is the standard fix.
"""
import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def clear_cache_between_tests():
    cache.clear()
    yield
    cache.clear()
