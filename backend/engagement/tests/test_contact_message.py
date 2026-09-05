"""
Tests for the public Contact Us endpoint — deliberately separate from
SupportTicket (which requires an authenticated user) since a
prospective visitor reaching out before creating an account is a real
case that model can't handle.
"""
import pytest
from rest_framework.test import APIClient

from identity.models import User, AdminProfile
from engagement.models import ContactMessage
from notifications.models import Notification


@pytest.mark.django_db
def test_anonymous_visitor_can_submit_a_contact_message_and_admin_is_notified():
    admin_user = User.objects.create(username="contact_test_admin", phone="+237699999301")
    AdminProfile.objects.create(user=admin_user, permissions=[])

    client = APIClient()
    response = client.post("/api/contact/", {"name": "Jane Doe", "email": "jane@example.com", "message": "I'd like to partner with Oaziland."})

    assert response.status_code == 201
    assert ContactMessage.objects.filter(name="Jane Doe", email="jane@example.com").exists()
    assert Notification.objects.filter(recipient=admin_user, notification_type="CONTACT_FORM_SUBMISSION").exists()


@pytest.mark.django_db
def test_contact_message_requires_all_fields():
    client = APIClient()
    response = client.post("/api/contact/", {"name": "Incomplete Submission"})
    assert response.status_code == 400
    assert ContactMessage.objects.count() == 0
