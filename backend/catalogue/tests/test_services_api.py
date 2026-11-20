"""Test for the real, public Services browse API."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient

from catalogue.models import PartnerServiceCategory, PartnerServiceOffering


@pytest.mark.django_db
def test_services_api_is_public_and_shows_real_offerings():
    category = PartnerServiceCategory.objects.create(name="Marketing & Media")
    PartnerServiceOffering.objects.create(name="Professional Photography", category=category, price_hint_xaf=Decimal("15000"))

    response = APIClient().get("/api/service-categories/")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["name"] == "Marketing & Media"
    assert response.data["results"][0]["offerings"][0]["name"] == "Professional Photography"


@pytest.mark.django_db
def test_services_api_hides_inactive_offerings_and_empty_categories():
    media = PartnerServiceCategory.objects.create(name="Marketing & Media")
    PartnerServiceOffering.objects.create(name="Professional Photography", category=media)
    PartnerServiceOffering.objects.create(name="Retired Drone Shoot", category=media, is_active=False)
    retired = PartnerServiceCategory.objects.create(name="Retired Category")
    PartnerServiceOffering.objects.create(name="Old Service", category=retired, is_active=False)

    response = APIClient().get("/api/service-categories/")
    assert response.data["count"] == 1
    assert [o["name"] for o in response.data["results"][0]["offerings"]] == ["Professional Photography"]
