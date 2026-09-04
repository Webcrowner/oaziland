"""
agency.views — public agent/agency profiles (no login required, same
as browsing a listing) and the private, logged-in-only dashboard.
"""
from rest_framework import views, permissions
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from identity.models import User, AgencyProfile
from .services import get_agent_public_profile, get_agency_public_profile, get_agent_private_dashboard


class AgentPublicProfileView(views.APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict, 404: dict})
    def get(self, request, user_id):
        try:
            agent_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"detail": "Agent not found."}, status=404)
        return Response(get_agent_public_profile(agent_user))


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
