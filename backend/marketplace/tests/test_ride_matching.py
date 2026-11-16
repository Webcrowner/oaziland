"""Automatic matching: requests go to the nearest suitable online driver first, one at a time."""
import pytest
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from marketplace.models import RideBooking, RideOffer, RideOfferStatus, RideStatus
from marketplace.tests.test_marketplace_api import _verify, _auth_client
from marketplace.tests.test_ride_safety import _verified_driver
from marketplace.tests.test_driver_tracking import BASTOS, DOUALA, _ride_at, _go_online

NEAR = ("3.8750000", "11.5210000")      # ~0.5 km from Bastos
FURTHER = ("3.8500000", "11.5210000")   # ~3 km from Bastos


def _offer(client):
    response = client.get("/api/rides/my-offer/")
    assert response.status_code == 200, response.data
    return response.data["offer"]


@pytest.mark.django_db
def test_the_nearest_suitable_driver_gets_the_offer_and_only_they_can_accept():
    rider = _verify(User.objects.create(username="rm_rider1", phone="+237699500001"))
    near, near_client, near_vehicle = _verified_driver("rm_near1", "+237699500002")
    far, far_client, far_vehicle = _verified_driver("rm_far1", "+237699500003")
    moto, moto_client, _ = _verified_driver("rm_moto1", "+237699500004", category="MOTO")
    away, away_client, _ = _verified_driver("rm_away1", "+237699500005")
    _go_online(near_client, NEAR)
    _go_online(far_client, FURTHER)
    _go_online(moto_client, BASTOS)        # wrong vehicle type
    _go_online(away_client, DOUALA)        # outside the radius

    ride = _ride_at(rider, BASTOS)
    assert ride["matching"] is True

    offer = _offer(near_client)
    assert offer["ride"]["id"] == ride["id"] and offer["ride"]["rider"] is None
    assert 0 < offer["seconds_left"] <= 20 and offer["ride"]["pickup_distance_km"] == "0.6"
    for other in (far_client, moto_client, away_client):
        assert _offer(other) is None
    # While it's being offered, the ride isn't on anyone's open list and nobody else can grab it.
    assert ride["id"] not in [r["id"] for r in far_client.get("/api/rides/open/").data["results"]]
    assert far_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": far_vehicle}, format="json").status_code == 403

    assert near_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": near_vehicle}, format="json").status_code == 200
    accepted = RideBooking.objects.get(pk=ride["id"])
    assert accepted.status == RideStatus.ACCEPTED and accepted.driver == near
    assert RideOffer.objects.get(ride=accepted, driver=near).status == RideOfferStatus.ACCEPTED
    assert _offer(near_client) is None


@pytest.mark.django_db
def test_a_decline_or_no_answer_moves_on_and_then_everyone_can_take_it():
    rider = _verify(User.objects.create(username="rm_rider2", phone="+237699500011"))
    near, near_client, _ = _verified_driver("rm_near2", "+237699500012")
    far, far_client, _ = _verified_driver("rm_far2", "+237699500013")
    late, late_client, late_vehicle = _verified_driver("rm_late2", "+237699500014")
    _go_online(near_client, NEAR)
    _go_online(far_client, FURTHER)
    ride = _ride_at(rider, BASTOS)

    assert near_client.post(f"/api/rides/{ride['id']}/decline/").status_code == 200
    assert near_client.post(f"/api/rides/{ride['id']}/decline/").status_code == 400
    assert _offer(far_client)["ride"]["id"] == ride["id"]

    # The second driver doesn't answer in time: on the next check-in the ride leaves them, and with
    # nobody nearby left it goes on the open list for any suitable driver.
    RideOffer.objects.filter(driver=far).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert _offer(far_client) is None
    assert RideOffer.objects.get(driver=far).status == RideOfferStatus.EXPIRED
    opened = RideBooking.objects.get(pk=ride["id"])
    assert opened.matching_ended_at is not None and opened.status == RideStatus.REQUESTED
    assert _auth_client(rider).get(f"/api/rides/{ride['id']}/").data["matching"] is False

    # A driver who was never offered it (not online at the time) can now take it from the list.
    assert ride["id"] in [r["id"] for r in late_client.get("/api/rides/open/").data["results"]]
    assert late_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": late_vehicle}, format="json").status_code == 200


@pytest.mark.django_db
def test_with_no_suitable_driver_nearby_the_request_is_listed_straight_away():
    rider = _verify(User.objects.create(username="rm_rider3", phone="+237699500021"))
    driver, client, _ = _verified_driver("rm_driver3", "+237699500022")
    nobody_online = _ride_at(rider, BASTOS)
    assert nobody_online["matching"] is False
    assert nobody_online["id"] in [r["id"] for r in client.get("/api/rides/open/").data["results"]]


@pytest.mark.django_db
def test_a_busy_driver_or_one_already_holding_an_offer_is_skipped():
    rider = _verify(User.objects.create(username="rm_rider4", phone="+237699500031"))
    near, near_client, _ = _verified_driver("rm_near4", "+237699500032")
    far, far_client, _ = _verified_driver("rm_far4", "+237699500033")
    _go_online(near_client, NEAR)
    _go_online(far_client, FURTHER)
    first = _ride_at(rider, BASTOS)
    second = _ride_at(rider, BASTOS)
    assert _offer(near_client)["ride"]["id"] == first["id"]
    assert _offer(far_client)["ride"]["id"] == second["id"]


@pytest.mark.django_db
def test_when_a_driver_pulls_out_matching_restarts_without_them():
    rider = _verify(User.objects.create(username="rm_rider5", phone="+237699500041"))
    near, near_client, near_vehicle = _verified_driver("rm_near5", "+237699500042")
    far, far_client, _ = _verified_driver("rm_far5", "+237699500043")
    _go_online(near_client, NEAR)
    _go_online(far_client, FURTHER)
    ride = _ride_at(rider, BASTOS)
    # The nearer driver gets it first and accepts, then pulls out.
    near_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": near_vehicle}, format="json")
    assert near_client.post(f"/api/rides/{ride['id']}/release/", {"reason": "VEHICLE_PROBLEM"}, format="json").status_code == 200
    assert _offer(near_client) is None
    assert _offer(far_client)["ride"]["id"] == ride["id"]


@pytest.mark.django_db
def test_cancelling_withdraws_the_offer():
    rider = _verify(User.objects.create(username="rm_rider6", phone="+237699500051"))
    near, near_client, _ = _verified_driver("rm_near6", "+237699500052")
    _go_online(near_client, NEAR)
    ride = _ride_at(rider, BASTOS)
    assert _offer(near_client) is not None
    _auth_client(rider).post(f"/api/rides/{ride['id']}/cancel/", {"reason": "CHANGED_PLANS"}, format="json")
    assert _offer(near_client) is None
    assert RideOffer.objects.get(driver=near).status == RideOfferStatus.WITHDRAWN


@pytest.mark.django_db
def test_only_verified_drivers_get_offers():
    user = User.objects.create(username="rm_plain", phone="+237699500061")
    assert _auth_client(user).get("/api/rides/my-offer/").status_code == 403
