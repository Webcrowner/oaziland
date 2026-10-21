"""Phone numbers, emails and chat links stay out of job chat and request text until the job is completed."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus
from services.models import ServiceCategory, ServiceRequest, ServiceRequestStatus
from services.services import contains_contact_details

SITE = {"latitude": "3.8481234", "longitude": "11.5021234"}


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _parties(suffix):
    requester = User.objects.create(username=f"cs_req{suffix}", phone=f"+23769911{suffix}01")
    KYCProfile.objects.create(
        user=requester, legal_full_name="Req", date_of_birth="1990-01-01", national_id_number=f"CM-CS-{suffix}",
        residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED,
    )
    technician = User.objects.create(username=f"cs_tech{suffix}", phone=f"+23769911{suffix}02")
    TechnicianProfile.objects.create(user=technician, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    return requester, technician


def _job(requester, technician, status):
    return ServiceRequest.objects.create(
        requester=requester, technician=technician, category=ServiceCategory.PLUMBING, description="Leak", status=status, **SITE,
    )


@pytest.mark.parametrize("text", [
    "call me on 670123456",
    "my number is +237 670 12 34 56",
    "6.70.12.34.56",
    "reach me (237) 670-123-456 tonight",
    "write to joe@example.com",
    "joe @ example . com",
    "https://wa.me/237670123456",
    "t.me/someplumber",
    "api.whatsapp.com/send",
])
def test_contact_details_are_detected(text):
    assert contains_contact_details(text)


@pytest.mark.parametrize("text", [
    "I will bring 2 pipes, the total is 25000 XAF",
    "Arriving at 14:30 tomorrow",
    "Let's meet on 2026-10-14 14:30 at the gate",
    "See you 14/10/2026 at 9h30",
    "3 bags of cement and 12 tiles, about 50 000 XAF",
    "Job reference 12345",
])
def test_ordinary_job_talk_is_not_flagged(text):
    assert not contains_contact_details(text)


@pytest.mark.django_db
def test_chat_blocks_contact_details_until_the_job_is_completed():
    requester, technician = _parties("11")
    job = _job(requester, technician, ServiceRequestStatus.ACCEPTED)
    url = f"/api/service-requests/{job.id}/messages/"

    blocked = _client(technician).post(url, {"text": "call me 670123456"})
    assert blocked.status_code == 400
    assert "inside Oaziland" in blocked.data["detail"]
    assert job.messages.count() == 0

    assert _client(technician).post(url, {"text": "I can come at 14:30 with 2 pipes"}).status_code == 201

    ServiceRequest.objects.filter(pk=job.pk).update(status=ServiceRequestStatus.COMPLETED)
    assert _client(requester).post(url, {"text": "thanks! my number is 670123456"}).status_code == 201
    assert job.messages.count() == 2


@pytest.mark.django_db
def test_request_description_cannot_carry_contact_details():
    requester, _ = _parties("12")
    payload = {"category": ServiceCategory.PLUMBING, **SITE}
    blocked = _client(requester).post("/api/service-requests/", {**payload, "description": "Leak, call 670123456"})
    assert blocked.status_code == 400
    assert "description" in blocked.data
    assert _client(requester).post("/api/service-requests/", {**payload, "description": "Leak under the sink"}).status_code == 201
