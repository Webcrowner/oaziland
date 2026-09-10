"""
Tests for the real Marketplace API — closing a genuine gap: four
listing categories (warehouses, stores, businesses, cars) and a full
ride-hailing lifecycle had real, working service functions and
models, but nothing ever exposed any of it over HTTP.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from marketplace.models import WarehouseListing, CarListing, RideStatus
from student_hostels.models import OwnerProfile


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


# ---------------------------------------------------------------------
# Listings — one representative category (Warehouse) fully covered,
# plus Car to prove the composed VehicleSpec write path works too.
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_creating_a_warehouse_listing_auto_provisions_a_real_owner_profile(quarter):
    """A real gap this closes: every marketplace listing requires an
    OwnerProfile, but nothing ever created one automatically for a
    first-time lister — verified directly that one now really exists."""
    user = User.objects.create(username="mp_warehouse_user", phone="+237699777701")
    assert OwnerProfile.objects.filter(account_user=user).exists() is False
    client = _auth_client(user)

    response = client.post("/api/warehouses/", {
        "title": "Large warehouse near the port", "price_basis": "RENT_MONTHLY", "price_xaf": "500000",
        "quarter": str(quarter.id), "size_sqm": "800",
    })

    assert response.status_code == 201
    assert OwnerProfile.objects.filter(account_user=user).exists() is True
    assert response.data["lister_role"] == "OWNER"


@pytest.mark.django_db
def test_warehouse_listings_are_publicly_browsable(quarter):
    user = User.objects.create(username="mp_warehouse_browse_user", phone="+237699777702")
    _auth_client(user).post("/api/warehouses/", {
        "title": "A public warehouse", "price_basis": "RENT_MONTHLY", "price_xaf": "300000",
        "quarter": str(quarter.id), "size_sqm": "500",
    })

    response = APIClient().get("/api/warehouses/")

    assert response.status_code == 200
    assert response.data["count"] == 1


@pytest.mark.django_db
def test_warehouse_search_filters_by_real_price_range(quarter):
    user = User.objects.create(username="mp_warehouse_filter_user", phone="+237699777703")
    client = _auth_client(user)
    client.post("/api/warehouses/", {"title": "Cheap", "price_basis": "RENT_MONTHLY", "price_xaf": "100000", "quarter": str(quarter.id), "size_sqm": "200"})
    client.post("/api/warehouses/", {"title": "Expensive", "price_basis": "RENT_MONTHLY", "price_xaf": "900000", "quarter": str(quarter.id), "size_sqm": "900"})

    response = APIClient().get("/api/warehouses/?max_price=200000")

    assert response.data["count"] == 1
    assert response.data["results"][0]["title"] == "Cheap"


@pytest.mark.django_db
def test_creating_a_car_listing_with_real_vehicle_spec(quarter):
    user = User.objects.create(username="mp_car_user", phone="+237699777704")
    client = _auth_client(user)

    response = client.post("/api/cars/", {
        "title": "2018 Toyota Corolla", "price_basis": "SALE", "price_xaf": "6000000", "quarter": str(quarter.id),
        "vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2018, "mileage_km": 45000},
    }, format="json")

    assert response.status_code == 201
    car = CarListing.objects.get(id=response.data["id"])
    assert car.vehicle_spec.make == "Toyota"


@pytest.mark.django_db
def test_creating_a_listing_requires_authentication(quarter):
    response = APIClient().post("/api/warehouses/", {"title": "Test", "price_basis": "RENT_MONTHLY", "price_xaf": "100000", "quarter": str(quarter.id), "size_sqm": "100"})
    assert response.status_code == 401


# ---------------------------------------------------------------------
# Ride-hailing — the full real lifecycle, settling through the real
# payment gateway exactly like every other transaction.
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_requesting_a_ride_computes_a_real_fare_server_side():
    """A real gap this closes: the client could otherwise just claim
    any fare — estimate_ride_fare()'s real formula is applied
    server-side from distance, never trusted from the request body."""
    rider = User.objects.create(username="mp_ride_rider", phone="+237699777705")
    client = _auth_client(rider)

    response = client.post("/api/rides/", {
        "pickup_description": "Bastos Roundabout", "dropoff_description": "Yaoundé Airport", "distance_km": "12.5",
    })

    assert response.status_code == 201
    # 500 base + 12.5 * 150 = 2375
    assert Decimal(response.data["fare_estimate_xaf"]) == Decimal("2375.00")
    assert response.data["status"] == "REQUESTED"


@pytest.mark.django_db
def test_the_full_real_ride_lifecycle_settles_through_the_real_payment_gateway():
    from monetization.models import PlatformFeePolicy, TransactionCategory
    from identity.models import AdminProfile
    PlatformFeePolicy.objects.get_or_create(category=TransactionCategory.RIDE_FARE, defaults={"fee_percent": Decimal("10.0")})

    rider = User.objects.create(username="mp_ride_full_rider", phone="+237699777706")
    driver = User.objects.create(username="mp_ride_full_driver", phone="+237699777707")
    admin_user = User.objects.create(username="mp_ride_full_admin", phone="+237699777708")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    rider_client = _auth_client(rider)
    driver_client = _auth_client(driver)
    admin_client = _auth_client(admin_user)

    # A real driver must register, be admin-verified, and register a
    # real vehicle before they can accept anything — exercised through
    # the actual API, not the service layer directly.
    driver_profile_response = driver_client.post("/api/my-driver-profile/", {"license_number": "CM-DL-90002"})
    assert driver_profile_response.status_code == 201
    verify_response = admin_client.post(f"/api/admin/drivers/{driver_profile_response.data['id']}/verify/")
    assert verify_response.status_code == 200
    vehicle_response = driver_client.post("/api/my-vehicles/", {"vehicle_category": "STANDARD", "make": "Toyota", "model": "Corolla", "plate_number": "LT-002-CD"})
    assert vehicle_response.status_code == 201

    create_response = rider_client.post("/api/rides/", {"pickup_description": "A", "dropoff_description": "B", "distance_km": "5"})
    ride_id = create_response.data["id"]

    accept_response = driver_client.post(f"/api/rides/{ride_id}/accept/", {"vehicle_id": vehicle_response.data["id"]})
    assert accept_response.status_code == 200
    assert accept_response.data["status"] == "ACCEPTED"

    start_response = driver_client.post(f"/api/rides/{ride_id}/start/")
    assert start_response.status_code == 200
    assert start_response.data["status"] == "IN_PROGRESS"

    complete_response = rider_client.post(f"/api/rides/{ride_id}/complete/", {"phone_number": rider.phone})
    assert complete_response.status_code == 200
    assert complete_response.data["status"] == "COMPLETED"


@pytest.mark.django_db
def test_only_the_rides_own_driver_can_start_it():
    from identity.models import AdminProfile
    rider = User.objects.create(username="mp_ride_perm_rider", phone="+237699777708")
    driver = User.objects.create(username="mp_ride_perm_driver", phone="+237699777709")
    stranger = User.objects.create(username="mp_ride_perm_stranger", phone="+237699777710")
    admin_user = User.objects.create(username="mp_ride_perm_admin", phone="+237699777718")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    driver_client = _auth_client(driver)
    profile_response = driver_client.post("/api/my-driver-profile/", {"license_number": "CM-DL-22222"})
    _auth_client(admin_user).post(f"/api/admin/drivers/{profile_response.data['id']}/verify/")
    vehicle_response = driver_client.post("/api/my-vehicles/", {"vehicle_category": "STANDARD", "make": "Nissan", "model": "Almera", "plate_number": "LT-008-OP"})

    create_response = _auth_client(rider).post("/api/rides/", {"pickup_description": "A", "dropoff_description": "B", "distance_km": "5"})
    ride_id = create_response.data["id"]
    accept_response = driver_client.post(f"/api/rides/{ride_id}/accept/", {"vehicle_id": vehicle_response.data["id"]})
    assert accept_response.status_code == 200

    response = _auth_client(stranger).post(f"/api/rides/{ride_id}/start/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_cannot_accept_a_ride_thats_already_accepted():
    from identity.models import AdminProfile
    rider = User.objects.create(username="mp_ride_double_rider", phone="+237699777711")
    driver_a = User.objects.create(username="mp_ride_double_driver_a", phone="+237699777712")
    driver_b = User.objects.create(username="mp_ride_double_driver_b", phone="+237699777713")
    admin_user = User.objects.create(username="mp_ride_double_admin", phone="+237699777717")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    driver_a_client = _auth_client(driver_a)
    profile_response = driver_a_client.post("/api/my-driver-profile/", {"license_number": "CM-DL-22221"})
    _auth_client(admin_user).post(f"/api/admin/drivers/{profile_response.data['id']}/verify/")
    vehicle_response = driver_a_client.post("/api/my-vehicles/", {"vehicle_category": "STANDARD", "make": "Honda", "model": "Civic", "plate_number": "LT-007-MN"})

    create_response = _auth_client(rider).post("/api/rides/", {"pickup_description": "A", "dropoff_description": "B", "distance_km": "5"})
    ride_id = create_response.data["id"]
    first_accept = driver_a_client.post(f"/api/rides/{ride_id}/accept/", {"vehicle_id": vehicle_response.data["id"]})
    assert first_accept.status_code == 200

    second_accept = _auth_client(driver_b).post(f"/api/rides/{ride_id}/accept/")

    assert second_accept.status_code == 400


@pytest.mark.django_db
def test_only_the_rider_can_complete_and_pay_for_their_own_ride():
    from identity.models import AdminProfile
    rider = User.objects.create(username="mp_ride_pay_rider", phone="+237699777714")
    driver = User.objects.create(username="mp_ride_pay_driver", phone="+237699777715")
    stranger = User.objects.create(username="mp_ride_pay_stranger", phone="+237699777716")
    admin_user = User.objects.create(username="mp_ride_pay_admin", phone="+237699777719")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    driver_client = _auth_client(driver)
    profile_response = driver_client.post("/api/my-driver-profile/", {"license_number": "CM-DL-22223"})
    _auth_client(admin_user).post(f"/api/admin/drivers/{profile_response.data['id']}/verify/")
    vehicle_response = driver_client.post("/api/my-vehicles/", {"vehicle_category": "STANDARD", "make": "Hyundai", "model": "Accent", "plate_number": "LT-009-QR"})

    create_response = _auth_client(rider).post("/api/rides/", {"pickup_description": "A", "dropoff_description": "B", "distance_km": "5"})
    ride_id = create_response.data["id"]
    assert driver_client.post(f"/api/rides/{ride_id}/accept/", {"vehicle_id": vehicle_response.data["id"]}).status_code == 200
    assert driver_client.post(f"/api/rides/{ride_id}/start/").status_code == 200

    response = _auth_client(stranger).post(f"/api/rides/{ride_id}/complete/", {"phone_number": stranger.phone})

    assert response.status_code == 403


# ---------------------------------------------------------------------
# ListingCondition — a real gap this closes: attach_condition() and
# get_conditions_for() were fully built (structured conditions +
# free-text clause, generic to ANY listing type) but had zero API
# exposure at all.
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_attaching_a_real_condition_to_a_property_listing(quarter):
    from property.models import House, Listing, ListingType, ListingStatus
    landlord = User.objects.create(username="mp_cond_landlord", phone="+237699999901")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    client = _auth_client(landlord)

    response = client.post("/api/listing-conditions/", {
        "target_content_type": "property.Listing", "target_id": str(listing.id),
        "structured_conditions": {"min_lease_months": 12, "deposit_required": True, "pet_policy": "NO_PETS"},
        "free_text_clause": "No loud music after 9pm.",
    }, format="json")

    assert response.status_code == 201
    assert response.data["structured_conditions"]["min_lease_months"] == 12


@pytest.mark.django_db
def test_conditions_are_publicly_viewable(quarter):
    from property.models import House, Listing, ListingType, ListingStatus
    landlord = User.objects.create(username="mp_cond_view_landlord", phone="+237699999902")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    _auth_client(landlord).post("/api/listing-conditions/", {
        "target_content_type": "property.Listing", "target_id": str(listing.id), "structured_conditions": {"no_subletting": True},
    }, format="json")

    response = APIClient().get(f"/api/listing-conditions/?target_content_type=property.Listing&target_id={listing.id}")

    assert response.status_code == 200
    assert len(response.data) == 1


@pytest.mark.django_db
def test_only_the_listings_own_lister_can_attach_a_condition(quarter):
    from property.models import House, Listing, ListingType, ListingStatus
    landlord = User.objects.create(username="mp_cond_owner_landlord", phone="+237699999903")
    stranger = User.objects.create(username="mp_cond_stranger", phone="+237699999904")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))

    response = _auth_client(stranger).post("/api/listing-conditions/", {
        "target_content_type": "property.Listing", "target_id": str(listing.id), "structured_conditions": {},
    }, format="json")

    assert response.status_code == 403


@pytest.mark.django_db
def test_attaching_a_condition_to_a_marketplace_listing_too(quarter):
    """Proves the same generic endpoint genuinely works for a
    marketplace listing, not just property.Listing — the whole point
    of the model's own generic (content_type, id) design."""
    user = User.objects.create(username="mp_cond_car_user", phone="+237699999905")
    car_response = _auth_client(user).post("/api/cars/", {
        "title": "Test Car", "price_basis": "SALE", "price_xaf": "3000000", "quarter": str(quarter.id),
        "vehicle_spec": {"make": "Honda", "model": "Civic", "year": 2015},
    }, format="json")
    car_id = car_response.data["id"]

    response = _auth_client(user).post("/api/listing-conditions/", {
        "target_content_type": "marketplace.CarListing", "target_id": car_id,
        "structured_conditions": {"mileage_cap_km": 200000}, "free_text_clause": "As-is, no warranty.",
    }, format="json")

    assert response.status_code == 201


