import pytest
from django.contrib import admin
from rest_framework.test import APIClient

from geo.admin import AreaSuggestionAdmin
from geo.models import AreaSuggestion, AreaSuggestionStatus, Quarter
from identity.models import User


@pytest.fixture
def seeded(db):
    from django.core.management import call_command
    call_command("seed_cameroon_geography")


def _client():
    user = User.objects.create_user(username="lister", phone="+237699994001", password="TestPassword123!")
    client = APIClient()
    client.force_authenticate(user)
    return user, client


@pytest.mark.django_db
def test_landlord_can_request_a_missing_area_and_admin_approval_creates_it(seeded):
    _, client = _client()
    payload = {"region_name": "Centre", "city_name": "Yaoundé", "area_name": "Nkol-Eton"}

    response = client.post("/api/area-suggestions/", payload, format="json")
    assert response.status_code == 201
    assert response.data["status"] == "PENDING"
    assert not Quarter.objects.filter(name="Nkol-Eton").exists()  # never created without review

    assert client.post("/api/area-suggestions/", payload, format="json").status_code == 400  # already pending

    AreaSuggestionAdmin(AreaSuggestion, admin.site).approve_suggestions(None, AreaSuggestion.objects.all())
    quarter = Quarter.objects.get(name="Nkol-Eton")
    assert quarter.village_or_district.name == "Yaoundé"
    assert AreaSuggestion.objects.get().status == AreaSuggestionStatus.APPROVED


@pytest.mark.django_db
def test_requesting_an_existing_area_or_unknown_region_is_rejected(seeded):
    _, client = _client()
    existing = client.post("/api/area-suggestions/", {"region_name": "Centre", "city_name": "yaoundé", "area_name": "bastos"}, format="json")
    assert existing.status_code == 400
    bad_region = client.post("/api/area-suggestions/", {"region_name": "Atlantis", "city_name": "X", "area_name": "Y"}, format="json")
    assert bad_region.status_code == 400


@pytest.mark.django_db
def test_anonymous_users_cannot_request_areas(seeded):
    response = APIClient().post("/api/area-suggestions/", {"region_name": "Centre", "city_name": "Yaoundé", "area_name": "Z"}, format="json")
    assert response.status_code == 401
