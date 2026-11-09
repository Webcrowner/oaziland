"""Admin support inbox: tickets handed to a person, replying, resolving, and the contact-form inbox."""
import pytest
from rest_framework.test import APIClient

from engagement.models import ContactMessage, SupportMessage, SupportTicket, SupportTicketStatus
from engagement.services import (
    continue_support_ticket, create_support_ticket, escalate_ticket_to_human, respond_as_human_agent, resolve_ticket,
)
from identity.models import AdminProfile, User
from notifications.models import Notification
from trust_safety.models import AuditLog

HUMAN_REQUEST = "I need to speak to a human please"
AI_QUESTION = "What is your platform fee?"


def make_user(username, phone):
    return User.objects.create_user(username=username, email=f"{username}@example.com", phone=phone, password="x-Strong-pass-1")


@pytest.fixture
def admin(db):
    user = make_user("inbox_admin", "+237699400001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def admin_client(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def customer(db):
    return make_user("inbox_customer", "+237699400002")


def user_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def rows(response):
    data = response.data
    return data["results"] if isinstance(data, dict) and "results" in data else data


# ---------------------------------------------------------------- alerts

@pytest.mark.django_db
def test_admins_are_told_when_a_chat_is_handed_to_a_person(admin, customer):
    create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)

    note = Notification.objects.get(recipient=admin, notification_type="SUPPORT_TICKET_WAITING")
    assert "inbox_customer" in note.message


@pytest.mark.django_db
def test_admins_are_told_when_the_user_writes_again_on_a_human_chat(admin, customer):
    ticket = create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)
    Notification.objects.all().delete()

    continue_support_ticket(ticket=ticket, user=customer, message="Are you still there?")

    assert Notification.objects.filter(recipient=admin, notification_type="SUPPORT_TICKET_WAITING").count() == 1


@pytest.mark.django_db
def test_an_ai_handled_chat_does_not_alert_admins(admin, customer):
    create_support_ticket(user=customer, subject="Fees", first_message=AI_QUESTION)

    assert Notification.objects.filter(recipient=admin).count() == 0


# ---------------------------------------------------------------- the inbox

@pytest.mark.django_db
def test_inbox_lists_chats_waiting_for_a_person_with_context(admin_client, customer):
    waiting = create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)
    create_support_ticket(user=customer, subject="Fees", first_message=AI_QUESTION)  # AI still handling it

    data = rows(admin_client.get("/api/admin/support-tickets/"))

    assert [t["id"] for t in data] == [str(waiting.id)]
    row = data[0]
    assert row["user"]["username"] == "inbox_customer" and row["user"]["phone"] == "+237699400002"
    assert row["awaiting_admin"] is True and row["ai_handled"] is False
    assert row["message_count"] == 2
    assert row["last_sender"] == "AI_AGENT"
    assert row["last_message_preview"]
    assert row["messages"] is None


@pytest.mark.django_db
def test_open_view_includes_ai_handled_chats_and_resolved_view_only_closed_ones(admin_client, customer):
    ai_chat = create_support_ticket(user=customer, subject="Fees", first_message=AI_QUESTION)
    done = create_support_ticket(user=customer, subject="Old", first_message=HUMAN_REQUEST)
    resolve_ticket(done)

    open_ids = {t["id"] for t in rows(admin_client.get("/api/admin/support-tickets/?view=open"))}
    resolved_ids = {t["id"] for t in rows(admin_client.get("/api/admin/support-tickets/?view=resolved"))}

    assert open_ids == {str(ai_chat.id)}
    assert resolved_ids == {str(done.id)}