@pytest.mark.django_db
def test_attaching_a_condition_to_a_nonexistent_listing_returns_404():
    user = User.objects.create(username="mp_cond_404_user", phone="+237699999906")
    response = _auth_client(user).post("/api/listing-conditions/", {
        "target_content_type": "property.Listing", "target_id": "11111111-1111-1111-1111-111111111111", "structured_conditions": {},
    }, format="json")
    assert response.status_code == 404


@pytest.mark.django_db
def test_attaching_a_condition_requires_authentication():
    response = APIClient().post("/api/listing-conditions/", {
        "target_content_type": "property.Listing", "target_id": "11111111-1111-1111-1111-111111111111", "structured_conditions": {},
    }, format="json")
    assert response.status_code == 401


# ---------------------------------------------------------------------
# Marketplace media — a real gap this closes: MarketplaceMedia and the
# read-side `media` field already existed on every category
# serializer, but nothing ever let a lister actually attach a photo.
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_adding_real_media_to_a_warehouse_listing(quarter):
    user = User.objects.create(username="mp_media_user", phone="+237699888801")
    client = _auth_client(user)
    create_response = client.post("/api/warehouses/", {
        "title": "Media Test Warehouse", "price_basis": "RENT_MONTHLY", "price_xaf": "300000", "quarter": str(quarter.id), "size_sqm": "400",
    })
    listing_id = create_response.data["id"]

    response = client.post(f"/api/warehouses/{listing_id}/add-media/", {"url": "https://example.com/warehouse1.jpg", "media_type": "PHOTO"})

    assert response.status_code == 201
    detail = client.get(f"/api/warehouses/{listing_id}/")
    assert len(detail.data["media"]) == 1


