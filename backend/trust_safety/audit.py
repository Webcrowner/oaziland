"""
trust_safety.audit — records every action an admin takes in the admin console.

AdminAuditMiddleware watches state-changing API calls (POST/PUT/PATCH/DELETE)
that were handled by an admin-only view and made by someone holding an
AdminProfile, and writes one AuditLog row per call: who, what, which object,
the outcome (HTTP status, so blocked attempts are visible too), the caller's IP
and a small whitelist of request fields (reasons, durations, roles — never
passwords or free-form payloads). Views can add a readable target name with
audit_note(). Failures to write the log never affect the response.
"""
import logging

from oaziland.permissions import IsAdminRole

logger = logging.getLogger(__name__)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# The only request fields copied into the log, so nothing sensitive can leak in.
LOGGED_FIELDS = (
    "reason", "days", "role", "suspend", "outcome", "notes", "action_taken", "issue_strike", "decision", "status",
    "area_name", "city_name", "student", "room_code", "payer_amount_xaf",
)
MAX_VALUE_LENGTH = 300


def audit_note(request, *, target_label: str = "", target_type: str = "", **details) -> None:
    """Lets a view enrich the audit entry for the current request, e.g.
    audit_note(request, target_label=user.username, target_type="user")."""
    # DRF wraps the Django request; the middleware reads the underlying one.
    target = getattr(request, "_request", request)
    note = getattr(target, "_audit_note", None)
    if note is None:
        note = target._audit_note = {"details": {}}
    if target_label:
        note["target_label"] = target_label
    if target_type:
        note["target_type"] = target_type
    note["details"].update({key: value for key, value in details.items() if value not in (None, "")})


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    candidate = forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR", "")
    return candidate or None


def _clean(value):
    if isinstance(value, str):
        return value[:MAX_VALUE_LENGTH]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return str(value)[:MAX_VALUE_LENGTH]


class AdminAuditMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.method in UNSAFE_METHODS:
            try:
                self._record(request, response)
            except Exception:
                logger.exception("Could not write the admin audit entry")
        return response

    def _record(self, request, response):
        context = getattr(response, "renderer_context", None) or {}
        view = context.get("view")
        if view is None or not self._is_admin_view(view):
            return

        user = getattr(request, "user", None)
        if not (user and user.is_authenticated and hasattr(user, "admin_profile")):
            return

        from .models import AuditLog

        drf_request = context.get("request")
        data = getattr(drf_request, "data", None)
        details = {}
        if hasattr(data, "get"):
            for key in LOGGED_FIELDS:
                value = data.get(key)
                if value not in (None, ""):
                    details[key] = _clean(value)

        note = getattr(request, "_audit_note", None) or {}
        details.update({key: _clean(value) for key, value in note.get("details", {}).items()})

        kwargs = getattr(getattr(request, "resolver_match", None), "kwargs", None) or {}
        basename = getattr(view, "basename", None) or view.__class__.__name__
        verb = getattr(view, "action", None) or request.method.lower()

        AuditLog.objects.create(
            actor=user,
            actor_username=user.username,
            action=f"{basename}/{verb}"[:120],
            target_type=(note.get("target_type") or basename)[:60],
            target_id=str(kwargs.get("pk", ""))[:64],
            target_label=(note.get("target_label") or "")[:200],
            details=details,
            status_code=response.status_code,
            ip_address=_client_ip(request),
        )

    @staticmethod
    def _is_admin_view(view) -> bool:
        if getattr(view, "audit_admin_actions", False):
            return True  # a shared (owner + admin) view that asks for admins' actions to be recorded
        try:
            return any(isinstance(permission, IsAdminRole) for permission in view.get_permissions())
        except Exception:
            return False
