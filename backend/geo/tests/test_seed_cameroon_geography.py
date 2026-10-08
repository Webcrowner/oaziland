import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from geo.models import Quarter


@pytest.mark.django_db
def test_seed_covers_every_region_and_quarters_api_returns_all_of_them():
    call_command("seed_cameroon_geography")
    total = Quarter.objects.count()
    assert total > 20  # the default page size must not hide most of the country

    call_command("seed_cameroon_geography")  # idempotent
    assert Quarter.objects.count() == total

    response = APIClient().get("/api/quarters/")
    assert response.data["count"] == total
    assert len(response.data["results"]) == total
    assert {q["region_name"] for q in response.data["results"]} == {
        "Centre", "Littoral", "South West", "North West", "West",
        "Adamawa", "North", "Far North", "East", "South",
    }
