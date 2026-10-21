"""Ride safety: fare can't be dodged with a fake distance, rides can be cancelled or released, open requests are private."""
import pytest
from rest_framework.test import APIClient
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from django.core.management import call_command
from django.utils import timezone

from identity.models import User, AdminProfile
from marketplace.models import RideBooking, RideStatus
from marketplace.services import expire_stale_rides
from notifications.models import Notification
from marketplace.tests.test_marketplace_api import _verify, _auth_client


_admin_counter = iter(range(100000, 999999))


def _verified_driver(name, phone, category="STANDARD"):
    driver = User.objects.create(username=name, phone=phone)
    admin = User.objects.create(username=f"{name}_admin", phone=f"+237698{next(_admin_counter)}")
    AdminProfile.objects.create(user=admin, permissions=[])
    client = _auth_client(driver)
    profile = client.post("/api/my-driver-profile/", {"license_number": f"CM-{name}"})
    _auth_client(admin).post(f"/api/admin/drivers/{profile.data['id']}/verify/")
    vehicle = client.post("/api/my-vehicles/", {"vehicle_category": category, "make": "Toyota", "model": "Corolla", "plate_number": f"LT-{name[-3:]}"})
    return driver, client, vehicle.data["id"]


def _request_ride(rider, **extra):
    payload = {"pickup_description": "Bastos roundabout", "dropoff_description": "Airport", "distance_km": "5", **extra}
    response = _auth_client(rider).post("/api/rides/", payload)
    assert response.status_code == 201, response.data
    return response.data


@pytest.mark.django_db
def test_a_tiny_typed_distance_cannot_dodge_the_fare():
    rider = _verify(User.objects.create(username="rs_rider1", phone="+237699300001"))
    # Roughly 17 km apart: Bastos to Nsimalen airport.
    far = _request_ride(
        rider, distance_km="0.1",
        pickup_latitude="3.8800000", pickup_longitude="11.5210000", dropoff_latitude="3.7226000", dropoff_longitude="11.5533000",
    )
    assert Decimal(far["fare_estimate_xaf"]) > Decimal("2500")
    # Without coordinates the typed distance is all there is, as before.
    plain = _request_ride(rider, distance_km="5")
    assert Decimal(plain["fare_estimate_xaf"]) == Decimal("1250.00")
    # A distance larger than the straight line is respected (roads wind).
    longer = _request_ride(
        rider, distance_km="30",
        pickup_latitude="3.8800000", pickup_longitude="11.5210000", dropoff_latitude="3.7226000", dropoff_longitude="11.5533000",
    )
    assert Decimal(longer["fare_estimate_xaf"]) == Decimal("500") + Decimal("30") * Decimal("150")


@pytest.mark.django_db
def test_a_ride_keeps_the_distance_its_fare_was_charged_on():
    rider = _verify(User.objects.create(username="rs_rider8", phone="+237699300081"))
    far = _request_ride(
        rider, distance_km="0.1",
        pickup_latitude="3.8800000", pickup_longitude="11.5210000", dropoff_latitude="3.7226000", dropoff_longitude="11.5533000",
    )
    assert Decimal(far["distance_km"]) > Decimal("10")
    assert Decimal(_request_ride(rider, distance_km="5")["distance_km"]) == Decimal("5.00")
    assert _auth_client(rider).get(f"/api/rides/{far['id']}/").data["distance_km"] == far["distance_km"]


@pytest.mark.django_db
def test_rider_can_cancel_before_the_trip_starts_and_driver_is_told():
    rider = _verify(User.objects.create(username="rs_rider2", phone="+237699300011"))
    driver, driver_client, vehicle_id = _verified_driver("rs_driver2", "+237699300012")
    ride = _request_ride(rider)
    driver_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id})

    assert driver_client.post(f"/api/rides/{ride['id']}/cancel/").status_code == 403
    assert _auth_client(rider).post(f"/api/rides/{ride['id']}/cancel/").status_code == 200
    assert RideBooking.objects.get(pk=ride["id"]).status == RideStatus.CANCELLED
    assert Notification.objects.filter(recipient=driver, notification_type="RIDE_UPDATE").exists()
    assert _auth_client(rider).post(f"/api/rides/{ride['id']}/cancel/").status_code == 400


