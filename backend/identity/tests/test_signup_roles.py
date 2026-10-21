"""Signup lets a person say what they want to do; the matching role is granted, default is a normal user."""
import pytest
from rest_framework.test import APIClient

from identity.models import User, TechnicianProfile, LandlordProfile, AgentProfile, StudentProfile
from identity.services import grant_role
from marketplace.models import DriverProfile


def _register(role=None, n=1):
    payload = {"username": f"su_user_{n}", "phone": f"+23769900{n:04d}", "password": "StrongPass123!"}
    if role is not None:
        payload["role"] = role
    return APIClient().post("/api/auth/register/", payload, format="json")


def _roles(user):
    return {
        "landlord": hasattr(user, "landlord_profile"), "agent": hasattr(user, "agent_profile"),
        "student": hasattr(user, "student_profile"), "technician": hasattr(user, "technician_profile"),
        "driver": hasattr(user, "driver_profile"),
    }


@pytest.mark.django_db
def test_default_signup_is_a_normal_user_with_no_extra_role():
    response = _register(n=1)
    assert response.status_code == 201
    assert "role" not in response.data
    assert not any(_roles(User.objects.get(username="su_user_1")).values())


@pytest.mark.django_db
def test_explicit_renter_is_also_a_normal_user():
    assert _register("renter", n=2).status_code == 201
    assert not any(_roles(User.objects.get(username="su_user_2")).values())


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["landlord", "agent", "student", "technician", "driver"])
def test_picking_a_role_grants_only_that_role(role):
    assert _register(role, n=3).status_code == 201
    roles = _roles(User.objects.get(username="su_user_3"))
    assert roles[role] is True
    assert sum(roles.values()) == 1


@pytest.mark.django_db
def test_vetted_roles_start_unverified():
    _register("technician", n=4)
    _register("driver", n=5)
    assert TechnicianProfile.objects.get(user__username="su_user_4").is_verified is False
    assert DriverProfile.objects.get(user__username="su_user_5").is_verified is False


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["admin", "agency", "superuser", ""])
def test_privileged_or_unknown_roles_cannot_be_self_assigned(role):
    response = _register(role, n=6)
    assert response.status_code == 400
    assert not User.objects.filter(username="su_user_6").exists()


@pytest.mark.django_db
def test_grant_role_adds_roles_without_removing_existing_ones():
    user = User.objects.create(username="su_multi", phone="+237699900099")
    grant_role(user, "landlord")
    grant_role(user, "student", institution_name="UY1")
    grant_role(user, "landlord")  # idempotent
    user.refresh_from_db()
    assert LandlordProfile.objects.filter(user=user).count() == 1
    assert StudentProfile.objects.get(user=user).institution_name == "UY1"
    assert not hasattr(user, "agent_profile")
    with pytest.raises(ValueError):
        grant_role(user, "emperor")
