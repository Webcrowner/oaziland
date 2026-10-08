"""
Tests for FacilityManagementContract and ProjectManagementCase — docs/01
§2.4 modeled these as part of the Technician/Facility Services module,
but neither had a model, endpoint, or frontend at all until this round.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_owner_can_create_a_facility_contract_and_technician_can_log_a_visit():
    owner = User.objects.create(username="facility_owner", phone="+237699700001")
    technician = User.objects.create(username="facility_technician", phone="+237699700002")
    outsider = User.objects.create(username="facility_outsider", phone="+237699700003")

    create_response = _auth_client(owner).post("/api/facility-contracts/", {
        "target_content_type": "property.PropertyAsset", "target_id": "11111111-1111-1111-1111-111111111111",
        "technician": technician.id, "scope": "Monthly plumbing and electrical upkeep.",
        "frequency": "MONTHLY", "start_date": "2026-01-01",
    })
    assert create_response.status_code == 201
    contract_id = create_response.data["id"]
    assert create_response.data["owner"] == owner.id

    # The assigned technician can see it and log a real visit.
    visit_response = _auth_client(technician).post(f"/api/facility-contracts/{contract_id}/log-visit/", {
        "notes": "Checked all taps and breaker panel — no issues.",
    })
    assert visit_response.status_code == 201
    assert visit_response.data["notes"].startswith("Checked all taps")

    # An unrelated user is neither the owner nor the technician — no visibility, no visit rights.
    outsider_list = _auth_client(outsider).get("/api/facility-contracts/")
    assert not any(c["id"] == contract_id for c in outsider_list.data["results"])

    forbidden_visit = _auth_client(outsider).post(f"/api/facility-contracts/{contract_id}/log-visit/", {"notes": "n/a"})
    assert forbidden_visit.status_code == 403


@pytest.mark.django_db
def test_project_case_milestones_and_technician_linking():
    owner = User.objects.create(username="project_owner", phone="+237699700004")
    technician = User.objects.create(username="project_technician", phone="+237699700005")
    outsider = User.objects.create(username="project_outsider", phone="+237699700006")

    create_response = _auth_client(owner).post("/api/project-cases/", {
        "title": "Bastos Duplex Renovation", "description": "Full kitchen and roof renovation.",
        "budget_xaf": "5000000",
    })
    assert create_response.status_code == 201
    case_id = create_response.data["id"]
    assert create_response.data["status"] == "PLANNING"

    # Only the owner can link a technician.
    forbidden_link = _auth_client(outsider).post(f"/api/project-cases/{case_id}/link-technician/", {"technician": technician.id})
    assert forbidden_link.status_code == 403

    link_response = _auth_client(owner).post(f"/api/project-cases/{case_id}/link-technician/", {"technician": technician.id})
    assert link_response.status_code == 200
    assert technician.full_name in link_response.data["technician_names"]

    # The linked technician can now see the project via the scoped list.
    technician_list = _auth_client(technician).get("/api/project-cases/")
    assert any(c["id"] == case_id for c in technician_list.data["results"])

    milestone_response = _auth_client(owner).post(f"/api/project-cases/{case_id}/add-milestone/", {
        "title": "Demolish old kitchen", "budget_allocation_xaf": "500000", "due_date": "2026-03-01",
    })
    assert milestone_response.status_code == 201
    assert milestone_response.data["status"] == "PENDING"
    milestone_id = milestone_response.data["id"]

    # The linked technician (who actually did the work) can mark it complete.
    complete_response = _auth_client(technician).post(f"/api/project-cases/{case_id}/complete-milestone/", {"milestone_id": milestone_id})
    assert complete_response.status_code == 200
    assert complete_response.data["status"] == "COMPLETED"
    assert complete_response.data["completed_at"] is not None
