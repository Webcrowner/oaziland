import pytest
from rest_framework.test import APIClient
from identity.models import User, LandlordProfile, AgentProfile


def _client():
    user = User.objects.create_user(username="switcher", phone="+237699999777", password="TestPassword123!")
    client = APIClient()
    client.force_authenticate(user)
    return user, client


@pytest.mark.django_db
def test_dev_role_switch_grants_roles_additively_when_debug_on(settings):
    settings.DEBUG = True
    user, client = _client()
    LandlordProfile.objects.create(user=user)

    resp = client.post("/api/auth/dev-switch-role/", {"role": "agent"}, format="json")
    assert resp.status_code == 200
    assert resp.data["is_agent"] is True
    assert resp.data["is_landlord"] is True  # existing role untouched
    assert AgentProfile.objects.filter(user=user).count() == 1

    driver = client.post("/api/auth/dev-switch-role/", {"role": "driver"}, format="json")
    assert driver.data["is_driver"] is True
    assert user.driver_profile.is_verified is True


@pytest.mark.django_db
def test_dev_role_switch_is_404_in_production(settings):
    settings.DEBUG = False
    _, client = _client()
    resp = client.post("/api/auth/dev-switch-role/", {"role": "agent"}, format="json")
    assert resp.status_code == 404


@pytest.mark.django_db
def test_dev_role_switch_rejects_unknown_role(settings):
    settings.DEBUG = True
    _, client = _client()
    resp = client.post("/api/auth/dev-switch-role/", {"role": "superadmin"}, format="json")
    assert resp.status_code == 400
