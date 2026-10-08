"""
Test for oaziland.exceptions.exception_handler — the real gap this
closes: an unhandled (non-APIException) exception previously fell all
the way through to Django's raw error page instead of a clean JSON
response the frontend can actually read, and was never logged with
useful context either.
"""
import pytest
from rest_framework.test import APIRequestFactory

from oaziland.exceptions import exception_handler


@pytest.mark.django_db
def test_unhandled_exception_becomes_a_clean_json_500_not_a_raw_traceback():
    factory = APIRequestFactory()
    request = factory.get("/api/whatever/")

    response = exception_handler(ZeroDivisionError("division by zero"), {"request": request, "view": None})

    assert response is not None
    assert response.status_code == 500
    assert response.data == {"detail": "An unexpected server error occurred. Please try again."}


@pytest.mark.django_db
def test_known_drf_exceptions_still_use_the_normal_handler():
    """Sanity check: this wrapper must not break DRF's own well-known
    error responses (404/403/400/etc.) — it should only step in when
    DRF's handler returns None."""
    from rest_framework.exceptions import NotFound

    factory = APIRequestFactory()
    request = factory.get("/api/whatever/")

    response = exception_handler(NotFound("Not found."), {"request": request, "view": None})

    assert response is not None
    assert response.status_code == 404
    assert response.data == {"detail": "Not found."}
