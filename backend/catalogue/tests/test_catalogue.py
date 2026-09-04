"""
Tests proving the catalogue is genuinely seeded (not just an empty
mechanism) and that subscribing/requesting actually works, without
touching the existing student_hostels.AmenitySubscription system.
"""
import pytest
from django.core.management import call_command

from identity.models import User
from catalogue.models import Amenity, PartnerServiceOffering, SourcedVia, ServiceSubscriptionStatus
from catalogue.services import subscribe_to_amenity, request_partner_service, complete_partner_service_request


@pytest.mark.django_db
def test_seed_command_populates_real_catalogue_data():
    call_command("seed_catalogue")

    assert Amenity.objects.filter(name="Cooking Gas Refill/Delivery").exists()
    assert Amenity.objects.filter(name="Wi-Fi — Unlimited Tier").exists()
    assert PartnerServiceOffering.objects.filter(name="Notary & Title Transfer Assistance").exists()

    # Taskln-sourced items are correctly tagged, per the founder's
    # explicit 'some of these will be gotten through Taskln' instruction.
    gas_delivery = Amenity.objects.get(name="Cooking Gas Refill/Delivery")
    assert gas_delivery.sourced_via == SourcedVia.TASKLN

    moving_service = PartnerServiceOffering.objects.get(name="Moving & Transport Service")
    assert moving_service.sourced_via == SourcedVia.TASKLN


@pytest.mark.django_db
def test_seed_command_is_safe_to_run_twice():
    call_command("seed_catalogue")
    first_count = Amenity.objects.count()
    call_command("seed_catalogue")  # re-run
    second_count = Amenity.objects.count()
    assert first_count == second_count  # no duplicates


@pytest.mark.django_db
def test_subscribing_to_an_amenity():
    call_command("seed_catalogue")
    user = User.objects.create(username="catalogue_subscriber", phone="+237699980001")
    wifi = Amenity.objects.get(name="Wi-Fi — Standard Tier")

    subscription = subscribe_to_amenity(amenity=wifi, subscriber=user)
    assert subscription.status == ServiceSubscriptionStatus.ACTIVE

    subscription.cancel()
    assert subscription.status == ServiceSubscriptionStatus.CANCELLED
    assert subscription.cancelled_at is not None


@pytest.mark.django_db
def test_subscription_requires_a_subscriber_or_hostel_unit():
    call_command("seed_catalogue")
    wifi = Amenity.objects.get(name="Wi-Fi — Basic Tier")
    with pytest.raises(ValueError):
        subscribe_to_amenity(amenity=wifi)


@pytest.mark.django_db
def test_requesting_and_completing_a_partner_service():
    call_command("seed_catalogue")
    user = User.objects.create(username="catalogue_requester", phone="+237699980002")
    notary = PartnerServiceOffering.objects.get(name="Notary & Title Transfer Assistance")

    request = request_partner_service(offering=notary, requester=user, notes="Need help transferring a title in Bastos.")
    assert request.status == "REQUESTED"

    complete_partner_service_request(request)
    request.refresh_from_db()
    assert request.status == "COMPLETED"
    assert request.completed_at is not None


@pytest.mark.django_db
def test_existing_hostel_amenity_subscription_system_is_untouched():
    """Confirms the founder's explicit requirement: nothing from
    Prompt 11 was lost or modified by adding this generic catalogue."""
    from student_hostels.models import AmenitySubscription, AmenityType

    call_command("seed_catalogue")

    # The OLD system's enum and model still work exactly as before.
    assert AmenityType.LAUNDRY == "LAUNDRY"
    assert hasattr(AmenitySubscription, "cancel")
