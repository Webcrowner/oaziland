"""
Tests for birthday, happy-new-month, and platform-anniversary
greetings — personalized with the user's name, sent only to eligible
active users, and never duplicated if the daily job runs twice.
"""
import pytest
from datetime import date, timedelta

from identity.models import User, KYCProfile, AccountStatus, VerificationStatus
from notifications.services import (
    send_birthday_greetings, send_happy_new_month_greetings, send_platform_anniversary_greetings,
)
from notifications.models import Notification


def _make_user_with_birthday(username, phone, birth_month, birth_day, full_name=""):
    user = User.objects.create(username=username, phone=phone, first_name=full_name)
    KYCProfile.objects.create(
        user=user, legal_full_name=full_name or username,
        date_of_birth=date(1990, birth_month, birth_day),
        national_id_number=f"ID-{username}", residential_address="Bastos",
    )
    return user


@pytest.mark.django_db
def test_birthday_greeting_sent_to_matching_user_only():
    today = date(2026, 6, 15)
    birthday_user = _make_user_with_birthday("bday_user", "+237699999501", 6, 15, "Jean Doe")
    other_user = _make_user_with_birthday("not_bday_user", "+237699999502", 8, 20, "Marie Doe")

    sent = send_birthday_greetings(today=today)

    assert len(sent) == 1
    notification = Notification.objects.get(recipient=birthday_user, notification_type="BIRTHDAY_GREETING")
    assert "Jean Doe" in notification.message
    assert Notification.objects.filter(recipient=other_user, notification_type="BIRTHDAY_GREETING").exists() is False


@pytest.mark.django_db
def test_birthday_greeting_skips_users_with_no_kyc_on_file():
    User.objects.create(username="no_kyc_user", phone="+237699999503")
    sent = send_birthday_greetings(today=date(2026, 6, 15))
    assert len(sent) == 0  # no error, just correctly nothing to send


@pytest.mark.django_db
def test_birthday_greeting_skips_suspended_or_banned_users():
    today = date(2026, 6, 15)
    suspended_user = _make_user_with_birthday("suspended_bday", "+237699999504", 6, 15, "Suspended User")
    suspended_user.account_status = AccountStatus.SUSPENDED
    suspended_user.save()

    sent = send_birthday_greetings(today=today)
    assert len(sent) == 0


@pytest.mark.django_db
def test_birthday_greeting_never_sent_twice_the_same_day():
    today = date(2026, 6, 15)
    _make_user_with_birthday("bday_once", "+237699999505", 6, 15, "Once User")

    first_run = send_birthday_greetings(today=today)
    second_run = send_birthday_greetings(today=today)

    assert len(first_run) == 1
    assert len(second_run) == 0  # already greeted today — not duplicated


@pytest.mark.django_db
def test_happy_new_month_only_sends_on_the_first_of_the_month():
    User.objects.create(username="month_user", phone="+237699999506", first_name="Amara")

    not_first_day = send_happy_new_month_greetings(today=date(2026, 7, 15))
    assert len(not_first_day) == 0

    first_day = send_happy_new_month_greetings(today=date(2026, 7, 1))
    assert len(first_day) == 1
    notification = Notification.objects.get(notification_type="HAPPY_NEW_MONTH")
    assert "Amara" in notification.message
    assert "July" in notification.message


@pytest.mark.django_db
def test_platform_anniversary_requires_at_least_one_full_year():
    today = date(2026, 3, 10)
    brand_new_user = User.objects.create(username="anniv_new_user", phone="+237699999507", first_name="New Person")
    from django.utils import timezone
    brand_new_user.date_joined = timezone.make_aware(timezone.datetime(2026, 3, 10))  # joined TODAY, zero years elapsed
    brand_new_user.save()

    sent = send_platform_anniversary_greetings(today=today)
    assert len(sent) == 0  # correctly NOT congratulated for a same-day 'anniversary'


@pytest.mark.django_db
def test_platform_anniversary_greeting_after_a_real_year():
    today = date(2026, 3, 10)
    veteran_user = User.objects.create(username="anniv_veteran_user", phone="+237699999508", first_name="Veteran Person")
    from django.utils import timezone
    veteran_user.date_joined = timezone.make_aware(timezone.datetime(2023, 3, 10))  # exactly 3 years ago today
    veteran_user.save()

    sent = send_platform_anniversary_greetings(today=today)
    assert len(sent) == 1
    notification = Notification.objects.get(notification_type="PLATFORM_ANNIVERSARY")
    assert "3-Year" in notification.title
    assert "Veteran Person" in notification.message


@pytest.mark.django_db
def test_platform_anniversary_only_matches_the_correct_day():
    off_by_one_user = User.objects.create(username="anniv_off_by_one", phone="+237699999509")
    from django.utils import timezone
    off_by_one_user.date_joined = timezone.make_aware(timezone.datetime(2023, 3, 11))  # one day off from "today"
    off_by_one_user.save()

    sent = send_platform_anniversary_greetings(today=date(2026, 3, 10))
    assert len(sent) == 0


@pytest.mark.django_db
def test_greeting_settings_toggle_and_custom_message():
    from notifications.models import GreetingSettings
    from rest_framework.test import APIClient
    from identity.models import AdminProfile

    # 1. Customize settings via GreetingSettings
    settings = GreetingSettings.get_settings()
    settings.birthday_enabled = False
    settings.new_month_title = "Greetings from Oaziland for {month}"
    settings.new_month_message = "Hello {name}, enjoy this wonderful {month}!"
    settings.save()

    # Birthday should now be skipped because it is toggled off
    today = date(2026, 6, 15)
    _make_user_with_birthday("bday_custom_user", "+237699999510", 6, 15, "Chloe Doe")
    sent_bday = send_birthday_greetings(today=today)
    assert len(sent_bday) == 0

    # New month should use custom title and message
    month_user = User.objects.create(username="month_custom_user", phone="+237699999511", first_name="Chloe")
    send_happy_new_month_greetings(today=date(2026, 6, 1))
    notification = Notification.objects.get(recipient=month_user, notification_type="HAPPY_NEW_MONTH")
    assert notification.title == "Greetings from Oaziland for June"
    assert notification.message == "Hello Chloe, enjoy this wonderful June!"

    # 2. Verify admin endpoint access
    admin_user = User.objects.create(username="greetings_admin", phone="+237699999512", is_staff=True)
    AdminProfile.objects.create(user=admin_user, permissions=[])
    client = APIClient()
    client.force_authenticate(user=admin_user)

    get_resp = client.get("/api/admin/greeting-settings/")
    assert get_resp.status_code == 200
    assert get_resp.data["birthday_enabled"] is False

    put_resp = client.put("/api/admin/greeting-settings/", {
        "birthday_enabled": True,
        "birthday_title": "Happy Birthday {name}!",
        "birthday_message": "Have a great birthday, {name}!",
    }, format="json")
    assert put_resp.status_code == 200
    assert put_resp.data["birthday_enabled"] is True
    assert put_resp.data["birthday_title"] == "Happy Birthday {name}!"