@pytest.mark.django_db
def test_a_ticket_leaves_the_waiting_list_once_an_admin_answers(admin_client, admin, customer):
    ticket = create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)
    respond_as_human_agent(ticket=ticket, agent=admin, text="Hi, how can I help?")

    assert rows(admin_client.get("/api/admin/support-tickets/")) == []
    still_open = rows(admin_client.get("/api/admin/support-tickets/?view=open"))
    assert [t["id"] for t in still_open] == [str(ticket.id)] and still_open[0]["awaiting_admin"] is False

    continue_support_ticket(ticket=ticket, user=customer, message="It is about my booking")
    assert [t["id"] for t in rows(admin_client.get("/api/admin/support-tickets/"))] == [str(ticket.id)]


@pytest.mark.django_db
def test_ticket_detail_includes_the_whole_conversation(admin_client, admin, customer):
    ticket = create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)
    respond_as_human_agent(ticket=ticket, agent=admin, text="On it")

    detail = admin_client.get(f"/api/admin/support-tickets/{ticket.id}/").data

    assert [m["sender_type"] for m in detail["messages"]] == ["USER", "AI_AGENT", "HUMAN_AGENT"]
    assert detail["messages"][2]["sender_name"] == "inbox_admin"


@pytest.mark.django_db
def test_only_admins_can_use_the_inbox(customer):
    ticket = create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)
    client = user_client(customer)

    assert client.get("/api/admin/support-tickets/").status_code == 403
    assert client.get(f"/api/admin/support-tickets/{ticket.id}/").status_code == 403
    assert client.post(f"/api/admin/support-tickets/{ticket.id}/reply/", {"message": "hi"}, format="json").status_code == 403
    assert client.get("/api/admin/contact-messages/").status_code == 403
    assert APIClient().get("/api/admin/support-tickets/").status_code in (401, 403)


# ---------------------------------------------------------------- replying

@pytest.mark.django_db
def test_replying_takes_over_from_the_ai_notifies_the_user_and_is_audited(admin_client, admin, customer):
    ticket = create_support_ticket(user=customer, subject="Fees", first_message=AI_QUESTION)
    assert ticket.ai_handled is True

    res = admin_client.post(f"/api/admin/support-tickets/{ticket.id}/reply/", {"message": "Hello, I'm Amina from support."}, format="json")

    assert res.status_code == 200
    ticket.refresh_from_db()
    assert ticket.ai_handled is False and ticket.status == SupportTicketStatus.IN_PROGRESS and ticket.assigned_to == admin
    assert res.data["messages"][-1]["sender_type"] == "HUMAN_AGENT"
    assert Notification.objects.filter(recipient=customer, notification_type="SUPPORT_REPLY").count() == 1
    entry = AuditLog.objects.get(action="admin-support-ticket/reply")
    assert entry.actor == admin and entry.target_label == "inbox_customer · Fees"

    # the AI no longer answers once a person has taken over
    continue_support_ticket(ticket=ticket, user=customer, message="Thanks")
    assert ticket.messages.filter(sender_type="AI_AGENT").count() == 1


@pytest.mark.django_db
def test_reply_is_validated(admin_client, customer):
    ticket = create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)

    assert admin_client.post(f"/api/admin/support-tickets/{ticket.id}/reply/", {"message": "   "}, format="json").status_code == 400
    assert admin_client.post(f"/api/admin/support-tickets/{ticket.id}/reply/", {"message": "x" * 4001}, format="json").status_code == 400
    assert SupportMessage.objects.filter(ticket=ticket, sender_type="HUMAN_AGENT").count() == 0


@pytest.mark.django_db
def test_the_user_can_read_the_human_reply_in_their_own_chat(admin_client, customer):
    ticket = create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)
    admin_client.post(f"/api/admin/support-tickets/{ticket.id}/reply/", {"message": "We are on it."}, format="json")

    mine = user_client(customer).get(f"/api/support-tickets/{ticket.id}/").data

    assert mine["messages"][-1] == {**mine["messages"][-1], "sender_type": "HUMAN_AGENT", "text": "We are on it."}


# ---------------------------------------------------------------- resolve / reopen

