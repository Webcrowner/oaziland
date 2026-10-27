"""Driver location: online state, nearby open requests, and the rider following their driver."""
import pytest
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from marketplace.models import DriverProfile
from marketplace.tests.test_marketplace_api import _verify, _auth_client
from marketplace.tests.test_ride_safety import _verified_driver, _request_ride

# Bastos and Mvan are a few km apart; Douala is hundreds of km away.
BASTOS = ("3.8800000", "11.5210000")
MVAN = ("3.8200000", "11.5200000")
DOUALA = ("4.0511000", "9.7679000")


def _ride_at(rider, point, **extra):
    return _request_ride(rider, pickup_latitude=point[0], pickup_longitude=point[1], **extra)


def _go_online(client, point):
    response = client.post("/api/my-driver-profile/location/", {"latitude": point[0], "longitude": point[1], "is_online": True}, format="json")
    assert response.status_code == 200, response.data
    return response


@pytest.mark.django_db
def test_only_verified_drivers_can_share_a_location():
    user = User.objects.create(username="dt_plain", phone="+237699400001")
    response = _auth_client(user).post("/api/my-driver-profile/location/", {"is_online": True}, format="json")
    assert response.status_code == 403


@pytest.mark.django_db
def test_location_updates_are_validated_and_stored():
    driver, client, _ = _verified_driver("dt_driver1", "+237699400002")
    assert client.post("/api/my-driver-profile/location/", {"latitude": "3.88"}, format="json").status_code == 400
    assert client.post("/api/my-driver-profile/location/", {}, format="json").status_code == 400
    assert client.post("/api/my-driver-profile/location/", {"latitude": "95", "longitude": "11"}, format="json").status_code == 400
    response = _go_online(client, BASTOS)
    assert response.data["is_online"] is True
    profile = DriverProfile.objects.get(user=driver)
    assert profile.last_seen_at is not None
    client.post("/api/my-driver-profile/location/", {"is_online": False}, format="json")
    profile.refresh_from_db()
    assert profile.is_online is False and profile.last_latitude is not None


@pytest.mark.django_db
def test_open_requests_are_nearby_nearest_first_and_match_the_vehicle():
    rider = _verify(User.objects.create(username="dt_rider2", phone="+237699400003"))
    driver, client, _ = _verified_driver("dt_driver2", "+237699400004", category="STANDARD")
    near = _ride_at(rider, BASTOS)
    nearer = _ride_at(rider, ("3.8700000", "11.5210000"))
    _ride_at(rider, DOUALA)
    _ride_at(rider, BASTOS, ride_category="MOTO")
    _ride_at(rider, BASTOS, transport_type="CARGO", cargo_description="cement", ride_category="TRUCK")
    _go_online(client, ("3.8650000", "11.5210000"))

    response = client.get("/api/rides/open/")
    assert response.status_code == 200
    assert response.data["driver_located"] is True
    ids = [row["id"] for row in response.data["results"]]
    assert ids == [nearer["id"], near["id"]]
    assert response.data["results"][0]["pickup_distance_km"] is not None
    assert response.data["results"][0]["rider"] is None
    # A wider radius still excludes Douala from a Yaoundé driver.
    wide = client.get("/api/rides/open/?radius_km=50")
    assert len(wide.data["results"]) == 2


@pytest.mark.django_db
def test_without_a_recent_position_requests_are_listed_without_distance():
    rider = _verify(User.objects.create(username="dt_rider3", phone="+237699400005"))
    driver, client, _ = _verified_driver("dt_driver3", "+237699400006")
    _ride_at(rider, DOUALA)
    response = client.get("/api/rides/open/")
    assert response.data["driver_located"] is False
    assert len(response.data["results"]) == 1 and response.data["results"][0]["pickup_distance_km"] is None
    # A stale position is ignored too.
    _go_online(client, BASTOS)
    DriverProfile.objects.filter(user=driver).update(last_seen_at=timezone.now() - timedelta(hours=1))
    assert client.get("/api/rides/open/").data["driver_located"] is False


@pytest.mark.django_db
def test_non_drivers_cannot_browse_open_requests():
    user = User.objects.create(username="dt_plain2", phone="+237699400007")
    assert _auth_client(user).get("/api/rides/open/").status_code == 403


@pytest.mark.django_db
def test_rider_follows_the_driver_with_distance_and_eta():
    rider = _verify(User.objects.create(username="dt_rider4", phone="+237699400008"))
    driver, client, vehicle_id = _verified_driver("dt_driver4", "+237699400009")
    ride = _ride_at(rider, BASTOS, dropoff_latitude=MVAN[0], dropoff_longitude=MVAN[1])
    rider_client = _auth_client(rider)

    # Not shared until a driver has accepted.
    assert rider_client.get(f"/api/rides/{ride['id']}/driver-location/").status_code == 400
    assert client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id}, format="json").status_code == 200

    before = rider_client.get(f"/api/rides/{ride['id']}/driver-location/")
    assert before.status_code == 200 and before.data["located"] is False

    client.post("/api/my-driver-profile/location/", {"latitude": MVAN[0], "longitude": MVAN[1]}, format="json")
    tracking = rider_client.get(f"/api/rides/{ride['id']}/driver-location/").data
    assert tracking["located"] is True
    assert tracking["heading_to"] == "pickup"
    assert float(tracking["distance_km"]) > 5 and tracking["eta_minutes"] >= 1

    client.post(f"/api/rides/{ride['id']}/start/")
    assert rider_client.get(f"/api/rides/{ride['id']}/driver-location/").data["heading_to"] == "dropoff"


@pytest.mark.django_db
def test_only_the_rider_can_follow_the_driver():
    rider = _verify(User.objects.create(username="dt_rider5", phone="+237699400010"))
    stranger = _verify(User.objects.create(username="dt_stranger", phone="+237699400011"))
    driver, client, vehicle_id = _verified_driver("dt_driver5", "+237699400012")
    ride = _ride_at(rider, BASTOS)
    client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id}, format="json")
    assert _auth_client(stranger).get(f"/api/rides/{ride['id']}/driver-location/").status_code == 403
