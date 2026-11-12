"""Trainers create their own courses once an admin grants course-creator access (with or without publishing rights)."""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from careers.models import CourseCreatorAccess, TrainingCategory, TrainingProgram
from careers.services import enroll_in_training
from identity.models import AdminProfile, User
from notifications.models import Notification

GRANTS = "/api/admin/course-creators/"
COURSES = "/api/manage/courses/"


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _user(name):
    return User.objects.create(username=name, phone=f"+2376{abs(hash(name)) % 10**8:08d}", first_name=name.title())


@pytest.fixture
def admin(db):
    user = _user("cc_admin")
    AdminProfile.objects.create(user=user)
    return user


def _new_course(client, **extra):
    body = {"title": "Caretaker basics", "description": "Keys, repairs and rent.", "category": TrainingCategory.OTHER, **extra}
    return client.post(COURSES, body, format="json")


@pytest.mark.django_db
def test_only_trainers_granted_access_can_create_courses(admin):
    trainer = _user("cc_trainer")
    assert _client(trainer).get(f"{COURSES}access/").json()["can_create"] is False
    assert _new_course(_client(trainer)).status_code == 403
    assert _client(trainer).get(GRANTS).status_code == 403

    response = _client(admin).post(GRANTS, {"identifier": trainer.phone, "can_publish": True}, format="json")
    assert response.status_code == 201 and response.json()["user"]["username"] == "cc_trainer"
    assert Notification.objects.filter(recipient=trainer, notification_type="COURSE_CREATOR_ACCESS").exists()
    assert _client(admin).post(GRANTS, {"identifier": "nobody-here"}, format="json").status_code == 400
    assert _client(admin).post(GRANTS, {"identifier": admin.username}, format="json").status_code == 400

    access = _client(trainer).get(f"{COURSES}access/").json()
    assert access == {"is_admin": False, "can_create": True, "can_publish": True, "has_courses": False}
    course = _new_course(_client(trainer), is_published=True).json()
    assert course["my_role"] == "OWNER" and course["is_published"] is True
    program = TrainingProgram.objects.get(pk=course["id"])
    assert program.provider == trainer
    assert APIClient().get(f"/api/trainings/{program.id}/").status_code == 200

    # The owner builds and staffs their course; other trainers can't see it.
    assert _client(trainer).post("/api/manage/modules/", {"program": course["id"], "title": "Week 1"}, format="json").status_code == 201
    helper = _user("cc_helper")
    assert _client(trainer).post(f"{COURSES}{course['id']}/staff/", {"identifier": helper.username, "role": "SUPERVISOR"}, format="json").status_code == 201
    assert _client(_user("cc_other")).get(f"{COURSES}{course['id']}/").status_code == 404
    assert _client(trainer).put(f"{COURSES}{course['id']}/certificate-template/", {"template_id": None}, format="json").status_code == 403

    # Only an admin may delete it once learners have enrolled.
    enroll_in_training(program=program, student=_user("cc_learner"))
    assert _client(trainer).delete(f"{COURSES}{course['id']}/").status_code == 403
    empty = _new_course(_client(trainer)).json()
    assert _client(trainer).delete(f"{COURSES}{empty['id']}/").status_code == 204


@pytest.mark.django_db
def test_without_publishing_rights_an_admin_reviews_the_course(admin):
    trainer = _user("cc_reviewed")
    grant = _client(admin).post(GRANTS, {"identifier": trainer.username, "can_publish": False}, format="json").json()
    course = _new_course(_client(trainer), is_published=True).json()
    assert course["is_published"] is False

    url = f"{COURSES}{course['id']}/"
    assert _client(trainer).patch(url, {"is_published": True}, format="json").status_code == 403
    assert _client(trainer).post(f"{url}request-review/").json()["review_requested_at"]
    assert Notification.objects.filter(recipient=admin, notification_type="COURSE_REVIEW_REQUESTED").exists()
    assert [c["id"] for c in _client(admin).get(GRANTS).json()["awaiting_review"]] == [course["id"]]

    assert _client(admin).patch(url, {"is_published": True}, format="json").json()["review_requested_at"] is None
    assert _client(admin).get(GRANTS).json()["awaiting_review"] == []

    # Granting publishing rights later lets the trainer publish directly; revoking access removes it again.
    _client(admin).patch(f"{GRANTS}{grant['id']}/", {"can_publish": True}, format="json")
    _client(trainer).patch(url, {"is_published": False}, format="json")
    assert _client(trainer).patch(url, {"is_published": True}, format="json").status_code == 200
    _client(admin).delete(f"{GRANTS}{grant['id']}/")
    assert not CourseCreatorAccess.objects.filter(user=trainer).exists()
    assert _new_course(_client(trainer)).status_code == 403
    assert _client(trainer).patch(url, {"title": "Still mine to edit", "is_published": False}, format="json").status_code == 200
    assert _client(trainer).patch(url, {"is_published": True}, format="json").status_code == 403


@pytest.mark.django_db
def test_a_trainer_cannot_release_their_own_course_fee(admin):
    from careers.services import confirm_training_payment, pay_for_training
    from payments.gateways import SandboxGateway
    from transactions.locks import InMemoryLockClient
    from transactions.services import confirm_payment

    trainer = _user("cc_paid")
    CourseCreatorAccess.objects.create(user=trainer)
    program = TrainingProgram.objects.create(provider=trainer, title="Paid workshop", category=TrainingCategory.OTHER, price_xaf=Decimal("5000"))
    lock = InMemoryLockClient()
    enrollment = pay_for_training(program=program, student=_user("cc_payer"), phone_number="+237670000019", lock_client=lock, payment_gateway=SandboxGateway())
    confirm_payment(lock_client=lock, booking=enrollment.booking, provider="MTN_MOMO", provider_reference="CC-1")
    confirm_training_payment(booking=enrollment.booking)

    url = f"{COURSES}{program.id}/learners/{enrollment.id}/complete/"
    assert _client(trainer).post(url).status_code == 403
    assert _client(admin).post(url).status_code == 200
