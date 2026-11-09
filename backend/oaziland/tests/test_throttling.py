"""Admins get their own, larger rate-limit budget so a working console isn't throttled into "Access Denied"."""
import pytest
from django.core.cache import cache
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from identity.models import AdminProfile, User
from oaziland.throttling import RoleAwareUserRateThrottle


class _View(APIView):
    pass


def _allowed(user, rates, times):
    class Throttle(RoleAwareUserRateThrottle):
        THROTTLE_RATES = {"user": rates[0], "admin": rates[1]}

    request = APIRequestFactory().get("/")
    force_authenticate(request, user=user)
    drf_request = _View().initialize_request(request)
    return [Throttle().allow_request(drf_request, _View()) for _ in range(times)]


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
def test_ordinary_user_keeps_the_user_budget():
    user = User.objects.create(username="thr_user", phone="+237699940001", email="thr_user@example.com")
    assert _allowed(user, ("2/hour", "5/hour"), 3) == [True, True, False]


@pytest.mark.django_db
def test_admin_uses_the_larger_admin_budget():
    user = User.objects.create(username="thr_admin", phone="+237699940002", email="thr_admin@example.com")
    AdminProfile.objects.create(user=user)
    assert _allowed(user, ("2/hour", "5/hour"), 6) == [True] * 5 + [False]


def test_settings_define_an_admin_rate():
    from django.conf import settings

    rest = settings.REST_FRAMEWORK
    assert "oaziland.throttling.RoleAwareUserRateThrottle" in rest["DEFAULT_THROTTLE_CLASSES"]
    assert "admin" in rest["DEFAULT_THROTTLE_RATES"]
