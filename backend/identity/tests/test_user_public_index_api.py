import pytest
from rest_framework.test import APIClient
from identity.models import User, LandlordProfile
from hotels.models import Hotel, RoomType
from student_hostels.models import StudentHostel, OwnerProfile, OwnerType, HostelUnit, HostelUnitType
from property.models import Listing, ListingType, ListingStatus, House, HouseStyle
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter


@pytest.fixture
def test_quarter(db):
    country, _ = Country.objects.get_or_create(iso_code="CMR", defaults={"name": "Cameroon"})
    region, _ = Region.objects.get_or_create(country=country, name="Littoral")
    division, _ = Division.objects.get_or_create(region=region, name="Wouri")
    subdiv, _ = Subdivision.objects.get_or_create(division=division, name="Douala 1")
    district, _ = VillageOrDistrict.objects.get_or_create(subdivision=subdiv, name="District 1")
    quarter, _ = Quarter.objects.get_or_create(village_or_district=district, name="Akwa")
    return quarter


@pytest.mark.django_db
def test_user_public_index_api_returns_404_for_nonexistent_user():
    client = APIClient()
    response = client.get("/api/users/00000000-0000-0000-0000-000000000000/index/")
    assert response.status_code == 404


@pytest.mark.django_db
def test_user_public_index_api_with_hotels_and_hostels_and_apartments(test_quarter):
    client = APIClient()
    owner = User.objects.create_user(
        username="owner_user",
        phone="+237699999991",
        password="TestPassword123!",
        first_name="Jean",
        last_name="Paul",
    )
    LandlordProfile.objects.create(user=owner)

    # 1. Create a hotel owned by this user
    hotel = Hotel.objects.create(
        owner=owner,
        quarter=test_quarter,
        type="HOTEL",
        star_rating=4,
        verified=True,
    )
    RoomType.objects.create(hotel=hotel, category="DELUXE", base_rate_xaf=35000, capacity=2)

    # 2. Create a student hostel owned by this user
    owner_profile = OwnerProfile.objects.create(account_user=owner, owner_type=OwnerType.LANDLORD)
    hostel = StudentHostel.objects.create(
        owner=owner,
        owner_profile=owner_profile,
        quarter=test_quarter,
        type="STUDENT_HOSTEL",
        property_type="BLOCK",
    )
    HostelUnit.objects.create(building=hostel.building_ptr, room_code="H-101", unit_type=HostelUnitType.SELF_CONTAIN)

    # 3. Create an apartment house listing
    house_asset = House.objects.create(
        owner=owner,
        quarter=test_quarter,
        type="HOUSE",
        house_style=HouseStyle.APARTMENT,
        bedrooms=2,
        bathrooms=1,
    )
    Listing.objects.create(
        property_asset=house_asset,
        listed_by=owner,
        listing_type=ListingType.RENT,
        price_xaf=120000,
        status=ListingStatus.PUBLISHED,
    )

    # Fetch public index
    response = client.get(f"/api/users/{owner.id}/index/")
    assert response.status_code == 200
    data = response.data

    assert data["user_id"] == str(owner.id)
    assert data["full_name"] == "Jean Paul"
    assert "hotel_owner" in data["roles"]
    assert "hostel_owner" in data["roles"]
    assert "landlord" in data["roles"]

    # Check hotels
    assert len(data["hotels"]) == 1
    assert data["hotels"][0]["id"] == str(hotel.id)
    assert data["hotels"][0]["star_rating"] == 4
    assert data["hotels"][0]["cheapest_rate_xaf"] == 35000.0

    # Check hostels
    assert len(data["hostels"]) == 1
    assert data["hostels"][0]["id"] == str(hostel.id)
    assert data["hostels"][0]["total_units"] == 1

    # Check listings & stats
    assert len(data["listings"]) == 1
    assert data["listings"][0]["property_type"] == "HOUSE"
    assert data["listings"][0]["house_style"] == "APARTMENT"
    assert data["stats"]["hotels_count"] == 1
    assert data["stats"]["hostels_count"] == 1
    assert data["stats"]["apartments_count"] == 1


@pytest.mark.django_db
def test_user_public_index_api_with_technician_and_driver(test_quarter):
    from identity.models import TechnicianProfile
    from marketplace.models import DriverProfile, Vehicle, RideBooking, RideStatus
    from services.models import ServiceRequest, ServiceRequestStatus

    client = APIClient()
    tech_user = User.objects.create_user(
        username="pro_technician",
        phone="+237699999992",
        password="TestPassword123!",
        first_name="Marc",
        last_name="Kamga",
    )
    TechnicianProfile.objects.create(
        user=tech_user,
        specialties=["PLUMBING", "ELECTRICAL"],
        coverage_quarter=test_quarter,
        is_verified=True,
    )
    # Complete 1 service job
    ServiceRequest.objects.create(
        requester=tech_user,
        technician=tech_user,
        category="PLUMBING",
        status=ServiceRequestStatus.COMPLETED,
    )

    driver_profile = DriverProfile.objects.create(
        user=tech_user,
        license_number="DL-YAO-2026",
        is_verified=True,
    )
    Vehicle.objects.create(
        driver=driver_profile,
        vehicle_category="STANDARD",
        make="Toyota",
        model="Corolla",
        plate_number="LT-102-AB",
    )
    # Complete 1 ride
    RideBooking.objects.create(
        rider=tech_user,
        driver=tech_user,
        pickup_description="Akwa",
        dropoff_description="Bonanjo",
        pickup_latitude=4.05,
        pickup_longitude=9.70,
        dropoff_latitude=4.02,
        dropoff_longitude=9.69,
        fare_estimate_xaf=2500,
        status=RideStatus.COMPLETED,
    )

    res = client.get(f"/api/users/{tech_user.id}/index/")
    assert res.status_code == 200
    data = res.data

    assert "technician" in data["roles"]
    assert "driver" in data["roles"]
    assert data["technician"]["is_verified"] is True
    assert "PLUMBING" in data["technician"]["specialties"]
    assert data["technician"]["completed_jobs"] == 1
    assert data["technician"]["coverage_quarter_name"] == "Akwa"

    assert data["driver"]["is_verified"] is True
    assert data["driver"]["license_number"] == "DL-YAO-2026"
    assert data["driver"]["completed_rides"] == 1
    assert len(data["driver"]["vehicles"]) == 1
    assert data["driver"]["vehicles"][0]["plate_number"] == "LT-102-AB"

