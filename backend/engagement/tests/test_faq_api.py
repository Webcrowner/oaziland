import pytest
from rest_framework.test import APIClient

from engagement.models import Faq
from identity.models import User, AdminProfile


def _admin_client():
    admin = User.objects.create_user(username="faq_admin", phone="+237699992001", email="faq_admin@example.com", password="TestPassword123!")
    AdminProfile.objects.create(user=admin)
    client = APIClient()
    client.force_authenticate(admin)
    return client


@pytest.mark.django_db
def test_public_faq_list_is_localized_and_hides_unpublished():
    Faq.objects.all().delete()
    Faq.objects.create(question_en="Q1?", answer_en="A1", question_fr="Q1 fr ?", answer_fr="R1", display_order=0)
    Faq.objects.create(question_en="Q2?", answer_en="A2", display_order=1, show_on_homepage=False)
    Faq.objects.create(question_en="Hidden?", answer_en="No", display_order=2, is_published=False)
    client = APIClient()

    english = client.get("/api/faqs/").data
    assert [f["question"] for f in english] == ["Q1?", "Q2?"]

    french = client.get("/api/faqs/", {"lang": "fr"}).data
    assert [f["question"] for f in french] == ["Q1 fr ?", "Q2?"]  # blank French falls back to English

    homepage = client.get("/api/faqs/", {"homepage": "1"}).data
    assert [f["question"] for f in homepage] == ["Q1?"]


@pytest.mark.django_db
def test_only_admins_can_manage_faqs_and_crud_works():
    Faq.objects.all().delete()
    regular = User.objects.create_user(username="faq_user", phone="+237699992002", email="faq_user@example.com", password="TestPassword123!")
    user_client = APIClient()
    user_client.force_authenticate(regular)
    assert user_client.get("/api/admin/faqs/").status_code == 403
    assert APIClient().post("/api/admin/faqs/", {"question_en": "x", "answer_en": "y"}, format="json").status_code in (401, 403)

    client = _admin_client()
    created = client.post("/api/admin/faqs/", {"question_en": "New?", "answer_en": "Yes"}, format="json")
    assert created.status_code == 201
    second = client.post("/api/admin/faqs/", {"question_en": "Second?", "answer_en": "Yes"}, format="json")
    assert second.data["display_order"] == created.data["display_order"] + 1

    patched = client.patch(f"/api/admin/faqs/{created.data['id']}/", {"is_published": False}, format="json")
    assert patched.data["is_published"] is False
    assert [f["question"] for f in APIClient().get("/api/faqs/").data] == ["Second?"]

    assert client.delete(f"/api/admin/faqs/{created.data['id']}/").status_code == 204
    assert Faq.objects.count() == 1


@pytest.mark.django_db
def test_admin_can_reorder_faqs():
    Faq.objects.all().delete()
    a = Faq.objects.create(question_en="A?", answer_en="a", display_order=0)
    b = Faq.objects.create(question_en="B?", answer_en="b", display_order=1)
    client = _admin_client()

    assert client.post("/api/admin/faqs/reorder/", {"ids": [b.id]}, format="json").status_code == 400  # must list all
    response = client.post("/api/admin/faqs/reorder/", {"ids": [b.id, a.id]}, format="json")
    assert [f["question_en"] for f in response.data] == ["B?", "A?"]
    assert [f["question"] for f in APIClient().get("/api/faqs/").data] == ["B?", "A?"]


@pytest.mark.django_db
def test_default_faqs_are_seeded_by_migration():
    assert Faq.objects.count() >= 5