@pytest.mark.django_db
def test_a_started_ride_cannot_be_cancelled_or_released():
    rider = _verify(User.objects.create(username="rs_rider3", phone="+237699300021"))
    driver, driver_client, vehicle_id = _verified_driver("rs_driver3", "+237699300022")
    ride = _request_ride(rider)
    driver_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id})
    driver_client.post(f"/api/rides/{ride['id']}/start/")

    assert _auth_client(rider).post(f"/api/rides/{ride['id']}/cancel/").status_code == 400
    assert driver_client.post(f"/api/rides/{ride['id']}/release/").status_code == 400


@pytest.mark.django_db
def test_driver_can_release_an_accepted_ride_and_it_reopens():
    rider = _verify(User.objects.create(username="rs_rider4", phone="+237699300031"))
    driver, driver_client, vehicle_id = _verified_driver("rs_driver4", "+237699300032")
    other, other_client, _ = _verified_driver("rs_other4", "+237699300034")
    ride = _request_ride(rider)
    driver_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id})

    assert other_client.post(f"/api/rides/{ride['id']}/release/").status_code == 403
    assert driver_client.post(f"/api/rides/{ride['id']}/release/").status_code == 200
    reopened = RideBooking.objects.get(pk=ride["id"])
    assert reopened.status == RideStatus.REQUESTED and reopened.driver is None and reopened.vehicle is None
    assert Notification.objects.filter(recipient=rider, notification_type="RIDE_UPDATE").exists()


@pytest.mark.django_db
def test_stale_ride_requests_expire():
    rider = _verify(User.objects.create(username="rs_rider5", phone="+237699300041"))
    old, fresh = _request_ride(rider), _request_ride(rider)
    RideBooking.objects.filter(pk=old["id"]).update(requested_at=timezone.now() - timedelta(hours=3))

    assert [r.pk for r in expire_stale_rides()] == [RideBooking.objects.get(pk=old["id"]).pk]
    assert RideBooking.objects.get(pk=old["id"]).status == RideStatus.CANCELLED
    assert RideBooking.objects.get(pk=fresh["id"]).status == RideStatus.REQUESTED

    RideBooking.objects.filter(pk=fresh["id"]).update(requested_at=timezone.now() - timedelta(hours=3))
    out = StringIO()
    call_command("expire_stale_rides", stdout=out)
    assert "Expired 1" in out.getvalue()


@pytest.mark.django_db
def test_open_requests_are_only_visible_to_verified_drivers_and_are_masked():
    rider = _verify(User.objects.create(username="rs_rider6", phone="+237699300051", first_name="Marie", last_name="Ngono"))
    driver, driver_client, _ = _verified_driver("rs_driver6", "+237699300052")
    outsider = User.objects.create(username="rs_outsider6", phone="+237699300053")
    ride = _request_ride(
        rider, pickup_latitude="3.8481234", pickup_longitude="11.5021234", dropoff_latitude="3.8661234", dropoff_longitude="11.5201234",
    )

    outsider_list = [r["id"] for r in _auth_client(outsider).get("/api/rides/").data["results"]]
    assert ride["id"] not in outsider_list
    assert _auth_client(outsider).get(f"/api/rides/{ride['id']}/").status_code == 404

    seen = {r["id"]: r for r in driver_client.get("/api/rides/").data["results"]}[ride["id"]]
    assert seen["rider"] is None and seen["rider_name"] == "Marie"
    assert seen["pickup_latitude"] == "3.85" and seen["dropoff_longitude"] == "11.52"
    detail = driver_client.get(f"/api/rides/{ride['id']}/").data
    assert detail["rider"] is None and detail["pickup_latitude"] == "3.85"

    own = _auth_client(rider).get(f"/api/rides/{ride['id']}/").data
    assert own["pickup_latitude"].startswith("3.84812") and own["rider"] is not None


