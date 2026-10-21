"""Two-way job reviews: clients rate technicians and technicians rate clients, blind until both have reviewed."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile
from notifications.models import Notification
from services.models import ServiceCategory, ServiceRequest, ServiceRequestStatus, ServiceReview

SITE = {"latitude": "3.8481234", "longitude": "11.5021234"}


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _completed_job(requester, technician, **extra):
    return ServiceRequest.objects.create(
        requester=requester, technician=technician, category=ServiceCategory.PLUMBING, description="Leak",
        status=ServiceRequestStatus.COMPLETED, **SITE, **extra,
    )


@pytest.fixture
def parties(db):
    requester = User.objects.create(username="rv_req", phone="+237699333001")
    technician = User.objects.create(username="rv_tech", phone="+237699333002")
    TechnicianProfile.objects.create(user=technician, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    return requester, technician


def _rate(user, job, action, score, comment=""):
    return _client(user).post(f"/api/service-requests/{job.id}/{action}/", {"score": score, "comment": comment}, format="json")


def _detail(user, job):
    return _client(user).get(f"/api/service-requests/{job.id}/").data


@pytest.mark.django_db
def test_technician_can_review_the_client_and_comments_are_stored(parties):
    requester, technician = parties
    job = _completed_job(requester, technician)

    response = _rate(technician, job, "rate-requester", "4.0", "Paid on time, clear instructions")
    assert response.status_code == 200, response.data
    review = ServiceReview.objects.get(service_request=job, author=technician)
    assert review.subject == requester and review.subject_is_requester and review.comment.startswith("Paid on time")
    assert response.data["my_review"] == {"score": 4.0, "comment": "Paid on time, clear instructions"}
    assert Notification.objects.filter(recipient=requester, notification_type="SERVICE_REQUEST_REVIEWED").exists()


@pytest.mark.django_db
def test_only_the_assigned_technician_can_review_the_client_and_only_after_completion(parties):
    requester, technician = parties
    stranger = User.objects.create(username="rv_stranger", phone="+237699333003")
    job = _completed_job(requester, technician)
    assert _rate(requester, job, "rate-requester", "5.0").status_code == 403
    assert _rate(stranger, job, "rate-requester", "5.0").status_code == 403

    open_job = ServiceRequest.objects.create(
        requester=requester, technician=technician, category=ServiceCategory.PLUMBING, description="x",
        status=ServiceRequestStatus.IN_PROGRESS, **SITE,
    )
    assert _rate(technician, open_job, "rate-requester", "5.0").status_code == 400
    assert _rate(technician, job, "rate-requester", "9.0").status_code == 400


@pytest.mark.django_db
def test_reviews_are_hidden_until_the_other_party_has_reviewed(parties):
    requester, technician = parties
    job = _completed_job(requester, technician)

    _rate(technician, job, "rate-requester", "2.0", "Kept changing the job")
    assert _detail(requester, job)["their_review"] is None  # requester has not reviewed yet

    _rate(requester, job, "rate", "5.0", "Great work")
    assert _detail(requester, job)["their_review"] == {"score": 2.0, "comment": "Kept changing the job"}
    assert _detail(technician, job)["their_review"] == {"score": 5.0, "comment": "Great work"}


@pytest.mark.django_db
def test_rating_the_technician_still_updates_their_average_and_stores_a_per_job_review(parties):
    requester, technician = parties
    first, second = _completed_job(requester, technician), _completed_job(requester, technician)
    _rate(requester, first, "rate", "4.0", "Good")
    _rate(requester, second, "rate", "5.0", "Excellent")
    technician.technician_profile.refresh_from_db()
    assert technician.technician_profile.avg_rating == Decimal("5.00")  # existing rule: one live rating per client
    assert ServiceReview.objects.filter(subject=technician).count() == 2
    # Editing is allowed and never creates a second review for the same job.
    _rate(requester, second, "rate", "3.0", "Changed my mind")
    assert ServiceReview.objects.filter(service_request=second).count() == 1


@pytest.mark.django_db
def test_a_clients_reputation_is_visible_to_technicians_but_never_touches_their_own_technician_average(parties):
    requester, technician = parties
    # The client is also a technician: reviews they get as a client must not touch their technician average.
    TechnicianProfile.objects.create(user=requester, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    other_tech = User.objects.create(username="rv_tech2", phone="+237699333004")
    TechnicianProfile.objects.create(user=other_tech, is_verified=True, specialties=[ServiceCategory.PLUMBING])
    _rate(technician, _completed_job(requester, technician), "rate-requester", "5.0")
    _rate(other_tech, _completed_job(requester, other_tech), "rate-requester", "3.0")

    open_job = ServiceRequest.objects.create(requester=requester, category=ServiceCategory.PLUMBING, description="New leak", **SITE)
    seen = _detail(technician, open_job)
    assert seen["requester_rating"] == {"average": 4.0, "count": 2}

    requester.technician_profile.refresh_from_db()
    assert requester.technician_profile.avg_rating == Decimal("0")
