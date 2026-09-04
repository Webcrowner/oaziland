"""Tests for agent viewing/showing appointment scheduling."""
import pytest
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from agency.models import ShowingAppointmentStatus
from agency.services import schedule_showing, complete_showing, cancel_showing


@pytest.mark.django_db
def test_schedule_complete_and_cancel_showings():
    agent = User.objects.create(username="showing_agent", phone="+237699992004")
    client_a = User.objects.create(username="showing_client_a", phone="+237699992005")
    client_b = User.objects.create(username="showing_client_b", phone="+237699992006")
    import uuid
    listing_id = uuid.uuid4()

    appointment_a = schedule_showing(agent=agent, client=client_a, listing_id=listing_id, scheduled_at=timezone.now() + timedelta(days=1))
    appointment_b = schedule_showing(agent=agent, client=client_b, listing_id=listing_id, scheduled_at=timezone.now() + timedelta(days=2))

    assert appointment_a.status == ShowingAppointmentStatus.SCHEDULED
    assert agent.showing_appointments.count() == 2

    complete_showing(appointment_a)
    appointment_a.refresh_from_db()
    assert appointment_a.status == ShowingAppointmentStatus.COMPLETED

    cancel_showing(appointment_b)
    appointment_b.refresh_from_db()
    assert appointment_b.status == ShowingAppointmentStatus.CANCELLED