@pytest.mark.django_db
def test_only_the_listings_own_lister_can_add_media(quarter):
    user = User.objects.create(username="mp_media_owner", phone="+237699888802")
    stranger = User.objects.create(username="mp_media_stranger", phone="+237699888803")
    create_response = _auth_client(user).post("/api/warehouses/", {
        "title": "Media Perm Warehouse", "price_basis": "RENT_MONTHLY", "price_xaf": "300000", "quarter": str(quarter.id), "size_sqm": "400",
    })
    listing_id = create_response.data["id"]

    response = _auth_client(stranger).post(f"/api/warehouses/{listing_id}/add-media/", {"url": "https://example.com/hijack.jpg"})

    assert response.status_code == 403


@pytest.mark.django_db
def test_removing_media_from_a_listing(quarter):
    user = User.objects.create(username="mp_media_remove_user", phone="+237699888804")
    client = _auth_client(user)
    create_response = client.post("/api/warehouses/", {
        "title": "Media Remove Warehouse", "price_basis": "RENT_MONTHLY", "price_xaf": "300000", "quarter": str(quarter.id), "size_sqm": "400",
    })
    listing_id = create_response.data["id"]
    add_response = client.post(f"/api/warehouses/{listing_id}/add-media/", {"url": "https://example.com/w1.jpg"})
    media_id = add_response.data["id"]

    remove_response = client.post(f"/api/warehouses/{listing_id}/remove-media/", {"media_id": media_id})

    assert remove_response.status_code == 204


