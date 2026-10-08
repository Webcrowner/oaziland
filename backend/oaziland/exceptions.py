"""
oaziland.exceptions — a single, shared DRF exception handler.

WHY this exists: without it, DRF's default handler is fine for most
validation errors, but any UNHANDLED exception (a bug, a bad external
call) falls all the way through to Django's own error page — which,
outside DEBUG, is a bare empty 500 with no useful JSON body for the
frontend to show a real message from, and inside DEBUG would leak a
full Python traceback to the client. This wraps the default handler so
every API error — expected or not — comes back as the same clean,
predictable JSON shape the frontend already expects ({"detail": ...}),
and logs the real exception server-side either way.
"""
import logging

from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger("oaziland.exceptions")


def exception_handler(exc, context):
    """Delegates to DRF's own handler for anything it already knows how
    to turn into a clean response (validation errors, 403/404/etc.).
    Only steps in for the case DRF's handler returns None — an
    exception it doesn't recognize, which would otherwise become a raw
    Django 500 page instead of a JSON error the frontend can read."""
    response = drf_exception_handler(exc, context)

    if response is not None:
        return response

    request = context.get("request")
    logger.exception(
        "Unhandled exception in view", extra={"path": getattr(request, "path", None)}
    )
    return Response(
        {"detail": "An unexpected server error occurred. Please try again."},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
