"""Unaccepted Taskln jobs expire instead of sitting on the board forever."""
import pytest
from datetime import timedelta
from io import StringIO
from django.core.management import call_command
from django.utils import timezone

from identity.models import User
from notifications.models import Notification
from services.models import ServiceCategory, ServiceRequest, ServiceRequestStatus
from services.services import expire_stale_service_requests


def _job(requester, age_hours, status=ServiceRequestStatus.REQUESTED, scheduled_for=None):
    job = ServiceRequest.objects.create(
        requester=requester, category=ServiceCategory.PLUMBING, description="Leak",
        latitude="3.848", longitude="11.502", status=status, scheduled_for=scheduled_for,
    )
    ServiceRequest.objects.filter(pk=job.pk).update(requested_at=timezone.now() - timedelta(hours=age_hours))
    return job


@pytest.mark.django_db
def test_old_unaccepted_jobs_are_cancelled_and_the_requester_is_told():
    requester = User.objects.create(username="ex_req", phone="+237699222001")
    old = _job(requester, 60)
    fresh = _job(requester, 5)

    expired = expire_stale_service_requests()

    assert [j.pk for j in expired] == [old.pk]
    old.refresh_from_db()
    fresh.refresh_from_db()
    assert old.status == ServiceRequestStatus.CANCELLED
    assert fresh.status == ServiceRequestStatus.REQUESTED
    assert Notification.objects.filter(recipient=requester, notification_type="SERVICE_REQUEST_EXPIRED").count() == 1


@pytest.mark.django_db
def test_accepted_jobs_and_jobs_booked_for_the_future_are_left_alone():
    requester = User.objects.create(username="ex_req2", phone="+237699222002")
    technician = User.objects.create(username="ex_tech2", phone="+237699222003")
    accepted = _job(requester, 100, status=ServiceRequestStatus.ACCEPTED)
    ServiceRequest.objects.filter(pk=accepted.pk).update(technician=technician)
    future = _job(requester, 100, scheduled_for=timezone.now() + timedelta(days=3))

    assert expire_stale_service_requests() == []
    accepted.refresh_from_db()
    future.refresh_from_db()
    assert accepted.status == ServiceRequestStatus.ACCEPTED
    assert future.status == ServiceRequestStatus.REQUESTED


@pytest.mark.django_db
def test_management_command_runs_the_sweep():
    requester = User.objects.create(username="ex_req3", phone="+237699222004")
    job = _job(requester, 72)
    out = StringIO()
    call_command("expire_stale_service_requests", stdout=out)
    assert "Expired 1" in out.getvalue()
    job.refresh_from_db()
    assert job.status == ServiceRequestStatus.CANCELLED
