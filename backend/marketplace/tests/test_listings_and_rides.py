"""
Tests proving the marketplace module's acceptance criteria: a warehouse
listing with a custom condition correctly surfaced by size/price filters,
and a full ride booking settled through the same escrow system as every
other transaction.
"""
import pytest
from decimal import Decimal

from identity.models import User, AgencyProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from student_hostels.models import OwnerProfile, OwnerType
from marketplace.models import WarehouseListing, CarListing, VehicleSpec, ListerRole, PriceBasis, RideStatus
from marketplace.services import (
    attach_condition, get_conditions_for, search_marketplace_listings,
    estimate_ride_fare, request_ride, accept_ride, start_ride, complete_ride_with_payment,
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
    region = Region.objects.create(country=country, name="Littoral")
    division = Division.objects.create(region=region, name="Wouri")
    subdivision = Subdivision.objects.create(division=division, name="Douala III")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bonaberi District")
    return Quarter.objects.create(village_or_district=village, name="Bonaberi")


@pytest.mark.django_db
def test_warehouse_listing_with_condition_surfaced_by_filters(quarter):
    """The module's first literal acceptance criteria: an Agency-created
    warehouse listing with a custom condition, correctly filtered by
    size and price."""
    landlord_user = User.objects.create(username="warehouse_owner", phone="+237699600001")
    owner = OwnerProfile.objects.create(account_user=landlord_user, owner_type=OwnerType.LANDLORD)

    agency_user = User.objects.create(username="warehouse_agency", phone="+237699600002")
    AgencyProfile.objects.create(user=agency_user, registration_number="RC-WH-001", agency_commission_percent=Decimal("15"))

    matching_warehouse = WarehouseListing.objects.create(
        owner=owner, lister_user=agency_user, lister_role=ListerRole.AGENCY,
        title="Large Bonaberi Warehouse", price_basis=PriceBasis.RENT_ANNUAL,
        price_xaf=Decimal("5000000"), quarter=quarter, size_sqm=Decimal("800"),
    )
    attach_condition(
        listing=matching_warehouse, created_by=agency_user,
        structured_conditions={"min_lease_months": 12, "deposit_required": True},
        free_text_clause="Tenant responsible for warehouse insurance.",
    )

    too_small_warehouse = WarehouseListing.objects.create(
        owner=owner, lister_user=agency_user, lister_role=ListerRole.AGENCY,
        title="Small Storage Unit", price_basis=PriceBasis.RENT_MONTHLY,
        price_xaf=Decimal("150000"), quarter=quarter, size_sqm=Decimal("50"),
    )

    results = search_marketplace_listings(
        listing_class=WarehouseListing,
        filters={"min_size_sqm": 500, "min_price": 1000000, "quarter_id": str(quarter.id)},
    )
    result_ids = [r.id for r in results]

    assert matching_warehouse.id in result_ids
    assert too_small_warehouse.id not in result_ids

    conditions = get_conditions_for(matching_warehouse)
    assert conditions.count() == 1
    assert conditions.first().structured_conditions["min_lease_months"] == 12


@pytest.mark.django_db
def test_condition_based_filtering(quarter):
    landlord_user = User.objects.create(username="condition_owner", phone="+237699600003")
    owner = OwnerProfile.objects.create(account_user=landlord_user, owner_type=OwnerType.LANDLORD)

    long_lease_only = WarehouseListing.objects.create(
        owner=owner, lister_user=landlord_user, lister_role=ListerRole.OWNER,
        title="Long Lease Only Warehouse", price_basis=PriceBasis.RENT_ANNUAL,
        price_xaf=Decimal("2000000"), quarter=quarter, size_sqm=Decimal("600"),
    )
    attach_condition(listing=long_lease_only, created_by=landlord_user, structured_conditions={"min_lease_months": 24})

    flexible_lease = WarehouseListing.objects.create(
        owner=owner, lister_user=landlord_user, lister_role=ListerRole.OWNER,
        title="Flexible Lease Warehouse", price_basis=PriceBasis.RENT_MONTHLY,
        price_xaf=Decimal("180000"), quarter=quarter, size_sqm=Decimal("600"),
    )
    attach_condition(listing=flexible_lease, created_by=landlord_user, structured_conditions={"min_lease_months": 1})

    results = search_marketplace_listings(
        listing_class=WarehouseListing, filters={"required_conditions": {"min_lease_months": 1}},
    )
    result_ids = [r.id for r in results]
    assert flexible_lease.id in result_ids
    assert long_lease_only.id not in result_ids


@pytest.mark.django_db
def test_car_listing_with_vehicle_spec(quarter):
    seller_user = User.objects.create(username="car_seller", phone="+237699600004")
    owner = OwnerProfile.objects.create(account_user=seller_user, owner_type=OwnerType.LANDLORD)

    car = CarListing.objects.create(
        owner=owner, lister_user=seller_user, lister_role=ListerRole.OWNER,
        title="2019 Toyota Corolla", price_basis=PriceBasis.SALE,
        price_xaf=Decimal("8500000"), quarter=quarter,
    )
    VehicleSpec.objects.create(car_listing=car, make="Toyota", model="Corolla", year=2019, mileage_km=45000, engine_size_cc=1800)

    assert car.vehicle_spec.make == "Toyota"
    assert car.vehicle_spec.year == 2019


@pytest.mark.django_db
def test_full_ride_booking_settles_through_shared_escrow():
    """The module's other literal acceptance criteria: a ride, paid
    through the exact same escrow system as everything else."""
    from marketplace.services import register_as_driver, register_vehicle

    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.RIDE_FARE, defaults={"fee_percent": Decimal("10.0")})
    rider = User.objects.create(username="ride_rider", phone="+237699600005")
    driver = User.objects.create(username="ride_driver", phone="+237699600006")
    driver_profile = register_as_driver(user=driver, license_number="CM-DL-90001")
    driver_profile.is_verified = True
    driver_profile.save(update_fields=["is_verified"])
    vehicle = register_vehicle(driver_profile=driver_profile, vehicle_category="STANDARD", make="Toyota", model="Corolla", plate_number="LT-001-AB")

    fare = estimate_ride_fare(distance_km=Decimal("10"))
    assert fare == Decimal("500") + (Decimal("10") * Decimal("150"))  # 2000 XAF

    ride = request_ride(
        rider=rider, pickup_description="Akwa, Douala", dropoff_description="Bonaberi, Douala",
        fare_estimate_xaf=fare,
    )
    assert ride.status == RideStatus.REQUESTED

    accept_ride(ride=ride, driver=driver, vehicle=vehicle)
    ride.refresh_from_db()
    assert ride.status == RideStatus.ACCEPTED
    assert ride.driver == driver

    start_ride(ride)
    ride.refresh_from_db()
    assert ride.status == RideStatus.IN_PROGRESS

    lock = FakeLock()
    gateway = SandboxGateway()
    booking, escrow = complete_ride_with_payment(
        ride=ride, lock_client=lock, payment_gateway=gateway, phone_number="+237670000333",
    )

    ride.refresh_from_db()
    assert ride.status == RideStatus.COMPLETED
    assert ride.booking == booking
    assert booking.booking_type == "RIDE"
    assert escrow.status == "RELEASED"  # the driver actually gets paid now, not held forever
    # 10% of 2000 XAF fare — the RIDE_FARE category rate, not a
    # different category's rate.
    assert escrow.platform_fee_xaf == Decimal("200.00")