# ---------------------------------------------------------------------
# Real driver/vehicle registration, luggage, ride categories, and
# cargo/building-materials transport — the real gap this closes: any
# signed-in user could previously accept a ride with zero
# registration, no vehicle, and every ride used one single fare
# formula regardless of what was actually needed.
# ---------------------------------------------------------------------
@pytest.mark.django_db
def test_registering_as_a_driver_starts_unverified():
    user = User.objects.create(username="driver_reg_user", phone="+237699888801")
    response = _auth_client(user).post("/api/my-driver-profile/", {"license_number": "CM-DL-11111"})
    assert response.status_code == 201
    assert response.data["is_verified"] is False


@pytest.mark.django_db
def test_an_unverified_driver_cannot_accept_a_ride():
    rider = User.objects.create(username="ride_gate_rider", phone="+237699888802")
    driver = User.objects.create(username="ride_gate_driver", phone="+237699888803")
    driver_client = _auth_client(driver)
    driver_client.post("/api/my-driver-profile/", {"license_number": "CM-DL-11112"})
    vehicle_response = driver_client.post("/api/my-vehicles/", {"vehicle_category": "STANDARD", "make": "Kia", "model": "Rio", "plate_number": "LT-003-EF"})

    create_response = _auth_client(rider).post("/api/rides/", {"pickup_description": "A", "dropoff_description": "B", "distance_km": "5"})
    ride_id = create_response.data["id"]

    response = driver_client.post(f"/api/rides/{ride_id}/accept/", {"vehicle_id": vehicle_response.data["id"]})
    assert response.status_code == 403


