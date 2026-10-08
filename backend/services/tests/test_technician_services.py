"""
Tests proving Prompt 10's exact acceptance criteria: a plumber service
request, paid through Oaziland's OWN payment/escrow system (never
Taskln's), completes successfully — plus the fixed specialty list,
proximity matching, and the open Taskln-trust configuration flag.
"""
import pytest
from decimal import Decimal

from identity.models import User, TechnicianProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from services.models import (
    ServiceCategory, ServiceRequestStatus, TechnicianLocationPing,
    TasklnWorkerRecord, TasklnIntegrationSettings,
)
from services.services import (
    set_technician_specialties, InvalidSpecialtyError,
    find_available_technicians, create_service_request, accept_service_request,
    start_service, complete_service_request_with_payment,
    lookup_taskln_worker, is_pre_verified_via_taskln,
)
from payments.gateways import SandboxGateway
from monetization.models import PlatformFeePolicy, TransactionCategory


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
def plumber(db, quarter):
    user = User.objects.create(username="test_plumber", phone="+237699100001")
    profile = TechnicianProfile.objects.create(user=user, coverage_quarter=quarter, is_verified=True)
    set_technician_specialties(profile, [ServiceCategory.PLUMBING])
    TechnicianLocationPing.objects.create(technician=user, latitude=Decimal("3.8800"), longitude=Decimal("11.5210"))
    return user


@pytest.mark.django_db
def test_specialty_list_is_enforced(db):
    user = User.objects.create(username="bad_specialty_tech", phone="+237699100002")
    profile = TechnicianProfile.objects.create(user=user)

    with pytest.raises(InvalidSpecialtyError):
        set_technician_specialties(profile, ["ASTROLOGY"])  # not on the fixed list

    set_technician_specialties(profile, [ServiceCategory.ELECTRICAL, ServiceCategory.PLUMBING])
    profile.refresh_from_db()
    assert profile.specialties == [ServiceCategory.ELECTRICAL, ServiceCategory.PLUMBING]


@pytest.mark.django_db
def test_find_available_technicians_matches_specialty_and_proximity(plumber):
    nearby_match = find_available_technicians(
        category=ServiceCategory.PLUMBING, latitude=Decimal("3.8790"), longitude=Decimal("11.5200"), radius_km=5,
    )
    assert len(nearby_match) == 1
    assert nearby_match[0][0].user == plumber

    # Same technician, same category, but searching from Douala (~195km away) — should NOT match.
    far_search = find_available_technicians(
        category=ServiceCategory.PLUMBING, latitude=Decimal("4.0511"), longitude=Decimal("9.7679"), radius_km=5,
    )
    assert len(far_search) == 0

    # Searching for a category the technician doesn't have — should NOT match.
    wrong_category = find_available_technicians(
        category=ServiceCategory.ELECTRICAL, latitude=Decimal("3.8790"), longitude=Decimal("11.5200"), radius_km=5,
    )
    assert len(wrong_category) == 0


@pytest.mark.django_db
def test_full_plumber_service_request_paid_through_oaziland_escrow(plumber, quarter):
    """Prompt 10's literal acceptance criteria."""
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.SERVICE_PAYMENT, defaults={"fee_percent": Decimal("4.0")})
    homeowner = User.objects.create(username="service_homeowner", phone="+237699100003")

    request = create_service_request(
        requester=homeowner, category=ServiceCategory.PLUMBING,
        description="Leaking pipe under the kitchen sink", quarter=quarter,
    )
    assert request.status == ServiceRequestStatus.REQUESTED

    accept_service_request(service_request=request, technician=plumber)
    request.refresh_from_db()
    assert request.status == ServiceRequestStatus.ACCEPTED
    assert request.technician == plumber

    start_service(request)
    request.refresh_from_db()
    assert request.status == ServiceRequestStatus.IN_PROGRESS

    lock = FakeLock()
    gateway = SandboxGateway()
    booking, escrow = complete_service_request_with_payment(
        service_request=request, amount_xaf=Decimal("15000"),
        lock_client=lock, payment_gateway=gateway, phone_number="+237670000099",
    )

    request.refresh_from_db()
    assert request.status == ServiceRequestStatus.COMPLETED
    assert request.booking == booking
    assert booking.booking_type == "SERVICE_REQUEST"
    assert escrow.status == "RELEASED"  # the technician actually gets paid now, not held forever
    # The SERVICE_PAYMENT fee rate (4%), not the PROPERTY_BOOKING rate,
    # must have been applied — proves the fee-category bug fix works.
    assert escrow.platform_fee_xaf == Decimal("600.00")  # 4% of 15,000


@pytest.mark.django_db
def test_taskln_trust_flag_defaults_to_not_trusting():
    """The OPEN configuration question — must default to the SAFER
    option (always re-verify) until the founder explicitly flips it."""
    worker = TasklnWorkerRecord.objects.create(
        taskln_worker_id="taskln-001", display_name="Jean Plumber",
        taskln_verification_status="VERIFIED",
    )
    assert is_pre_verified_via_taskln("taskln-001") is False  # default: don't trust yet

    settings_row = TasklnIntegrationSettings.current()
    settings_row.trust_taskln_verification = True
    settings_row.save()

    assert is_pre_verified_via_taskln("taskln-001") is True  # now trusts, because the flag was explicitly flipped


@pytest.mark.django_db
def test_taskln_lookup_returns_none_for_unknown_worker():
    assert lookup_taskln_worker("nonexistent-worker-id") is None
