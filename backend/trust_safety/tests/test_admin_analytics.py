"""Admin analytics: period figures with comparison, series, funnel, response times and breakdowns."""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from identity.models import AdminProfile, AgentProfile, KYCProfile, User, VerificationStatus
from property_management.models import DisputeCase
from transactions.models import Booking, BookingStatus, BookingType, EscrowStatus, PaymentEscrow
from trust_safety.analytics import platform_analytics

URL = "/api/admin/analytics/"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def admin(db):
    user = User.objects.create(username="an_admin", phone="+237699910001", email="an_admin@example.com")
    AdminProfile.objects.create(user=user)
    User.objects.filter(pk=user.pk).update(date_joined=timezone.now() - timedelta(days=400))
    return user


def make_user(name, days_ago, phone):
    user = User.objects.create(username=name, phone=phone, email=f"{name}@example.com")
    User.objects.filter(pk=user.pk).update(date_joined=timezone.now() - timedelta(days=days_ago))
    return User.objects.get(pk=user.pk)


def pay(user, amount, days_ago, *, status=EscrowStatus.HELD, fee="0", booking_type=BookingType.HOTEL, released_days_ago=None):
    booking = Booking.objects.create(
        booking_type=booking_type, target_content_type="hotels.Reservation", target_id=uuid.uuid4(), requester=user,
        status=BookingStatus.CONFIRMED, amount_xaf=Decimal(amount), idempotency_key=f"an-{uuid.uuid4()}",
    )
    escrow = PaymentEscrow.objects.create(
        booking=booking, gross_amount_xaf=Decimal(amount), platform_fee_xaf=Decimal(fee),
        payee_amount_xaf=Decimal(amount) - Decimal(fee), status=status, provider="MTN_MOMO",
        refunded_amount_xaf=Decimal(amount) if status == EscrowStatus.REFUNDED else Decimal("0"),
    )
    updates = {"held_at": timezone.now() - timedelta(days=days_ago)}
    if released_days_ago is not None:
        updates["released_at"] = timezone.now() - timedelta(days=released_days_ago)
    PaymentEscrow.objects.filter(pk=escrow.pk).update(**updates)
    return PaymentEscrow.objects.get(pk=escrow.pk)


@pytest.mark.django_db
def test_only_admins_can_read_analytics(admin):
    regular = make_user("an_regular", 1, "+237699910002")
    assert client_for(regular).get(URL).status_code == 403
    assert APIClient().get(URL).status_code == 401
    assert client_for(admin).get(URL).status_code == 200


@pytest.mark.django_db
def test_only_the_offered_periods_are_accepted(admin):
    client = client_for(admin)
    for days in (7, 30, 90, 365):
        assert client.get(URL, {"days": days}).data["days"] == days
    assert client.get(URL, {"days": 12}).status_code == 400
    assert client.get(URL, {"days": "abc"}).data["days"] == 30


@pytest.mark.django_db
def test_headline_figures_compare_the_period_with_the_one_before(admin):
    for i in range(3):
        make_user(f"an_new{i}", 5, f"+23769991010{i}")
    make_user("an_old", 40, "+237699910110")
    payer = make_user("an_payer", 100, "+237699910111")
    pay(payer, "100000", 3, status=EscrowStatus.RELEASED, fee="5000", released_days_ago=2)
    pay(payer, "50000", 10)
    pay(payer, "40000", 45)  # previous 30-day period
    pay(payer, "20000", 6, status=EscrowStatus.REFUNDED)

    head = platform_analytics(30)["headline"]

    assert head["new_users"] == {"current": 3, "previous": 1, "change": 200.0}
    assert head["paid_bookings"]["current"] == 3 and head["paid_bookings"]["previous"] == 1
    assert head["payment_volume_xaf"] == {"current": "170000.00", "previous": "40000.00", "change": 325.0}
    assert head["fees_earned_xaf"]["current"] == "5000.00" and head["fees_earned_xaf"]["change"] is None  # nothing before: "new"
    assert head["refunded_xaf"]["current"] == "20000.00"


@pytest.mark.django_db
def test_a_7_day_window_excludes_older_activity(admin):
    make_user("an_recent", 2, "+237699910120")
    make_user("an_ten", 10, "+237699910121")

    assert platform_analytics(7)["headline"]["new_users"] == {"current": 1, "previous": 1, "change": 0.0}


@pytest.mark.django_db
def test_series_has_a_point_for_every_day_including_empty_ones(admin):
    make_user("an_s1", 2, "+237699910130")
    payer = make_user("an_s2", 2, "+237699910131")
    pay(payer, "30000", 2)

    series = platform_analytics(7)["series"]

    assert series["interval"] == "day" and len(series["points"]) in (7, 8)
    day = (timezone.localdate() - timedelta(days=2)).isoformat()
    point = next(p for p in series["points"] if p["date"] == day)
    assert point["new_users"] == 2 and point["paid_bookings"] == 1 and point["payment_volume_xaf"] == "30000.00"
    assert sum(p["paid_bookings"] for p in series["points"]) == 1


