"""The admin KYC queue carries what a reviewer checks a submission against."""
from datetime import date, timedelta

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, AdminProfile, KYCProfile


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def admin(db):
    user = User.objects.create(username="kq_admin", phone="+237699840001")
    AdminProfile.objects.create(user=user)
    return user


def _submit(username, phone, *, legal, born="1990-06-15", national_id="CM-100", first="", last="", email=None):
    extra = {"email": email} if email else {}
    user = User.objects.create(username=username, phone=phone, first_name=first, last_name=last, **extra)
    return KYCProfile.objects.create(
        user=user, legal_full_name=legal, date_of_birth=born, national_id_number=national_id, residential_address="Akwa, Douala",
    )


def _years_ago(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year - years)
    except ValueError:  # 29 February in a non-leap year
        return day.replace(year=day.year - years, day=28)


def _queue(admin):
    response = _client(admin).get("/api/admin/kyc-reviews/")
    assert response.status_code == 200, response.data
    return {row["username"]: row for row in response.data["results"]}


@pytest.mark.django_db
def test_a_submission_carries_the_accounts_contact_details(admin):
    _submit("kq_a", "+237699840010", legal="Amina Fotso", first="Amina", last="Fotso", email="amina@example.com")

    row = _queue(admin)["kq_a"]

    assert row["phone"] == "+237699840010" and row["email"] == "amina@example.com"
    assert row["full_name"] == "Amina Fotso" and row["date_joined"]


@pytest.mark.django_db
def test_age_is_worked_out_from_the_date_of_birth_including_the_birthday_itself(admin):
    today = date.today()
    _submit("kq_adult", "+237699840011", legal="Adult One", born=_years_ago(today, 18).isoformat())
    _submit("kq_minor", "+237699840012", legal="Minor One", born=_years_ago(today + timedelta(days=1), 18).isoformat())

    rows = _queue(admin)

    assert rows["kq_adult"]["age"] == 18
    assert rows["kq_minor"]["age"] == 17


@pytest.mark.django_db
def test_name_match_ignores_case_accents_and_word_order_and_is_unknown_without_an_account_name(admin):
    _submit("kq_same", "+237699840013", legal="FOTSO Aïcha", first="Aicha", last="Fotso")
    _submit("kq_other", "+237699840014", legal="Samuel Etoa", first="Amina", last="Fotso")
    _submit("kq_noname", "+237699840015", legal="Someone Else")

    rows = _queue(admin)

    assert rows["kq_same"]["name_matches_account"] is True
    assert rows["kq_other"]["name_matches_account"] is False
    assert rows["kq_noname"]["name_matches_account"] is None


@pytest.mark.django_db
def test_a_reused_id_number_is_flagged_on_every_submission_that_shares_it(admin):
    _submit("kq_one", "+237699840016", legal="Person One", national_id="CM-777-ABC")
    _submit("kq_two", "+237699840017", legal="Person Two", national_id="cm 777abc ")
    _submit("kq_unique", "+237699840018", legal="Person Three", national_id="CM-999")

    rows = _queue(admin)

    assert rows["kq_one"]["duplicate_id_count"] == 1
    assert rows["kq_two"]["duplicate_id_count"] == 1
    assert rows["kq_unique"]["duplicate_id_count"] == 0


@pytest.mark.django_db
def test_the_queue_stays_at_a_fixed_number_of_queries(admin, django_assert_max_num_queries):
    for index in range(8):
        _submit(f"kq_bulk_{index}", f"+23769984{1000 + index}", legal=f"Applicant {index}", national_id=f"CM-B-{index}")

    # The ID-reuse check is a single query for the whole queue, so the total no longer grows with its length.
    with django_assert_max_num_queries(12):
        assert len(_queue(admin)) == 8