@pytest.mark.django_db
def test_rider_sees_the_drivers_vehicle_once_a_driver_accepts():
    rider = _verify(User.objects.create(username="rs_rider7", phone="+237699300071"))
    driver, driver_client, vehicle_id = _verified_driver("rs_driver7", "+237699300072")
    ride = _request_ride(rider)
    assert _auth_client(rider).get(f"/api/rides/{ride['id']}/").data["vehicle_details"] is None

    driver_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id})
    seen = _auth_client(rider).get(f"/api/rides/{ride['id']}/").data
    assert seen["vehicle_details"] == {"vehicle_category": "STANDARD", "make": "Toyota", "model": "Corolla", "plate_number": "LT-er7"}


@pytest.mark.django_db
def test_a_driver_can_only_be_rated_after_a_completed_ride_with_them():
    rider = _verify(User.objects.create(username="rs_rider9", phone="+237699300091"))
    stranger = _verify(User.objects.create(username="rs_stranger9", phone="+237699300092"))
    driver, driver_client, vehicle_id = _verified_driver("rs_driver9", "+237699300093")
    ride = _request_ride(rider)
    driver_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id})
    rate = lambda client, user_id: client.post("/api/ratings/", {"subject_user": str(user_id), "score": 5}, format="json")

    # A ride that has not been completed earns nothing, and strangers never can.
    assert rate(_auth_client(rider), driver.id).status_code == 403
    assert rate(_auth_client(stranger), driver.id).status_code == 403

    RideBooking.objects.filter(pk=ride["id"]).update(status=RideStatus.COMPLETED)
    assert rate(_auth_client(rider), driver.id).status_code == 201
    assert rate(driver_client, rider.id).status_code == 201
    assert rate(_auth_client(stranger), driver.id).status_code == 403


@pytest.mark.django_db
def test_people_who_are_not_drivers_can_still_be_rated_by_anyone():
    agent = User.objects.create(username="rs_agent10", phone="+237699300101")
    anyone = _verify(User.objects.create(username="rs_anyone10", phone="+237699300102"))
    response = _auth_client(anyone).post("/api/ratings/", {"subject_user": str(agent.id), "score": 4}, format="json")
    assert response.status_code == 201


@pytest.mark.django_db
def test_sos_alerts_admins_and_only_works_for_the_people_on_an_active_ride():
    rider = _verify(User.objects.create(username="rs_rider11", phone="+237699300111"))
    outsider = _verify(User.objects.create(username="rs_outsider11", phone="+237699300112"))
    driver, driver_client, vehicle_id = _verified_driver("rs_driver11", "+237699300113")
    ride = _request_ride(rider)
    rider_client = _auth_client(rider)
    url = f"/api/rides/{ride['id']}/sos/"

    # Nobody is assigned yet, so there is nothing to raise an SOS about.
    assert rider_client.post(url, {}, format="json").status_code == 400

    driver_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id})
    assert _auth_client(outsider).post(url, {}, format="json").status_code == 403

    first = rider_client.post(url, {"latitude": "3.8480000", "longitude": "11.5020000", "note": "Driver took a wrong turn"}, format="json")
    assert first.status_code == 200 and first.data["admins_alerted"] == 1
    alert = Notification.objects.get(notification_type="RIDE_SOS")
    assert "Driver took a wrong turn" in alert.message and "3.848" in alert.message and "LT-r11" in alert.message
    saved = RideBooking.objects.get(pk=ride["id"])
    assert saved.sos_raised_at is not None and saved.sos_raised_by_id == rider.id
    assert rider_client.get(f"/api/rides/{ride['id']}/").data["sos_raised_at"] is not None

    # A second press straight away does not alert the admins again; the driver can raise their own.
    assert rider_client.post(url, {}, format="json").data["admins_alerted"] == 0
    assert driver_client.post(url, {}, format="json").data["admins_alerted"] == 1
    assert Notification.objects.filter(notification_type="RIDE_SOS").count() == 2