@pytest.mark.django_db
def test_a_non_registered_user_cannot_accept_a_ride_at_all():
    rider = User.objects.create(username="ride_noreg_rider", phone="+237699888804")
    stranger = User.objects.create(username="ride_noreg_stranger", phone="+237699888805")
    create_response = _auth_client(rider).post("/api/rides/", {"pickup_description": "A", "dropoff_description": "B", "distance_km": "5"})
    ride_id = create_response.data["id"]

    response = _auth_client(stranger).post(f"/api/rides/{ride_id}/accept/", {"vehicle_id": "1"})
    assert response.status_code == 403


@pytest.mark.django_db
def test_a_moto_only_vehicle_cannot_accept_a_ride_requesting_a_standard_car():
    from identity.models import AdminProfile
    rider = User.objects.create(username="ride_mismatch_rider", phone="+237699888806")
    driver = User.objects.create(username="ride_mismatch_driver", phone="+237699888807")
    admin_user = User.objects.create(username="ride_mismatch_admin", phone="+237699888808")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    driver_client = _auth_client(driver)
    profile_response = driver_client.post("/api/my-driver-profile/", {"license_number": "CM-DL-11113"})
    _auth_client(admin_user).post(f"/api/admin/drivers/{profile_response.data['id']}/verify/")
    vehicle_response = driver_client.post("/api/my-vehicles/", {"vehicle_category": "MOTO", "make": "Bajaj", "model": "Boxer", "plate_number": "LT-004-GH"})

    create_response = _auth_client(rider).post("/api/rides/", {"pickup_description": "A", "dropoff_description": "B", "distance_km": "5", "ride_category": "STANDARD"})
    ride_id = create_response.data["id"]

    response = driver_client.post(f"/api/rides/{ride_id}/accept/", {"vehicle_id": vehicle_response.data["id"]})
    assert response.status_code == 403