@pytest.mark.django_db
def test_a_year_is_shown_week_by_week(admin):
    series = platform_analytics(365)["series"]
    assert series["interval"] == "week" and 52 <= len(series["points"]) <= 54


@pytest.mark.django_db
def test_the_funnel_follows_people_who_joined_in_the_period(admin):
    a = make_user("an_f1", 3, "+237699910140")
    b = make_user("an_f2", 3, "+237699910141")
    make_user("an_f3", 3, "+237699910142")
    make_user("an_f_old", 60, "+237699910143")
    KYCProfile.objects.create(user=a, legal_full_name="A", date_of_birth="1990-01-01", national_id_number="AN-1", residential_address="x", kyc_status=VerificationStatus.VERIFIED)
    KYCProfile.objects.create(user=b, legal_full_name="B", date_of_birth="1990-01-01", national_id_number="AN-2", residential_address="x")
    pay(a, "10000", 1)

    funnel = {step["step"]: step for step in platform_analytics(30)["funnel"]}

    assert funnel["joined"]["count"] == 3
    assert funnel["kyc_submitted"] == {"step": "kyc_submitted", "count": 2, "percent": 66.7}
    assert funnel["kyc_verified"]["count"] == 1 and funnel["paid_booking"]["count"] == 1
    assert funnel["listed_something"]["count"] == 0


@pytest.mark.django_db
def test_an_empty_period_gives_no_percentages(admin):
    funnel = platform_analytics(7)["funnel"]
    assert funnel[0] == {"step": "joined", "count": 0, "percent": None}


@pytest.mark.django_db
def test_response_times_are_medians_in_hours(admin):
    now = timezone.now()
    people = [make_user(f"an_k{i}", 50, f"+23769991015{i}") for i in range(3)]
    for i, (user, hours) in enumerate(zip(people, (2, 10, 30))):
        kyc = KYCProfile.objects.create(user=user, legal_full_name="K", date_of_birth="1990-01-01", national_id_number=f"AN-K{i}", residential_address="x")
        KYCProfile.objects.filter(pk=kyc.pk).update(submitted_at=now - timedelta(days=3, hours=hours), reviewed_at=now - timedelta(days=3))
    payer = make_user("an_d", 50, "+237699910160")
    escrow = pay(payer, "10000", 5, status=EscrowStatus.DISPUTED)
    DisputeCase.objects.create(
        escrow=escrow, raised_by=payer, reason="x", created_at=now - timedelta(days=4), response_due_at=now, resolution_due_at=now,
        resolved_at=now - timedelta(days=3),
    )

    speed = platform_analytics(30)["speed"]

    assert speed["kyc_review"] == {"median_hours": 10.0, "count": 3}
    assert speed["dispute_resolution"] == {"median_hours": 24.0, "count": 1}
    assert speed["withdrawal_review"] == {"median_hours": None, "count": 0}


@pytest.mark.django_db
def test_breakdowns_by_service_neighbourhood_and_role(admin):
    from django.core.management import call_command
    from geo.models import Quarter
    from property.models import House, Listing, ListingStatus, ListingType
    call_command("seed_cameroon_geography")
    bastos = Quarter.objects.get(name="Bastos")

    payer = make_user("an_b", 50, "+237699910170")
    pay(payer, "80000", 2, booking_type=BookingType.HOTEL)
    pay(payer, "20000", 2, booking_type=BookingType.RIDE)
    owner = make_user("an_owner", 50, "+237699910171")
    house = House.objects.create(owner=owner, quarter=bastos, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=owner, listing_type=ListingType.RENT, price_xaf=Decimal("90000"), status=ListingStatus.PUBLISHED)
    Listing.objects.filter(pk=listing.pk).update(published_at=timezone.now() - timedelta(days=1))
    AgentProfile.objects.create(user=make_user("an_agent", 1, "+237699910172"), agent_commission_percent=Decimal("2"))

    breakdowns = platform_analytics(30)["breakdowns"]

    assert [row["booking_type"] for row in breakdowns["by_service"]] == ["HOTEL", "RIDE"]
    assert breakdowns["by_service"][0]["volume_xaf"] == "80000.00" and breakdowns["by_service"][0]["label"] == "Hotel"
    assert breakdowns["top_neighbourhoods"] == [{"name": "Bastos", "count": 1}]
    assert breakdowns["new_providers"]["agents"] == 1 and breakdowns["new_providers"]["landlords"] == 0
