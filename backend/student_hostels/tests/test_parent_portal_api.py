"""Tests for the real parent/guardian portal API — grant_parent_
guardian_access()/get_parent_visible_data() were fully built and unit-
tested, but nothing let a student grant access or a parent view it."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_student_grants_and_revokes_parent_access_via_api():
    student = User.objects.create(username="parent_portal_student", phone="+237699820001")
    parent = User.objects.create(username="parent_portal_parent", phone="+237699820002")
    outsider = User.objects.create(username="parent_portal_outsider", phone="+237699820003")

    grant_response = _auth_client(student).post("/api/my-parent-access-grants/", {"parent_user_id": str(parent.id)})
    assert grant_response.status_code == 201
    grant_id = grant_response.data["id"]

    # The student sees the grant they just gave in their own list.
    list_response = _auth_client(student).get("/api/my-parent-access-grants/")
    assert any(g["id"] == grant_id for g in list_response.data)

    # Before revoking, the parent can see the student's data.
    view_response = _auth_client(parent).get(f"/api/parent-portal/{student.id}/")
    assert view_response.status_code == 200
    assert "welfare_status" in view_response.data

    # An unrelated parent still can't see anything.
    denied_response = _auth_client(outsider).get(f"/api/parent-portal/{student.id}/")
    assert denied_response.status_code == 403

    # The parent can discover which students granted them access —
    # without ever needing to already know the student's raw user id.
    guardian_list_response = _auth_client(parent).get("/api/my-guardian-accesses/")
    assert any(g["id"] == grant_id and g["student"] == student.id for g in guardian_list_response.data)

    revoke_response = _auth_client(student).delete(f"/api/my-parent-access-grants/?grant_id={grant_id}")
    assert revoke_response.status_code == 200

    after_revoke = _auth_client(parent).get(f"/api/parent-portal/{student.id}/")
    assert after_revoke.status_code == 403

    # A revoked grant no longer appears in the parent's discovery list.
    guardian_list_after_revoke = _auth_client(parent).get("/api/my-guardian-accesses/")
    assert not any(g["id"] == grant_id for g in guardian_list_after_revoke.data)


@pytest.mark.django_db
def test_only_the_granting_student_can_revoke_access():
    student = User.objects.create(username="parent_portal_student2", phone="+237699820004")
    parent = User.objects.create(username="parent_portal_parent2", phone="+237699820005")
    other_student = User.objects.create(username="parent_portal_other_student", phone="+237699820006")

    grant_response = _auth_client(student).post("/api/my-parent-access-grants/", {"parent_user_id": str(parent.id)})
    grant_id = grant_response.data["id"]

    response = _auth_client(other_student).delete(f"/api/my-parent-access-grants/?grant_id={grant_id}")
    assert response.status_code == 403