@pytest.mark.django_db
def test_a_cargo_ride_requires_a_van_or_truck_not_a_car():
    from identity.models import AdminProfile
    rider = User.objects.create(username="ride_cargo_rider", phone="+237699888809")
    driver = User.objects.create(username="ride_cargo_driver", phone="+237699888810")
    admin_user = User.objects.create(username="ride_cargo_admin", phone="+237699888811")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    driver_client = _auth_client(driver)
    profile_response = driver_client.post("/api/my-driver-profile/", {"license_number": "CM-DL-11114"})
    _auth_client(admin_user).post(f"/api/admin/drivers/{profile_response.data['id']}/verify/")
    car_response = driver_client.post("/api/my-vehicles/", {"vehicle_category": "STANDARD", "make": "Toyota", "model": "Camry", "plate_number": "LT-005-IJ"})
    van_response = driver_client.post("/api/my-vehicles/", {"vehicle_category": "VAN", "make": "Toyota", "model": "Hiace", "plate_number": "LT-006-KL"})

    create_response = _auth_client(rider).post("/api/rides/", {
        "pickup_description": "Property A", "dropoff_description": "Property B", "distance_km": "8",
        "transport_type": "CARGO", "cargo_description": "20 bags of cement and roofing sheets",
    })
    ride_id = create_response.data["id"]

    car_attempt = driver_client.post(f"/api/rides/{ride_id}/accept/", {"vehicle_id": car_response.data["id"]})
    assert car_attempt.status_code == 403

    van_attempt = driver_client.post(f"/api/rides/{ride_id}/accept/", {"vehicle_id": van_response.data["id"]})
    assert van_attempt.status_code == 200


@pytest.mark.django_db
def test_a_cargo_ride_without_a_description_is_rejected():
    rider = User.objects.create(username="ride_cargo_nodesc_rider", phone="+237699888812")
    response = _auth_client(rider).post("/api/rides/", {
        "pickup_description": "A", "dropoff_description": "B", "distance_km": "5", "transport_type": "CARGO",
    })
    assert response.status_code == 400


@pytest.mark.django_db
def test_luggage_and_ride_category_are_real_and_reflected_on_the_ride():
    rider = User.objects.create(username="ride_luggage_rider", phone="+237699888813")
    response = _auth_client(rider).post("/api/rides/", {
        "pickup_description": "Airport", "dropoff_description": "Hotel", "distance_km": "12",
        "ride_category": "COMFORT", "has_luggage": True,
    })
    assert response.status_code == 201
    assert response.data["ride_category"] == "COMFORT"
    assert response.data["has_luggage"] is True


@pytest.mark.django_db
def test_moto_and_comfort_fares_are_genuinely_different_not_one_formula_for_everyone():
    rider = User.objects.create(username="ride_fare_rider", phone="+237699888814")
    moto_response = _auth_client(rider).post("/api/rides/", {"pickup_description": "A", "dropoff_description": "B", "distance_km": "10", "ride_category": "MOTO"})
    comfort_response = _auth_client(rider).post("/api/rides/", {"pickup_description": "A", "dropoff_description": "B", "distance_km": "10", "ride_category": "COMFORT"})

    assert Decimal(moto_response.data["fare_estimate_xaf"]) < Decimal(comfort_response.data["fare_estimate_xaf"])


@pytest.mark.django_db
def test_an_admin_sees_and_can_verify_a_pending_driver():
    from identity.models import AdminProfile
    driver = User.objects.create(username="ride_admin_verify_driver", phone="+237699888815")
    admin_user = User.objects.create(username="ride_admin_verify_admin", phone="+237699888816")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    driver_client = _auth_client(driver)
    profile_response = driver_client.post("/api/my-driver-profile/", {"license_number": "CM-DL-11115"})

    admin_client = _auth_client(admin_user)
    pending_view = admin_client.get("/api/admin/drivers/")
    assert pending_view.data["count"] == 1

    verify_response = admin_client.post(f"/api/admin/drivers/{profile_response.data['id']}/verify/")
    assert verify_response.status_code == 200
    assert verify_response.data["is_verified"] is True
