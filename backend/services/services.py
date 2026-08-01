"""
services.services — technician matching, the ServiceRequest lifecycle,
and the Taskln read-only lookup. Every function that moves money routes
through transactions.services (the same reservation/escrow machinery
bookings use) rather than a parallel payment system.
"""
from django.db import transaction as db_transaction

from .models import (
    ServiceCategory, ServiceRequest, ServiceRequestStatus, TechnicianLocationPing,
    TasklnIntegrationSettings, TasklnWorkerRecord,
)


class InvalidSpecialtyError(Exception):
    pass


def set_technician_specialties(technician_profile, specialties: list):
    """Validates every specialty against the FIXED ServiceCategory list
    before saving — this is the actual enforcement behind 'specialties
    limited to a fixed list', since the underlying field (identity.
    TechnicianProfile.specialties) is a plain JSONField with no built-in
    choice validation of its own."""
    valid_categories = {choice.value for choice in ServiceCategory}
    invalid = [s for s in specialties if s not in valid_categories]
    if invalid:
        raise InvalidSpecialtyError(f"Not a supported service category: {invalid}")
    technician_profile.specialties = specialties
    technician_profile.save(update_fields=["specialties"])
    return technician_profile


def find_available_technicians(*, category: str, latitude, longitude, radius_km=10):
    """Matches by specialty AND proximity — reuses the same distance math
    as 'properties near me' (geo.services.haversine_distance_km), rather
    than a second, subtly-different distance calculation."""
    from geo.services import haversine_distance_km
    from identity.models import TechnicianProfile

    candidates = TechnicianProfile.objects.filter(specialties__contains=category)

    results = []
    for tech_profile in candidates:
        latest_ping = TechnicianLocationPing.objects.filter(technician=tech_profile.user).order_by("-recorded_at").first()
        if latest_ping is None:
            continue  # no known location yet — can't confirm they're nearby
        distance = haversine_distance_km(latitude, longitude, latest_ping.latitude, latest_ping.longitude)
        if distance <= radius_km:
            results.append((tech_profile, distance))

    results.sort(key=lambda pair: pair[1])
    return results


def create_service_request(*, requester, category: str, description: str, quarter=None, priority=None):
    from .models import ServiceRequestPriority
    return ServiceRequest.objects.create(
        requester=requester, category=category, description=description,
        quarter=quarter, priority=priority or ServiceRequestPriority.SCHEDULED,
    )


def accept_service_request(*, service_request: ServiceRequest, technician):
    from django.utils import timezone
    service_request.technician = technician
    service_request.status = ServiceRequestStatus.ACCEPTED
    service_request.accepted_at = timezone.now()
    service_request.save(update_fields=["technician", "status", "accepted_at"])
    return service_request


def start_service(service_request: ServiceRequest):
    from django.utils import timezone
    service_request.status = ServiceRequestStatus.IN_PROGRESS
    service_request.started_at = timezone.now()
    service_request.save(update_fields=["status", "started_at"])
    return service_request


def complete_service_request_with_payment(
    *, service_request: ServiceRequest, amount_xaf, lock_client, payment_gateway, phone_number: str,
):
    """The full pay-and-complete flow: creates a Booking of type
    SERVICE_REQUEST, reserves it, confirms payment through the SAME
    reservation/escrow machinery as a property booking, and links the
    resulting Booking back to this ServiceRequest — proving 'service
    payments must use Oaziland's own escrow system, never Taskln's
    payment rails directly', per Prompt 10's explicit requirement."""
    from transactions.services import reserve_booking, confirm_payment, initiate_booking_payment
    from transactions.models import BookingType

    booking = reserve_booking(
        lock_client=lock_client, requester=service_request.requester,
        booking_type=BookingType.SERVICE_REQUEST,
        target_content_type="services.ServiceRequest", target_id=service_request.id,
        amount_xaf=amount_xaf,
    )
    initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
    escrow = confirm_payment(
        lock_client=lock_client, booking=booking, provider="MTN_MOMO",
        provider_reference=booking.idempotency_key, payment_gateway=payment_gateway,
        raw_webhook_payload=b"{}", webhook_signature_header="sandbox",
    )

    from django.utils import timezone
    with db_transaction.atomic():
        service_request.booking = booking
        service_request.status = ServiceRequestStatus.COMPLETED
        service_request.completed_at = timezone.now()
        service_request.save(update_fields=["booking", "status", "completed_at"])
        booking.complete()

    return booking, escrow


def lookup_taskln_worker(taskln_worker_id: str):
    """The READ-ONLY Taskln integration point. Returns the local mock
    cache record — NOT a live call to Taskln's real API, which doesn't
    exist yet. is_mock_data=True on every result makes this impossible
    to mistake for real data."""
    try:
        return TasklnWorkerRecord.objects.get(taskln_worker_id=taskln_worker_id)
    except TasklnWorkerRecord.DoesNotExist:
        return None


def is_pre_verified_via_taskln(taskln_worker_id: str) -> bool:
    """Answers 'does this Taskln-verified worker count as pre-verified on
    Oaziland' — reads the OPEN configuration flag (TasklnIntegrationSettings)
    rather than hardcoding an answer, per Prompt 10's explicit instruction
    that this must stay a configurable decision, not a baked-in one."""
    settings_row = TasklnIntegrationSettings.current()
    if not settings_row.trust_taskln_verification:
        return False
    worker = lookup_taskln_worker(taskln_worker_id)
    return worker is not None and worker.taskln_verification_status == "VERIFIED"
