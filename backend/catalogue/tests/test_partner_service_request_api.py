"""Tests for the real 'request a partner service' API — request_
partner_service() was fully built and tested, but the Partner Services
directory was browse-only."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from catalogue.models import PartnerServiceCategory, PartnerServiceOffering, PartnerServiceRequestStatus


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_requesting_a_partner_service_via_api():
    user = User.objects.create(username="catalogue_requester", phone="+237699840001")
    category = PartnerServiceCategory.objects.create(name="Legal")
    offering = PartnerServiceOffering.objects.create(name="Notary Services", category=category)

    response = _auth_client(user).post("/api/partner-services/request/", {"offering": offering.id, "notes": "Need a notary for a land sale."})

    assert response.status_code == 201
    assert response.data["status"] == PartnerServiceRequestStatus.REQUESTED

    mine_response = _auth_client(user).get("/api/my-partner-service-requests/")
    assert mine_response.data["count"] == 1


@pytest.mark.django_db
def test_requesting_an_inactive_offering_fails_clearly():
    user = User.objects.create(username="catalogue_requester_2", phone="+237699840002")
    category = PartnerServiceCategory.objects.create(name="Moving")
    offering = PartnerServiceOffering.objects.create(name="Moving Truck", category=category, is_active=False)

    response = _auth_client(user).post("/api/partner-services/request/", {"offering": offering.id})
    assert response.status_code == 404
