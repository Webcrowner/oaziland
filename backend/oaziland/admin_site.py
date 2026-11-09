"""
oaziland.admin_site — the Django data admin (/admin/) without a login of its own.

Admins sign in only on the website's admin console (/<locale>/admin/login). From there the console asks
DataAdminTicketView for a one-time pass (signed, 60 seconds, usable once) and opens /admin/sso/?ticket=…,
which starts a short data-admin session. Django's own login page sends people to the console login; its
password-change page sends them to the website's security page, where passwords are managed.
"""
import secrets
from urllib.parse import quote, urlencode

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import REDIRECT_FIELD_NAME, get_user_model, login, logout
from django.core import signing
from django.core.cache import cache
from django.shortcuts import redirect
from django.urls import path, reverse
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from oaziland.permissions import IsSuperAdmin

TICKET_SALT = "oaziland.data-admin-sso"
TICKET_MAX_AGE = 60  # seconds
SESSION_SECONDS = 60 * 60  # the data-admin session ends after an hour, or when the browser closes


def can_use_admin(request) -> bool:
    """Full-access administrators only; limited admins and plain staff accounts see nothing."""
    from identity.services import is_super_admin

    user = getattr(request, "user", None)
    return bool(user and user.is_active and is_super_admin(user))


def _safe_admin_path(value: str) -> str:
    """Only paths inside the data admin are followed after signing in."""
    index = reverse("admin:index")
    if value and value.startswith(index) and "//" not in value and "\\" not in value:
        return value
    return index


def _console_login_url(next_path: str = "") -> str:
    query = {"to": "data-admin"}
    if next_path:
        query["next"] = _safe_admin_path(next_path)
    return f"{settings.WEB_BASE_URL}/en/admin/login?{urlencode(query, quote_via=quote)}"


def issue_ticket(user) -> str:
    return signing.dumps({"u": str(user.pk), "n": secrets.token_urlsafe(16)}, salt=TICKET_SALT)


def redeem_ticket(ticket: str):
    """The full-access admin a valid, unused, unexpired ticket was issued to — or None."""
    try:
        data = signing.loads(ticket or "", salt=TICKET_SALT, max_age=TICKET_MAX_AGE)
    except signing.BadSignature:
        return None
    if not cache.add(f"data-admin-ticket:{data.get('n')}", True, TICKET_MAX_AGE * 2):
        return None  # already used
    from identity.services import is_super_admin

    user = get_user_model().objects.filter(pk=data.get("u")).first()
    if user is None or not user.is_active or not is_super_admin(user):
        return None
    return user


class OaziAdminSite(admin.AdminSite):
    site_header = "Oaziland data admin"
    site_title = "Oaziland data admin"
    index_title = "Records (full-access administrators only)"

    def has_permission(self, request):
        return can_use_admin(request)

    def each_context(self, request):
        context = super().each_context(request)
        context["site_url"] = f"{settings.WEB_BASE_URL}/en/admin"
        return context

    def login(self, request, extra_context=None):
        next_path = request.GET.get(REDIRECT_FIELD_NAME, "")
        if request.method == "GET" and self.has_permission(request):
            return redirect(_safe_admin_path(next_path))
        # No username/password form here: the console is the only place to sign in.
        return redirect(_console_login_url(next_path))

    def logout(self, request, extra_context=None):
        if request.method == "POST":
            logout(request)
        return redirect(f"{settings.WEB_BASE_URL}/en/admin")

    def password_change(self, request, extra_context=None):
        return redirect(f"{settings.WEB_BASE_URL}/en/security")

    def password_change_done(self, request, extra_context=None):
        return redirect(f"{settings.WEB_BASE_URL}/en/security")

    def sso(self, request):
        user = redeem_ticket(request.GET.get("ticket", ""))
        next_path = request.GET.get("next", "")
        if user is None:
            return redirect(_console_login_url(next_path))
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        request.session.set_expiry(SESSION_SECONDS)
        return redirect(_safe_admin_path(next_path))

    def get_urls(self):
        return [path("sso/", self.sso, name="sso"), *super().get_urls()]


class DataAdminTicketView(APIView):
    """POST {next?} → {url}: a one-time link that signs the calling full-access admin in to the data admin."""
    permission_classes = [IsSuperAdmin]

    @extend_schema(request=None, responses={200: dict})
    def post(self, request):
        next_path = _safe_admin_path(str(request.data.get("next", "") or ""))
        query = urlencode({"ticket": issue_ticket(request.user), "next": next_path})
        return Response({"url": f"{settings.BACKEND_BASE_URL}{reverse('admin:sso')}?{query}"})