@pytest.mark.django_db
def test_sos_also_alerts_the_senders_emergency_contact_and_survives_a_failing_sms(monkeypatch):
    rider = _verify(User.objects.create(username="rs_rider13", phone="+237699300131", first_name="Marie", last_name="Ngono"))
    driver, driver_client, vehicle_id = _verified_driver("rs_driver13", "+237699300133")
    ride = _request_ride(rider)
    driver_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id})
    rider_client = _auth_client(rider)
    url = f"/api/rides/{ride['id']}/sos/"

    # Without a contact only the admins hear about it.
    assert rider_client.post(url, {}, format="json").data["emergency_contact_alerted"] is False

    assert rider_client.put("/api/my-emergency-contact/", {"name": "Paul Ngono", "phone": "+237 677 000 111"}, format="json").status_code == 200
    RideBooking.objects.filter(pk=ride["id"]).update(sos_raised_at=None)
    response = rider_client.post(url, {"latitude": "3.8480000", "longitude": "11.5020000"}, format="json")
    assert response.data["emergency_contact_alerted"] is True and response.data["admins_alerted"] == 1
    text = Notification.objects.get(notification_type="RIDE_SOS", external_phone_number="+237 677 000 111")
    assert text.channel == "SMS" and "Marie Ngono pressed SOS" in text.message and "LT-r13" in text.message and "3.848" in text.message
    assert "+237699300131" in text.message and "+237699300133" not in text.message

    # A provider that cannot send must not stop the admins being alerted.
    def broken_sms(**kwargs):
        if kwargs.get("channel") == "SMS":
            raise NotImplementedError("SMS provider not connected")
        return real_notify(**kwargs)
    import notifications.services as notification_services
    real_notify = notification_services.notify
    monkeypatch.setattr(notification_services, "notify", broken_sms)
    RideBooking.objects.filter(pk=ride["id"]).update(sos_raised_at=None)
    failed = rider_client.post(url, {}, format="json")
    assert failed.status_code == 200 and failed.data["admins_alerted"] == 1 and failed.data["emergency_contact_alerted"] is False


@pytest.mark.django_db
def test_a_user_manages_their_own_emergency_contact():
    user = User.objects.create(username="rs_user14", phone="+237699300141")
    other = User.objects.create(username="rs_other14", phone="+237699300142")
    client = _auth_client(user)

    assert client.get("/api/my-emergency-contact/").status_code == 404
    assert client.put("/api/my-emergency-contact/", {"name": "Paul", "phone": "abc"}, format="json").status_code == 400
    assert client.put("/api/my-emergency-contact/", {"name": "  ", "phone": "+237677000111"}, format="json").status_code == 400
    assert client.put("/api/my-emergency-contact/", {"name": " Paul ", "phone": "+237677000111"}, format="json").data == {"name": "Paul", "phone": "+237677000111"}
    assert client.put("/api/my-emergency-contact/", {"name": "Paul", "phone": "+237677000222"}, format="json").status_code == 200
    assert client.get("/api/my-emergency-contact/").data["phone"] == "+237677000222"
    assert _auth_client(other).get("/api/my-emergency-contact/").status_code == 404
    assert APIClient().get("/api/my-emergency-contact/").status_code == 401

    assert client.delete("/api/my-emergency-contact/").status_code == 204
    assert client.get("/api/my-emergency-contact/").status_code == 404


@pytest.mark.django_db
def test_sos_is_refused_once_the_ride_is_over():
    rider = _verify(User.objects.create(username="rs_rider12", phone="+237699300121"))
    driver, driver_client, vehicle_id = _verified_driver("rs_driver12", "+237699300122")
    ride = _request_ride(rider)
    driver_client.post(f"/api/rides/{ride['id']}/accept/", {"vehicle_id": vehicle_id})
    RideBooking.objects.filter(pk=ride["id"]).update(status=RideStatus.COMPLETED)
    assert _auth_client(rider).post(f"/api/rides/{ride['id']}/sos/", {}, format="json").status_code == 400


@pytest.mark.django_db
def test_marketplace_search_rejects_bad_filter_values_instead_of_crashing():
    client = _auth_client(User.objects.create(username="rs_browser", phone="+237699300061"))
    assert client.get("/api/warehouses/?min_price=abc").status_code == 400
    assert client.get("/api/warehouses/?quarter_id=not-a-uuid").status_code == 400
    assert client.get("/api/warehouses/?min_price=100&max_price=900").status_code == 200
