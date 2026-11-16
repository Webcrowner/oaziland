"""identity.staff_views — the API for owners giving staff limited access, and staff working on those accounts."""
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import StaffAccess
from .staff_access import (
    StaffAccessError, activity, end_staff_access, grant_payload, invite_staff, my_staff_overview, respond_to_invitation,
    start_staff_session, update_staff,
)


def _error(e):
    return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


def _not_in_staff_session(request):
    # Staff-session tokens never reach these views (they're blocked in DelegatedJWTAuthentication); this keeps it explicit.
    return getattr(request._request, "staff_grant", None) is None


class StaffAccessListView(APIView):
    """GET: who helps on my account and whose accounts I help on. POST {identifier, permissions, title?, expires_on?}:
    invite someone (by username or phone)."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(my_staff_overview(request.user))

    @extend_schema(request=dict, responses={201: dict, 400: dict})
    def post(self, request):
        if not _not_in_staff_session(request):
            return Response({"detail": "Staff can't add other staff."}, status=status.HTTP_403_FORBIDDEN)
        try:
            grant = invite_staff(
                owner=request.user, identifier=str(request.data.get("identifier", "")), permissions=request.data.get("permissions"),
                title=str(request.data.get("title", "")), expires_on=request.data.get("expires_on"),
            )
        except StaffAccessError as e:
            return _error(e)
        return Response(grant_payload(grant, request.user), status=status.HTTP_201_CREATED)


class StaffAccessActionView(APIView):
    """POST /api/staff-access/<id>/<action>/: update | remove | accept | decline | leave | switch. GET .../activity/."""
    permission_classes = [permissions.IsAuthenticated]

    def _grant(self, request, grant_id):
        grant = StaffAccess.objects.select_related("owner", "staff").filter(pk=grant_id).first()
        if grant is None or request.user.pk not in (grant.owner_id, grant.staff_id):
            return None
        return grant

    @extend_schema(responses={200: dict, 404: dict})
    def get(self, request, grant_id, action):
        grant = self._grant(request, grant_id)
        if grant is None or action != "activity":
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            return Response({"results": activity(grant, request.user)})
        except StaffAccessError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

    @extend_schema(request=dict, responses={200: dict, 400: dict, 404: dict})
    def post(self, request, grant_id, action):
        grant = self._grant(request, grant_id)
        if grant is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        user, data = request.user, request.data
        try:
            if action == "update":
                update_staff(
                    grant=grant, owner=user, permissions=data.get("permissions"),
                    title=data.get("title") if "title" in data else None,
                    expires_on=data.get("expires_on") if "expires_on" in data else "unchanged",
                )
            elif action in ("remove", "leave"):
                end_staff_access(grant=grant, by=user)
            elif action in ("accept", "decline"):
                respond_to_invitation(grant=grant, staff=user, accept=action == "accept")
            elif action == "switch":
                return Response(start_staff_session(grant=grant, staff=user))
            else:
                return Response({"detail": "Unknown action."}, status=status.HTTP_404_NOT_FOUND)
        except StaffAccessError as e:
            return _error(e)
        grant.refresh_from_db()
        return Response(grant_payload(grant, user))


class StaffSessionView(APIView):
    """GET: in a staff session, whose account is being managed and with which permissions; otherwise {active: false}."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        grant = getattr(request._request, "staff_grant", None)
        if grant is None:
            return Response({"active": False})
        return Response({"active": True, **grant_payload(grant, grant.staff)})


class PlatformSessionView(APIView):
    """GET: whether you may manage Oaziland's own offers, and which account that is.
    POST: switch into a one-hour platform session (see identity.platform_account) — returns its access token."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .platform_account import can_act_as_platform, get_platform_account

        if not can_act_as_platform(request.user):
            return Response({"can_act": False})
        account = get_platform_account()
        return Response({"can_act": True, "account": {"id": str(account.pk), "username": account.username, "name": account.full_name}})

    @extend_schema(request=None, responses={201: dict, 403: dict})
    def post(self, request):
        from .platform_account import PlatformAccountError, start_platform_session
        from trust_safety.models import AuditLog

        if getattr(request._request, "staff_grant", None) is not None:
            return Response({"detail": "Switch back to your own account first."}, status=status.HTTP_403_FORBIDDEN)
        try:
            session = start_platform_session(request.user)
        except PlatformAccountError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        AuditLog.objects.create(
            actor=request.user, actor_username=request.user.username, action="platform-account session started",
            target_type="platform_account", target_id=session["account"]["id"], target_label="Oaziland", status_code=201,
            ip_address=request.META.get("REMOTE_ADDR") or None,
        )
        return Response(session, status=status.HTTP_201_CREATED)
