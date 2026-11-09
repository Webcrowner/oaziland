"""
agency.views — public agent/agency profiles (no login required, same
as browsing a listing) and the private, logged-in-only dashboard.
"""
from rest_framework import views, permissions
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from identity.models import User, AgencyProfile
from .services import (
    get_agent_public_profile, get_agency_public_profile, get_agent_private_dashboard,
    get_agency_private_dashboard, resolve_caller_agency, add_agent_to_agency, remove_agent_from_agency,
)


class AgentDirectoryView(views.APIView):
    """The searchable agent directory. GET ?q= (name, agency, area or bio words) &quarter= &specialty= &language=
    &verified=1 &page= — 12 agents a page, each with their latest few listings."""
    permission_classes = [permissions.AllowAny]
    PAGE_SIZE = 12

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .agent_profiles import directory_rows, search_agents

        params = request.query_params
        quarter = params.get("quarter", "").strip()
        try:
            import uuid
            quarter = str(uuid.UUID(quarter)) if quarter else None
        except ValueError:
            quarter = None
        queryset = search_agents(
            query=params.get("q", "").strip()[:100], quarter_id=quarter, specialty=params.get("specialty", ""),
            language=params.get("language", ""), verified_only=params.get("verified") in ("1", "true"),
        )
        try:
            page = max(1, int(params.get("page", 1)))
        except ValueError:
            page = 1
        total = queryset.count()
        start = (page - 1) * self.PAGE_SIZE
        rows = directory_rows(queryset[start:start + self.PAGE_SIZE])
        return Response({"count": total, "page": page, "has_more": start + len(rows) < total, "results": rows})


class AgencyDirectoryView(views.APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict})
    def get(self, request):
        agencies = AgencyProfile.objects.select_related("user").order_by("-user__date_joined")
        results = [{"agency_id": str(a.id), **get_agency_public_profile(a)} for a in agencies]
        return Response({"count": len(results), "results": results})


class AgentPublicProfileView(views.APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict, 404: dict})
    def get(self, request, user_id):
        from .agent_profiles import public_details

        try:
            agent_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"detail": "Agent not found."}, status=404)
        return Response({**get_agent_public_profile(agent_user), **public_details(agent_user)})


class AgentListingsView(views.APIView):
    """All of an agent's live listings, paged ('See more'). GET ?offset=&limit= (max 24)."""
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict, 404: dict})
    def get(self, request, user_id):
        from .agent_profiles import agent_listings_page

        agent_user = User.objects.filter(id=user_id, agent_profile__isnull=False).first()
        if agent_user is None:
            return Response({"detail": "Agent not found."}, status=404)
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
            limit = min(24, max(1, int(request.query_params.get("limit", 12))))
        except ValueError:
            offset, limit = 0, 12
        return Response(agent_listings_page(agent_user, offset=offset, limit=limit))


class MyAgentProfileView(views.APIView):
    """The signed-in agent's own public details. GET returns them; PATCH changes the fields given:
    bio, years_experience, specialties, languages, areas_served (quarter ids), intro_video_url + intro_video_seconds
    (an empty url removes the video)."""
    permission_classes = [permissions.IsAuthenticated]

    def _payload(self, user):
        from .agent_profiles import public_details

        details = public_details(user)
        details.pop("listings", None)
        return details

    @extend_schema(responses={200: dict, 403: dict})
    def get(self, request):
        if not hasattr(request.user, "agent_profile"):
            return Response({"detail": "This account is not an agent."}, status=403)
        return Response(self._payload(request.user))

    @extend_schema(request=dict, responses={200: dict, 400: dict, 403: dict})
    def patch(self, request):
        from .agent_profiles import AgentProfileError, update_agent_profile

        if not hasattr(request.user, "agent_profile"):
            return Response({"detail": "This account is not an agent."}, status=403)
        try:
            update_agent_profile(request.user, request.data)
        except AgentProfileError as e:
            return Response({"detail": str(e)}, status=400)
        request.user.agent_profile.refresh_from_db()
        return Response(self._payload(request.user))


class AgencyPublicProfileView(views.APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict, 404: dict})
    def get(self, request, agency_id):
        try:
            agency = AgencyProfile.objects.get(id=agency_id)
        except AgencyProfile.DoesNotExist:
            return Response({"detail": "Agency not found."}, status=404)
        return Response(get_agency_public_profile(agency))


class MyAgentDashboardView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict, 403: dict})
    def get(self, request):
        if not hasattr(request.user, "agent_profile"):
            return Response({"detail": "This account is not an agent."}, status=403)
        return Response(get_agent_private_dashboard(request.user))


class MyAgencyDashboardView(views.APIView):
    """The team-wide equivalent of MyAgentDashboardView — any
    authorized member of an agency (its owner, or any agent on its
    roster) sees the same real, aggregated team picture. Which agency
    that is gets resolved server-side from the caller's own profile;
    there's no agency id parameter for the frontend to tamper with."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict, 403: dict})
    def get(self, request):
        agency = resolve_caller_agency(request.user)
        if agency is None:
            return Response({"detail": "This account is not part of any agency."}, status=403)
        return Response(get_agency_private_dashboard(agency))


class AgencyAddAgentView(views.APIView):
    """The real gap this closes: add_agent_to_agency() existed and was
    tested, but agency-dashboard could only ever VIEW the roster — the
    RBAC matrix's 'Manage agent roster ✅ (own agency)' had no reachable
    endpoint at all. Owner-only: agency = AgencyProfile.user
    (identity.models), a real OneToOneField, not something the caller
    can fake by claiming to be 'the owner' of someone else's agency."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=dict, responses={200: dict, 403: dict, 404: dict})
    def post(self, request):
        agency = getattr(request.user, "agency_profile", None)
        if agency is None:
            return Response({"detail": "Only an agency owner can manage the roster."}, status=403)
        agent_user = User.objects.filter(id=request.data.get("agent_user_id")).first()
        if agent_user is None or not hasattr(agent_user, "agent_profile"):
            return Response({"detail": "That user is not a registered agent."}, status=404)
        add_agent_to_agency(agent=agent_user, agency=agency)
        return Response({"detail": "Agent added to the roster."})


class AgencyRemoveAgentView(views.APIView):
    """Either the agency owner OR the agent themselves can end the
    affiliation — an agent going independent shouldn't need to wait on
    the owner to remove them."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=dict, responses={200: dict, 403: dict, 404: dict})
    def post(self, request):
        agent_user = User.objects.filter(id=request.data.get("agent_user_id")).first()
        if agent_user is None or not hasattr(agent_user, "agent_profile"):
            return Response({"detail": "That user is not a registered agent."}, status=404)
        agency = getattr(request.user, "agency_profile", None)
        is_this_agents_owner = agency is not None and agent_user.agent_profile.agency_id == agency.id
        is_self = agent_user.id == request.user.id
        if not (is_this_agents_owner or is_self):
            return Response({"detail": "Only the agency owner or the agent themselves can end this affiliation."}, status=403)
        remove_agent_from_agency(agent=agent_user)
        return Response({"detail": "Agent removed from the roster."})
