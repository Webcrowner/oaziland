"""Hostel and venue reviews: only real customers can write them, once each; everyone can read them; owners hear about them."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from events.models import EventBooking, EventBookingStatus, Venue, VenueReview, VenueSpace
from identity.models import User
from marketplace.tests.test_marketplace_api import _auth_client
from notifications.models import Notification
from property_management.tests.test_maintenance_leases_safety import quarter  # noqa: F401
from rest_framework.test import APIClient
from student_hostels.models import (
    HostelReview, HostelUnit, OwnerProfile, OwnerType, PartnerInstitution, RoomAllocation, RoomAllocationStatus, Semester,
)
from student_hostels.services import create_student_hostel


@pytest.fixture
def owner(db):
    return User.objects.create(username="pr_owner", phone="+237699520001", first_name="Olive", last_name="Owner")


@pytest.fixture
def hostel(owner, quarter):
    profile = OwnerProfile.objects.create(account_user=owner, owner_type=OwnerType.LANDLORD)
    return create_student_hostel(owner_profile=profile, quarter=quarter, property_type="BLOCK")


def house(hostel, student, status=RoomAllocationStatus.ENDED):
    unit = HostelUnit.objects.create(building=hostel, room_code=f"R-{student.username}", unit_type="STUDIO", occupancy_model="PER_UNIT", bed_capacity=1)
    institution = PartnerInstitution.objects.create(name=f"Uni {student.username}")
    semester = Semester.objects.create(
        institution=institution, name="S1", start_date=date(2026, 1, 1), end_date=date(2026, 6, 30), billing_due_date=date(2026, 1, 5),
    )
    return RoomAllocation.objects.create(student=student, unit=unit, semester=semester, status=status)


@pytest.fixture
def venue(owner, quarter):
    venue = Venue.objects.create(owner=owner, quarter=quarter, type="EVENT_CENTER", verified=True)
    VenueSpace.objects.create(venue=venue, space_name="Main Hall", base_price_per_hour_xaf=Decimal("10000"))
    return venue


def event(venue, organiser, days_ago, status=EventBookingStatus.COMPLETED):
    return EventBooking.objects.create(
        organiser=organiser, venue_space=venue.spaces.first(), event_type="WEDDING",
        event_date=timezone.localdate() - timedelta(days=days_ago), start_time="10:00", end_time="14:00",
        guest_count=50, status=status, total_cost_xaf=Decimal("40000"),
    )


@pytest.mark.django_db
def test_a_former_resident_can_review_a_hostel_once_and_the_owner_is_told(owner, hostel):
    student = User.objects.create(username="pr_student", phone="+237699520002", first_name="Sam", last_name="Student")
    url = f"/api/student-hostels/{hostel.pk}/reviews/"
    assert _auth_client(student).get(url).data["cannot_review_reason"] == "no_stay"
    assert _auth_client(student).post(url, {"score": 4, "text": "Quiet"}, format="json").status_code == 400

    house(hostel, student)
    assert _auth_client(student).get(url).data["can_review"] is True
    for bad in ({"score": 0}, {"score": 6}, {"score": "x"}, {"score": 3, "text": "y" * 2001}):
        assert _auth_client(student).post(url, bad, format="json").status_code == 400, bad

    created = _auth_client(student).post(url, {"score": 4, "text": "Quiet and clean"}, format="json")
    assert created.status_code == 201, created.data
    assert created.data["count"] == 1 and created.data["average"] == 4.0 and created.data["can_review"] is False
    row = created.data["results"][0]
    assert row["author_name"] == "Sam Student" and row["text"] == "Quiet and clean" and row["detail"] == "STUDIO" and row["is_mine"] is True
    assert HostelReview.objects.get().unit_type == "STUDIO"
    assert Notification.objects.filter(recipient=owner, notification_type="NEW_REVIEW", title="New review of your hostel").exists()

    again = _auth_client(student).post(url, {"score": 5}, format="json")
    assert again.status_code == 400 and "already reviewed" in again.data["detail"]


@pytest.mark.django_db
def test_hostel_reviews_are_public_and_owners_cannot_review_their_own(owner, hostel):
    url = f"/api/student-hostels/{hostel.pk}/reviews/"
    anonymous = APIClient().get(url)
    assert anonymous.status_code == 200 and anonymous.data == {
        "count": 0, "average": None, "results": [], "can_review": False, "cannot_review_reason": "sign_in",
    }
    assert APIClient().post(url, {"score": 5}, format="json").status_code == 401
    assert _auth_client(owner).get(url).data["cannot_review_reason"] == "own_place"


@pytest.mark.django_db
def test_only_organisers_whose_event_took_place_can_review_a_venue(owner, venue):
    organiser = User.objects.create(username="pr_org", phone="+237699520003")
    url = f"/api/venues/{venue.pk}/reviews/"

    event(venue, organiser, days_ago=-5)  # still to come
    event(venue, organiser, days_ago=3, status=EventBookingStatus.CANCELLED)
    assert _auth_client(organiser).get(url).data["cannot_review_reason"] == "no_event"

    past = event(venue, organiser, days_ago=10)
    created = _auth_client(organiser).post(url, {"score": 2, "text": "Generator failed"}, format="json")
    assert created.status_code == 201, created.data
    review = VenueReview.objects.get()
    assert review.rating == 2 and review.event_date == past.event_date
    assert created.data["results"][0]["detail"] == past.event_date
    assert Notification.objects.filter(recipient=owner, title="New review of your venue").exists()


@pytest.mark.django_db
def test_reviews_of_a_place_taken_down_are_hidden_with_it(owner, venue):
    venue.deleted_at = timezone.now()
    venue.save(update_fields=["deleted_at"])
    assert APIClient().get(f"/api/venues/{venue.pk}/reviews/").status_code == 404


@pytest.mark.django_db
def test_a_decided_id_check_always_has_a_review_date(owner):
    from identity.models import KYCProfile, VerificationStatus

    kyc = KYCProfile.objects.create(
        user=owner, legal_full_name="O", date_of_birth="1990-01-01", national_id_number="PR-1", residential_address="x",
        kyc_status=VerificationStatus.VERIFIED,
    )
    assert kyc.reviewed_at is not None
    pending = KYCProfile.objects.create(
        user=User.objects.create(username="pr_pending", phone="+237699520009"), legal_full_name="P", date_of_birth="1990-01-01",
        national_id_number="PR-2", residential_address="x",
    )
    assert pending.reviewed_at is None
    pending.kyc_status = VerificationStatus.REJECTED
    pending.save(update_fields=["kyc_status"])
    pending.refresh_from_db()
    assert pending.reviewed_at is not None