@pytest.mark.django_db
def test_resolving_and_reopening(admin_client, customer):
    ticket = create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)

    resolved = admin_client.post(f"/api/admin/support-tickets/{ticket.id}/resolve/")
    assert resolved.status_code == 200 and resolved.data["status"] == "RESOLVED" and resolved.data["resolved_at"]
    assert rows(admin_client.get("/api/admin/support-tickets/")) == []

    reopened = admin_client.post(f"/api/admin/support-tickets/{ticket.id}/reopen/")
    assert reopened.data["status"] == "IN_PROGRESS" and reopened.data["resolved_at"] is None
    assert [t["id"] for t in rows(admin_client.get("/api/admin/support-tickets/"))] == [str(ticket.id)]


@pytest.mark.django_db
def test_a_user_writing_on_a_resolved_human_chat_reopens_it(admin, customer):
    ticket = create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)
    resolve_ticket(ticket)

    continue_support_ticket(ticket=ticket, user=customer, message="Actually, one more thing")
    ticket.refresh_from_db()

    assert ticket.status == SupportTicketStatus.IN_PROGRESS and ticket.resolved_at is None


# ---------------------------------------------------------------- counters

@pytest.mark.django_db
def test_console_summary_counts_the_inbox(admin_client, customer):
    create_support_ticket(user=customer, subject="Help", first_message=HUMAN_REQUEST)
    create_support_ticket(user=customer, subject="Fees", first_message=AI_QUESTION)
    ContactMessage.objects.create(name="Jo", email="jo@example.com", message="Hi")
    ContactMessage.objects.create(name="Done", email="d@example.com", message="Old", resolved=True)

    data = admin_client.get("/api/admin/console-summary/").data

    assert data["support_tickets_awaiting"] == 1
    assert data["open_contact_messages"] == 1


# ---------------------------------------------------------------- contact form + inbox

@pytest.mark.django_db
def test_contact_form_rejects_bad_email_and_oversized_messages():
    client = APIClient()
    good = {"name": "Jo", "email": "jo@example.com", "message": "Hello"}

    assert client.post("/api/contact/", {**good, "email": "not-an-email"}, format="json").status_code == 400
    assert client.post("/api/contact/", {**good, "message": "x" * 5001}, format="json").status_code == 400
    assert client.post("/api/contact/", {**good, "name": "n" * 201}, format="json").status_code == 400
    assert client.post("/api/contact/", {**good, "email": ["a@b.co"]}, format="json").status_code == 400
    assert ContactMessage.objects.count() == 0
    assert client.post("/api/contact/", good, format="json").status_code == 201


@pytest.mark.django_db
def test_contact_inbox_lists_resolves_and_reopens(admin_client, admin):
    first = ContactMessage.objects.create(name="Jo", email="jo@example.com", message="First")
    ContactMessage.objects.create(name="Mia", email="mia@example.com", message="Second")

    unresolved = rows(admin_client.get("/api/admin/contact-messages/"))
    assert [m["name"] for m in unresolved] == ["Jo", "Mia"]  # oldest first
    assert unresolved[0]["email"] == "jo@example.com" and unresolved[0]["message"] == "First"

    res = admin_client.post(f"/api/admin/contact-messages/{first.id}/resolve/")
    assert res.status_code == 200 and res.data["resolved"] is True
    assert [m["name"] for m in rows(admin_client.get("/api/admin/contact-messages/"))] == ["Mia"]
    assert [m["name"] for m in rows(admin_client.get("/api/admin/contact-messages/?resolved=1"))] == ["Jo"]
    entry = AuditLog.objects.get(action="admin-contact-message/resolve")
    assert entry.actor == admin and entry.target_label == "Jo <jo@example.com>"

    reopened = admin_client.post(f"/api/admin/contact-messages/{first.id}/reopen/")
    assert reopened.data["resolved"] is False
    assert len(rows(admin_client.get("/api/admin/contact-messages/"))) == 2
