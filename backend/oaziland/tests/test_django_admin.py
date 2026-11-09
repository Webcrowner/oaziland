"""/admin/ (Django admin): who can use it, what is view-only or masked, and that changes are audited."""
import pytest
from django.contrib import admin
from django.test import Client
from django.urls import reverse

from identity.models import AdminProfile, KYCProfile, User
from trust_safety.models import AuditLog


def _user(name, phone, *, staff=True, admin_permissions=None, superuser=False):
    user = User.objects.create(username=name, phone=phone, email=f"{name}@example.com", is_staff=staff, is_superuser=superuser)
    if admin_permissions is not None:
        AdminProfile.objects.create(user=user, permissions=admin_permissions)
    return user


def _client(user):
    client = Client()
    client.force_login(user)
    return client


@pytest.fixture(autouse=True)
def plain_static_files(settings):
    # Admin pages link their CSS; tests run without collectstatic, so skip the hashed manifest.
    settings.STORAGES = {**settings.STORAGES, "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}


@pytest.fixture
def full_admin(db):
    return _user("da_full", "+237699970001", admin_permissions=[])


def _url(model, view, *args):
    return reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_{view}", args=args)


@pytest.mark.django_db
def test_every_registered_page_loads_and_its_search_works(full_admin):
    client = _client(full_admin)
    assert client.get(reverse("admin:index")).status_code == 200
    for model, model_admin in admin.site._registry.items():
        if model._meta.app_label == "auth":
            continue
        response = client.get(_url(model, "changelist"), {"q": "zz"} if model_admin.search_fields else {})
        assert response.status_code == 200, (model._meta.label, response.status_code)
        add = client.get(_url(model, "add"))
        assert add.status_code == (403 if model_admin.read_only else 200), (model._meta.label, add.status_code)


@pytest.mark.django_db
def test_only_full_access_admins_see_anything_and_everyone_else_is_sent_to_the_console_login(full_admin, settings):
    limited = _user("da_limited", "+237699970002", admin_permissions=["kyc"])
    staff_only = _user("da_staff", "+237699970003")
    not_staff_admin = _user("da_notstaff", "+237699970004", staff=False, admin_permissions=[])

    for user in (limited, staff_only, None):
        client = _client(user) if user else Client()
        response = client.get(_url(User, "changelist"))
        assert response.status_code == 302
        login_redirect = client.get(response["Location"])
        assert login_redirect.status_code == 302 and login_redirect["Location"].startswith(f"{settings.WEB_BASE_URL}/en/admin/login?to=data-admin")
    # The admin role decides, not Django's is_staff flag.
    assert _client(not_staff_admin).get(_url(User, "changelist")).status_code == 200
    assert _client(full_admin).get(_url(User, "changelist")).status_code == 200
    superuser = _user("da_super", "+237699970005", superuser=True)
    assert _client(superuser).get(_url(User, "changelist")).status_code == 200


@pytest.mark.django_db
def test_the_data_admin_has_no_password_login_of_its_own(full_admin, settings):
    full_admin.set_password("Corr3ct-Pass!")
    full_admin.save()
    client = Client()

    page = client.get(reverse("admin:login"), {"next": "/admin/identity/user/"})
    assert page.status_code == 302
    assert page["Location"] == f"{settings.WEB_BASE_URL}/en/admin/login?to=data-admin&next=%2Fadmin%2Fidentity%2Fuser%2F"

    posted = client.post(reverse("admin:login"), {"username": full_admin.username, "password": "Corr3ct-Pass!"})
    assert posted.status_code == 302 and posted["Location"].startswith(settings.WEB_BASE_URL)
    assert client.get(reverse("admin:index")).status_code == 302  # still not signed in

    # Off-site "next" values are dropped.
    evil = client.get(reverse("admin:login"), {"next": "https://evil.example/admin/"})
    assert "evil" not in evil["Location"]
    assert client.get(reverse("admin:password_change")).status_code in (302,)


@pytest.mark.django_db
def test_the_console_hands_a_full_access_admin_over_with_a_one_time_pass(full_admin):
    from rest_framework.test import APIClient

    api = APIClient()
    api.force_authenticate(full_admin)
    response = api.post("/api/admin/data-admin-ticket/", {"next": "/admin/geo/quarter/"}, format="json")
    assert response.status_code == 200, response.data
    url = response.data["url"]
    path = url.split("://", 1)[1].split("/", 1)[1]
    assert path.startswith("admin/sso/?ticket=")

    browser = Client()
    landing = browser.get("/" + path)
    assert landing.status_code == 302 and landing["Location"] == "/admin/geo/quarter/"
    assert browser.get(reverse("admin:index")).status_code == 200

    # The pass works once only.
    other = Client()
    assert other.get("/" + path).status_code == 302
    assert other.get(reverse("admin:index")).status_code == 302
    assert AuditLog.objects.filter(actor=full_admin, action="DataAdminTicketView/post").exists()


@pytest.mark.django_db
def test_limited_admins_and_ordinary_users_get_no_pass_and_forged_passes_fail(full_admin):
    from rest_framework.test import APIClient

    limited = _user("da_limited2", "+237699970010", admin_permissions=["kyc"])
    ordinary = _user("da_plain", "+237699970011", staff=False)
    for user in (limited, ordinary):
        api = APIClient()
        api.force_authenticate(user)
        assert api.post("/api/admin/data-admin-ticket/").status_code == 403
    assert APIClient().post("/api/admin/data-admin-ticket/").status_code == 401

    browser = Client()
    browser.get(reverse("admin:sso"), {"ticket": "forged.value"})
    assert browser.get(reverse("admin:index")).status_code == 302

    # A pass issued to someone who has since lost full access is refused.
    from oaziland.admin_site import issue_ticket

    ticket = issue_ticket(full_admin)
    AdminProfile.objects.filter(user=full_admin).update(permissions=["kyc"])
    browser.get(reverse("admin:sso"), {"ticket": ticket})
    assert browser.get(reverse("admin:index")).status_code == 302


@pytest.mark.django_db
def test_user_page_hides_the_password_and_protects_role_and_status_fields(full_admin):
    person = _user("da_person", "+237699970006", staff=False)
    person.set_password("S3cret-Pass!")
    person.save()

    page = _client(full_admin).get(_url(User, "change", person.pk)).content.decode()

    assert "pbkdf2" not in page and 'name="password"' not in page
    for field in ("account_status", "is_superuser", "is_staff", "verification_status"):
        assert f'name="{field}"' not in page
    assert 'name="phone"' in page and 'name="first_name"' in page


@pytest.mark.django_db
def test_kyc_is_view_only_with_the_id_number_masked_and_documents_hidden(full_admin):
    person = _user("da_kyc", "+237699970007", staff=False)
    kyc = KYCProfile.objects.create(
        user=person, legal_full_name="Amina Kyc", national_id_number="CM1234567890", date_of_birth="1995-04-12",
        id_document_front_image_url="https://example.com/front-secret.jpg", residential_address="12 Rue Secrete",
    )
    client = _client(full_admin)

    page = client.get(_url(KYCProfile, "change", kyc.pk)).content.decode()

    assert "CM1234567890" not in page and "7890" in page
    assert "front-secret" not in page and "Rue Secrete" not in page
    response = client.post(_url(KYCProfile, "change", kyc.pk), {"legal_full_name": "Changed"})
    assert response.status_code == 403
    kyc.refresh_from_db()
    assert kyc.legal_full_name == "Amina Kyc"


@pytest.mark.django_db
def test_money_records_cannot_be_changed_or_deleted(full_admin):
    import uuid
    from decimal import Decimal

    from transactions.models import Booking

    booking = Booking.objects.create(
        booking_type="GENERAL_RENTAL", target_content_type="property.Listing", target_id=uuid.uuid4(), requester=full_admin,
        amount_xaf=Decimal("50000"), idempotency_key="da-test-booking",
    )
    client = _client(full_admin)

    assert client.get(_url(Booking, "change", booking.pk)).status_code == 200
    assert client.post(_url(Booking, "change", booking.pk), {"amount_xaf": "1"}).status_code == 403
    assert client.post(_url(Booking, "delete", booking.pk), {"post": "yes"}).status_code == 403
    booking.refresh_from_db()
    assert booking.amount_xaf == Decimal("50000")


@pytest.mark.django_db
def test_changes_are_written_to_the_audit_log_without_values(full_admin):
    from geo.models import Country

    client = _client(full_admin)
    response = client.post(_url(Country, "add"), {"name": "Testland", "iso_code": "TSL"})
    assert response.status_code == 302, response.content.decode()[:2000]
    country = Country.objects.get(iso_code="TSL")
    client.post(_url(Country, "change", country.pk), {"name": "Testland Republic", "iso_code": "TSL"})
    client.post(_url(Country, "delete", country.pk), {"post": "yes"})

    actions = list(AuditLog.objects.filter(actor=full_admin).order_by("created_at").values_list("action", "details"))
    assert [action for action, _ in actions] == ["django-admin/country/add", "django-admin/country/change", "django-admin/country/delete"]
    assert actions[1][1] == {"fields": ["Name"]}  # the field's label, never its old or new value
    assert not Country.objects.filter(iso_code="TSL").exists()


@pytest.mark.django_db
def test_most_records_cannot_be_deleted_from_admin(full_admin):
    person = _user("da_keep", "+237699970008", staff=False)
    response = _client(full_admin).post(_url(User, "delete", person.pk), {"post": "yes"})
    assert response.status_code == 403 and User.objects.filter(pk=person.pk).exists()
