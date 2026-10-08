"""Tests for the real agency-roster-management API — the RBAC matrix's
"Manage agent roster ✅ (own agency)" had add_agent_to_agency()/
remove_agent_from_agency() fully built and unit-tested, but
agency-dashboard could only ever VIEW the roster; nothing let an
agency owner actually add or remove an agent."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, AgencyProfile, AgentProfile


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_agency_owner_can_add_and_remove_an_agent():
    agency_user = User.objects.create(username="roster_agency_owner", phone="+237699500101")
    agency = AgencyProfile.objects.create(user=agency_user, registration_number="RC-ROSTER-001", agency_commission_percent=Decimal("30"))
    agent_user = User.objects.create(username="roster_independent_agent", phone="+237699500102")
    AgentProfile.objects.create(user=agent_user, agent_commission_percent=Decimal("10"))

    add_response = _auth_client(agency_user).post("/api/my-agency-dashboard/add-agent/", {"agent_user_id": str(agent_user.id)})
    assert add_response.status_code == 200
    agent_user.agent_profile.refresh_from_db()
    assert agent_user.agent_profile.agency_id == agency.id

    remove_response = _auth_client(agency_user).post("/api/my-agency-dashboard/remove-agent/", {"agent_user_id": str(agent_user.id)})
    assert remove_response.status_code == 200
    agent_user.agent_profile.refresh_from_db()
    assert agent_user.agent_profile.agency_id is None


@pytest.mark.django_db
def test_an_agent_can_remove_themselves_from_a_roster():
    agency_user = User.objects.create(username="roster_self_leave_agency", phone="+237699500103")
    agency = AgencyProfile.objects.create(user=agency_user, registration_number="RC-ROSTER-002", agency_commission_percent=Decimal("30"))
    agent_user = User.objects.create(username="roster_self_leave_agent", phone="+237699500104")
    AgentProfile.objects.create(user=agent_user, agency=agency, agent_commission_percent=Decimal("10"))

    response = _auth_client(agent_user).post("/api/my-agency-dashboard/remove-agent/", {"agent_user_id": str(agent_user.id)})

    assert response.status_code == 200
    agent_user.agent_profile.refresh_from_db()
    assert agent_user.agent_profile.agency_id is None


@pytest.mark.django_db
def test_an_outsider_cannot_add_an_agent_to_someone_elses_agency():
    other_agency_user = User.objects.create(username="roster_outsider_agency", phone="+237699500105")
    AgencyProfile.objects.create(user=other_agency_user, registration_number="RC-ROSTER-003", agency_commission_percent=Decimal("30"))
    agent_user = User.objects.create(username="roster_targeted_agent", phone="+237699500106")
    AgentProfile.objects.create(user=agent_user, agent_commission_percent=Decimal("10"))
    outsider = User.objects.create(username="roster_plain_outsider", phone="+237699500107")

    response = _auth_client(outsider).post("/api/my-agency-dashboard/add-agent/", {"agent_user_id": str(agent_user.id)})

    assert response.status_code == 403
    agent_user.agent_profile.refresh_from_db()
    assert agent_user.agent_profile.agency_id is None


@pytest.mark.django_db
def test_a_different_agencys_owner_cannot_remove_an_agent_not_on_their_roster():
    agency_a_user = User.objects.create(username="roster_agency_a", phone="+237699500108")
    AgencyProfile.objects.create(user=agency_a_user, registration_number="RC-ROSTER-004", agency_commission_percent=Decimal("30"))
    agency_b_user = User.objects.create(username="roster_agency_b", phone="+237699500109")
    agency_b = AgencyProfile.objects.create(user=agency_b_user, registration_number="RC-ROSTER-005", agency_commission_percent=Decimal("30"))
    agent_user = User.objects.create(username="roster_b_agent", phone="+237699500110")
    AgentProfile.objects.create(user=agent_user, agency=agency_b, agent_commission_percent=Decimal("10"))

    response = _auth_client(agency_a_user).post("/api/my-agency-dashboard/remove-agent/", {"agent_user_id": str(agent_user.id)})

    assert response.status_code == 403
