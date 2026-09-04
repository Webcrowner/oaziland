"""
Prompt 21 — end-to-end tests covering the FULL booking flow for three
different property types, per the explicit requirement: a house
rental, a land reservation, and a student hostel allocation. Each test
walks the entire real journey (not isolated unit checks) through the
actual service functions a real request would trigger.
"""
import pytest
from decimal import Decimal
from datetime import date

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from land.models import Land, LandUseType, TitleType
from land.services import generate_due_diligence_report
from transactions.models import BookingType, BookingStatus, EscrowStatus
from transactions.services import reserve_booking, initiate_booking_payment, confirm_payment
from payments.gateways import SandboxGateway
from monetization.models import PlatformFeePolicy, TransactionCategory
from notifications.models import Notification

from student_hostels.models import (
    OwnerProfile, OwnerType, HostelPropertyType, HostelUnit, HostelUnitType,
    OccupancyModel, BedSlot, Semester, PartnerInstitution, HostelBilling, BillingCycle,
)
from student_hostels.services import create_student_hostel, allocate_room, create_installment_plan, pay_installment


class FakeLock:
    def __init__(self):
        self.locked = set()

    def acquire(self, key, ttl_seconds):
        if key in self.locked:
            return False
        self.locked.add(key)
        return True

    def release(self, key, permanent=False):
        self.locked.discard(key)


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def fee_policy(db):
    PlatformFeePolicy.objects.get_or_create(category=TransactionCategory.PROPERTY_BOOKING, defaults={"fee_percent": Decimal("3.0")})


@pytest.mark.django_db
def test_e2e_house_rental_full_journey(quarter, fee_policy):
    """Journey: landlord publishes a house -> guest reserves it ->
    pays -> booking confirms -> guest is notified -> booking completes."""
    landlord = User.objects.create(username="e2e_house_landlord", phone="+237699999701")
    guest = User.objects.create(username="e2e_house_guest", phone="+237699999702")

    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", size_sqm=Decimal("120"))
    listing = Listing.objects.create(
        property_asset=house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("150000"),
    )

    lock = FakeLock()
    gateway = SandboxGateway()

    booking = reserve_booking(
        lock_client=lock, requester=guest, booking_type=BookingType.GENERAL_RENTAL,
        target_content_type="property.Listing", target_id=listing.id, amount_xaf=listing.price_xaf,
    )
    assert booking.status == BookingStatus.PENDING

    initiate_booking_payment(booking=booking, payment_gateway=gateway, phone_number="+237670001001")
    assert booking.status == BookingStatus.PAYMENT_PROCESSING

    escrow = confirm_payment(
        lock_client=lock, booking=booking, provider="MTN_MOMO", provider_reference=booking.idempotency_key,
        payment_gateway=gateway, raw_webhook_payload=b"{}", webhook_signature_header="sandbox",
    )
    booking.refresh_from_db()
    assert booking.status == BookingStatus.CONFIRMED
    assert escrow.status == EscrowStatus.HELD

    # The guest was actually notified — the real end-to-end proof, not
    # just that the database rows look right.
    assert Notification.objects.filter(recipient=guest, notification_type="BOOKING_CONFIRMED").exists()
    assert Notification.objects.filter(recipient=guest, notification_type="BOOKING_RECEIPT").exists()

    booking.complete()
    assert booking.status == BookingStatus.COMPLETED


@pytest.mark.django_db
def test_e2e_land_reservation_full_journey_with_due_diligence(quarter, fee_policy):
    """Journey: land is listed -> a buyer runs due diligence BEFORE
    reserving (the real-world order for the platform's highest-fraud-
    risk asset type) -> reservation -> payment -> confirmation."""
    seller = User.objects.create(username="e2e_land_seller", phone="+237699999703")
    buyer = User.objects.create(username="e2e_land_buyer", phone="+237699999704")

    land = Land.objects.create(
        owner=seller, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL,
        title_deed_number="TF-9001", title_type=TitleType.TITRE_FONCIER,
    )
    listing = Listing.objects.create(
        property_asset=land, listed_by=seller, listing_type=ListingType.SALE,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("15000000"),
    )

    report = generate_due_diligence_report(land=land, requested_by=buyer)
    assert report.overall_risk_level in ("LOW", "MEDIUM")  # buyer proceeds only because risk isn't HIGH

    lock = FakeLock()
    gateway = SandboxGateway()

    booking = reserve_booking(
        lock_client=lock, requester=buyer, booking_type=BookingType.LAND_RESERVATION,
        target_content_type="property.Listing", target_id=listing.id, amount_xaf=listing.price_xaf,
    )
    initiate_booking_payment(booking=booking, payment_gateway=gateway, phone_number="+237670001002")
    escrow = confirm_payment(
        lock_client=lock, booking=booking, provider="ORANGE_MONEY", provider_reference=booking.idempotency_key,
        payment_gateway=gateway, raw_webhook_payload=b"{}", webhook_signature_header="sandbox",
    )

    booking.refresh_from_db()
    assert booking.status == BookingStatus.CONFIRMED
    assert escrow.gross_amount_xaf == Decimal("15000000")
    assert Notification.objects.filter(recipient=buyer, notification_type="BOOKING_CONFIRMED").exists()


@pytest.mark.django_db
def test_e2e_student_hostel_allocation_full_journey(quarter):
    """Journey: hostel + unit exist -> a student is allocated a bed for
    the semester -> billed -> pays in installments -> bill settles."""
    owner_user = User.objects.create(username="e2e_hostel_owner", phone="+237699999705")
    student = User.objects.create(username="e2e_hostel_student", phone="+237699999706")

    owner = OwnerProfile.objects.create(account_user=owner_user, owner_type=OwnerType.LANDLORD)
    hostel = create_student_hostel(owner_profile=owner, quarter=quarter, property_type=HostelPropertyType.BLOCK)
    unit = HostelUnit.objects.create(
        building=hostel.building_ptr, room_code="E2E-101", unit_type=HostelUnitType.SHARED_ROOM,
        occupancy_model=OccupancyModel.PER_BED, bed_capacity=2,
    )
    BedSlot.objects.create(unit=unit, bed_number=1)

    institution = PartnerInstitution.objects.create(name="ICT University")
    semester = Semester.objects.create(
        institution=institution, name="2026/2027 First Semester",
        start_date=date(2026, 9, 1), end_date=date(2027, 1, 31), billing_due_date=date(2026, 9, 15),
    )

    allocation = allocate_room(student=student, unit=unit, semester=semester)
    assert allocation.bed_slot is not None

    billing = HostelBilling.objects.create(
        allocation=allocation, billing_cycle=BillingCycle.SEMESTER,
        amount_xaf=Decimal("250000"), due_date=semester.billing_due_date,
    )
    plan = create_installment_plan(billing=billing, num_installments=2)
    installments = list(plan.installments.all())

    pay_installment(installments[0])
    billing.refresh_from_db()
    assert billing.status == "PENDING"  # only half paid so far

    pay_installment(installments[1])
    billing.refresh_from_db()
    assert billing.status == "PAID"  # fully settled — the real end state of this journey
