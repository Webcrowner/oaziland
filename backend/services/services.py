"""
services.services — technician matching, the ServiceRequest lifecycle,
and the Taskln read-only lookup. Every function that moves money routes
through transactions.services (the same reservation/escrow machinery
bookings use) rather than a parallel payment system.
"""
from django.db import transaction as db_transaction
import re

from .models import (
    ServiceCategory, ServiceRequest, ServiceRequestPhoto, ServiceRequestStatus, TechnicianAvailabilitySlot,
    TechnicianLocationPing, TasklnIntegrationSettings, TasklnWorkerRecord,
)

# A ping older than this no longer says where the technician is now.
PING_MAX_AGE_HOURS = 24
# Cap on how many matching technicians get pinged for one new request.
MAX_NEW_REQUEST_ALERTS = 50
# How far from a technician's last known position the job board reaches by default.
BOARD_DEFAULT_RADIUS_KM = 30
BOARD_MAX_RADIUS_KM = 200
# An accepted job returns to the board if the technician sends no quote within this time.
QUOTE_DEADLINE_HOURS = 12
# Urgent jobs can't wait: the technician must quote sooner, and more technicians are alerted.
URGENT_QUOTE_DEADLINE_HOURS = 2
MAX_URGENT_REQUEST_ALERTS = 100
# A job with no map location can't be matched by distance, so fewer technicians are pinged for it.
MAX_UNPINNED_REQUEST_ALERTS = 20
# Held payment is released to the technician this long after they report the work done, unless disputed.
AUTO_RELEASE_HOURS = 72
# A technician this far past "on my way" or past the booked time without starting counts as a no-show.
NO_SHOW_GRACE_HOURS = 4
OPEN_JOB_STATUSES = (ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE, ServiceRequestStatus.IN_PROGRESS)


class InvalidSpecialtyError(Exception):
    pass


class NotARegisteredTechnicianError(Exception):
    pass


class TechnicianNotVerifiedError(Exception):
    pass


class ServiceRequestAlreadyAcceptedError(Exception):
    pass


class NotPartyToServiceRequestError(Exception):
    pass


class TechnicianSpecialtyMismatchError(Exception):
    pass


class ServiceRequestStateError(Exception):
    pass


class InvalidDirectRequestError(Exception):
    pass


class ContactSharingBlockedError(Exception):
    pass


CONTACT_SHARING_MESSAGE = (
    "For payment safety, keep phone numbers, emails and chat links inside Oaziland until the job is completed."
)
# 9+ digits in a row, allowing spaces, dots, dashes or brackets between them (a Cameroonian number is 9 digits).
_PHONE_PATTERN = re.compile(r"(?:\+?\d[\s.\-()_/]*){9,}")
_EMAIL_PATTERN = re.compile(r"[\w.+-]+\s?@\s?[\w-]+\s?\.\s?[a-z]{2,}", re.IGNORECASE)
_CHAT_LINK_PATTERN = re.compile(r"(wa\.me|whatsapp\.com|t\.me|telegram\.(me|org)|signal\.me)", re.IGNORECASE)
# Dates and clock times are long runs of digits too, so they are removed before looking for phone numbers.
_DATE_TIME_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}|\d{1,2}\s?[:hH]\s?\d{2}")


def contains_contact_details(text: str) -> bool:
    """True when the text carries a phone number, email address or messaging-app link."""
    without_dates = _DATE_TIME_PATTERN.sub(" ", text)
    return bool(_PHONE_PATTERN.search(without_dates) or _EMAIL_PATTERN.search(text) or _CHAT_LINK_PATTERN.search(text))


class AlreadyRegisteredTechnicianError(Exception):
    pass


class InvalidQuoteError(Exception):
    pass


class NotAuthorizedForFacilityContractError(Exception):
    pass


class NotAuthorizedForProjectCaseError(Exception):
    pass


def register_as_technician(*, user, specialties: list, coverage_quarter_id=None):
    """The real gap this closes: TechnicianProfile could previously
    only ever be created directly in the database (admin/tests) —
    identical to the exact bug already found and fixed for OaziGo
    drivers this session (register_as_driver). Specialties are
    validated against the fixed ServiceCategory list via
    set_technician_specialties rather than duplicating that check
    here."""
    from identity.models import TechnicianProfile

    if TechnicianProfile.objects.filter(user=user).exists():
        raise AlreadyRegisteredTechnicianError("You are already registered as a technician.")
    technician_profile = TechnicianProfile.objects.create(user=user, coverage_quarter_id=coverage_quarter_id)
    set_technician_specialties(technician_profile, specialties)
    return technician_profile


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
    """Matches by specialty, proximity, AND current availability — reuses
    the same distance math as 'properties near me'
    (geo.services.haversine_distance_km). A technician with no
    availability slots at all is treated as always-on (matches this
    function's pre-existing behavior for anyone who's never set a
    schedule), but one who HAS defined slots only ever surfaces during
    a slot that covers right now — closing the gap where
    TechnicianAvailabilitySlot was a real, saved model nothing ever
    actually checked."""
    from django.utils import timezone
    from datetime import timedelta
    from geo.services import haversine_distance_km
    from identity.models import TechnicianProfile

    # Filtered in Python: JSONField __contains isn't supported on every DB backend (e.g. SQLite).
    candidates = [p for p in TechnicianProfile.objects.select_related("user") if category in (p.specialties or [])]

    now = timezone.localtime()
    current_day = now.weekday()
    current_time = now.time()
    ping_cutoff = timezone.now() - timedelta(hours=PING_MAX_AGE_HOURS)

    results = []
    for tech_profile in candidates:
        latest_ping = TechnicianLocationPing.objects.filter(technician=tech_profile.user).order_by("-recorded_at").first()
        if latest_ping is None or latest_ping.recorded_at < ping_cutoff:
            continue  # no recent known location — can't confirm they're nearby
        slots = TechnicianAvailabilitySlot.objects.filter(technician=tech_profile.user)
        if slots.exists() and not slots.filter(day_of_week=current_day, start_time__lte=current_time, end_time__gte=current_time).exists():
            continue  # has a defined schedule, but not within it right now
        distance = haversine_distance_km(latitude, longitude, latest_ping.latitude, latest_ping.longitude)
        if distance <= radius_km:
            results.append((tech_profile, distance))

    results.sort(key=lambda pair: pair[1])
    return results


def submit_technician_location_ping(*, technician, latitude, longitude):
    """The real gap this closes: find_available_technicians() has always
    required a TechnicianLocationPing to exist before a technician can
    ever be matched, but nothing ever let a technician actually create
    one — the 'find nearby technicians' feature was permanently empty
    in practice."""
    return TechnicianLocationPing.objects.create(technician=technician, latitude=latitude, longitude=longitude)


def get_technician_availability(technician):
    return TechnicianAvailabilitySlot.objects.filter(technician=technician).order_by("day_of_week", "start_time")


def set_technician_availability(*, technician, slots: list):
    """Replaces the technician's full weekly schedule with the given
    list of {day_of_week, start_time, end_time} — a full replace (not a
    merge) keeps this idempotent and avoids ever accumulating stale,
    overlapping windows from repeated edits."""
    TechnicianAvailabilitySlot.objects.filter(technician=technician).delete()
    created = [
        TechnicianAvailabilitySlot(
            technician=technician, day_of_week=slot["day_of_week"],
            start_time=slot["start_time"], end_time=slot["end_time"],
        )
        for slot in slots
    ]
    return TechnicianAvailabilitySlot.objects.bulk_create(created)


def validate_requested_technician(*, requester, technician, category: str):
    """A directed request must name a verified technician who offers the category."""
    profile = getattr(technician, "technician_profile", None)
    if technician.id == requester.id:
        raise InvalidDirectRequestError("You cannot request yourself.")
    if profile is None or not profile.is_verified:
        raise InvalidDirectRequestError("That technician is not verified.")
    if category not in (profile.specialties or []):
        raise InvalidDirectRequestError("That technician does not offer this service.")


def get_technician_reference_point(user):
    """(latitude, longitude) from the technician's latest recent ping, or None when it is unknown."""
    from django.utils import timezone
    from datetime import timedelta
    ping = (
        TechnicianLocationPing.objects.filter(technician=user, recorded_at__gte=timezone.now() - timedelta(hours=PING_MAX_AGE_HOURS))
        .order_by("-recorded_at").first()
    )
    return (float(ping.latitude), float(ping.longitude)) if ping else None


def bounding_box(latitude, longitude, radius_km):
    """Square around a point that contains the whole radius circle; cheap to filter on in any database."""
    import math
    lat_delta = radius_km / 111.0
    lon_delta = radius_km / (111.0 * max(math.cos(math.radians(latitude)), 0.01))
    return latitude - lat_delta, latitude + lat_delta, longitude - lon_delta, longitude + lon_delta


def quote_deadline_hours(service_request: ServiceRequest, normal_hours: int = QUOTE_DEADLINE_HOURS) -> int:
    from .models import ServiceRequestPriority
    return URGENT_QUOTE_DEADLINE_HOURS if service_request.priority == ServiceRequestPriority.URGENT else normal_hours


def _alert_board_technicians(service_request: ServiceRequest, exclude=None):
    from identity.models import TechnicianProfile
    from geo.services import haversine_distance_km
    from .models import ServiceRequestPriority
    urgent = service_request.priority == ServiceRequestPriority.URGENT
    # Specialties are filtered in Python: JSONField __contains isn't supported on every DB backend.
    verified = TechnicianProfile.objects.filter(is_verified=True).exclude(user=service_request.requester).select_related("user")
    if exclude is not None:
        verified = verified.exclude(user=exclude)
    verified = verified.exclude(user__in=service_request.excluded_technicians.all())
    matching = [p for p in verified if service_request.category in (p.specialties or [])]

    has_site = service_request.latitude is not None and service_request.longitude is not None
    ranked, unknown = [], []
    for profile in matching:
        point = get_technician_reference_point(profile.user) if has_site else None
        if point is None:
            unknown.append(profile)  # location unknown, so we can't rule them out
            continue
        distance = haversine_distance_km(service_request.latitude, service_request.longitude, point[0], point[1])
        if distance <= BOARD_DEFAULT_RADIUS_KM:
            ranked.append((distance, profile))
    ranked.sort(key=lambda pair: pair[0])
    cap = MAX_URGENT_REQUEST_ALERTS if urgent else MAX_NEW_REQUEST_ALERTS
    if not has_site:
        cap = min(cap, MAX_UNPINNED_REQUEST_ALERTS)
    for profile in ([p for _, p in ranked] + unknown)[:cap]:
        _notify(
            profile.user, "SERVICE_REQUEST_NEW", "URGENT job nearby" if urgent else "New job nearby",
            f"A new {service_request.get_category_display()} job is open on the job board.", service_request,
        )


def create_service_request(*, requester, category: str, description: str, quarter=None, priority=None, latitude=None, longitude=None, scheduled_for=None, requested_technician=None, address_note: str = "", area_label: str = "", photo_urls=()):
    from .models import ServiceRequestPriority
    if requested_technician is not None:
        validate_requested_technician(requester=requester, technician=requested_technician, category=category)
    service_request = ServiceRequest.objects.create(
        requester=requester, category=category, description=description,
        quarter=quarter, priority=priority or ServiceRequestPriority.SCHEDULED,
        latitude=latitude, longitude=longitude, scheduled_for=scheduled_for,
        requested_technician=requested_technician, address_note=address_note.strip(), area_label=area_label.strip(),
    )
    for url in photo_urls:
        ServiceRequestPhoto.objects.create(service_request=service_request, photo_type="BEFORE", file_url=url)
    if requested_technician is not None:
        _notify(
            requested_technician, "SERVICE_REQUEST_DIRECT", "Someone requested you",
            f"{requester.full_name or requester.username} asked you for a {service_request.get_category_display()} job.", service_request,
        )
    else:
        _alert_board_technicians(service_request)
    return service_request


def open_request_to_all(*, service_request: ServiceRequest, actor):
    """Requester gives up waiting for the chosen technician and puts the job on the board."""
    if service_request.requester_id != actor.id:
        raise NotPartyToServiceRequestError("Only the requester can open this request to all technicians.")
    _release_directed_request(service_request, notify_requester=False)
    return service_request


def decline_service_request(*, service_request: ServiceRequest, technician):
    """The chosen technician turns the job down; it goes to the board and the requester is told."""
    if service_request.requested_technician_id != technician.id:
        raise NotPartyToServiceRequestError("This job was not requested from you.")
    _release_directed_request(service_request, notify_requester=True, exclude_chosen=technician)
    return service_request


def _release_directed_request(service_request: ServiceRequest, *, notify_requester: bool, exclude_chosen=None):
    updated = ServiceRequest.objects.filter(
        pk=service_request.pk, status=ServiceRequestStatus.REQUESTED, requested_technician__isnull=False,
    ).update(requested_technician=None)
    if not updated:
        raise ServiceRequestStateError("This request is not waiting on a specific technician.")
    service_request.refresh_from_db()
    if exclude_chosen is not None:
        service_request.excluded_technicians.add(exclude_chosen)
    if notify_requester:
        _notify(
            service_request.requester, "SERVICE_REQUEST_DECLINED", "The technician you chose is unavailable",
            "Your request is now open to other technicians on the job board.", service_request,
        )
    _alert_board_technicians(service_request)


def _notify(recipient, notification_type: str, title: str, message: str, service_request):
    from notifications.services import notify
    notify(
        recipient=recipient, notification_type=notification_type, title=title,
        message=message, related_reference=str(service_request.id),
    )


def _held_escrow(service_request: ServiceRequest):
    """The job's payment escrow while the money is still held, else None."""
    from django.core.exceptions import ObjectDoesNotExist
    from transactions.models import EscrowStatus
    if service_request.booking_id is None:
        return None
    try:
        escrow = service_request.booking.escrow
    except ObjectDoesNotExist:
        return None
    return escrow if escrow.status == EscrowStatus.HELD else None


def is_escrow_funded(service_request: ServiceRequest) -> bool:
    return _held_escrow(service_request) is not None


def _refund_held_escrow(service_request: ServiceRequest) -> bool:
    """Returns held money to the requester and detaches the cancelled booking
    so a fresh payment can be made if the job is reassigned."""
    escrow = _held_escrow(service_request)
    if escrow is None:
        return False
    with db_transaction.atomic():
        escrow.refund()
        escrow.booking.cancel()
        service_request.booking = None
        service_request.save(update_fields=["booking"])
    _notify(
        service_request.requester, "SERVICE_REQUEST_REFUNDED", "Your payment was refunded",
        f"{escrow.gross_amount_xaf} XAF held for this job was returned to you.", service_request,
    )
    return True


def fund_service_request_escrow(*, service_request: ServiceRequest, requester, lock_client, payment_gateway, phone_number: str):
    """The requester pays the approved quote into escrow BEFORE work starts, so
    the technician is guaranteed payment and the requester's money stays
    protected until they confirm the job is done."""
    from transactions.services import reserve_booking, confirm_payment, initiate_booking_payment, fail_payment
    from transactions.models import BookingType
    if service_request.requester_id != requester.id:
        raise NotPartyToServiceRequestError("Only the requester can pay for this job.")
    if service_request.status not in OPEN_JOB_STATUSES:
        raise ServiceRequestStateError("The job can only be paid for while it is active.")
    if not service_request.quote_approved or service_request.quoted_amount_xaf is None:
        raise InvalidQuoteError("Approve the quote before paying.")
    if service_request.booking_id is not None:
        raise ServiceRequestStateError("This job is already paid for.")

    booking = reserve_booking(
        lock_client=lock_client, requester=service_request.requester,
        booking_type=BookingType.SERVICE_REQUEST,
        target_content_type="services.ServiceRequest", target_id=service_request.id,
        amount_xaf=service_request.quoted_amount_xaf,
    )
    debit = initiate_booking_payment(booking=booking, payment_gateway=payment_gateway, phone_number=phone_number)
    if not debit.success:
        fail_payment(lock_client=lock_client, booking=booking)
        raise ServiceRequestStateError("The payment could not be completed. Please try again.")
    escrow = confirm_payment(
        lock_client=lock_client, booking=booking, provider="MTN_MOMO",
        provider_reference=booking.idempotency_key, payment_gateway=payment_gateway,
        raw_webhook_payload=b"{}", webhook_signature_header="sandbox",
    )
    service_request.booking = booking
    service_request.save(update_fields=["booking"])
    if service_request.technician_id:
        _notify(
            service_request.technician, "SERVICE_REQUEST_FUNDED", "The job is paid into escrow",
            f"{service_request.quoted_amount_xaf} XAF is secured — you can start the job.", service_request,
        )
    return escrow


def _assigned_technician_or_raise(service_request: ServiceRequest, technician):
    if service_request.technician_id != technician.id:
        raise NotPartyToServiceRequestError("Only the request's own technician can do this.")


def accept_service_request(*, service_request: ServiceRequest, technician):
    """Vetting (registered + admin-verified + matching specialty) is
    checked first; the claim itself is a single conditional UPDATE so
    two technicians racing for the same job can never both win."""
    from django.utils import timezone
    if not hasattr(technician, "technician_profile"):
        raise NotARegisteredTechnicianError("You must register as a technician before accepting a job.")
    profile = technician.technician_profile
    if not profile.is_verified:
        raise TechnicianNotVerifiedError("Your technician registration is still awaiting verification.")
    if service_request.requester_id == technician.id:
        raise NotPartyToServiceRequestError("You cannot accept your own request.")
    if service_request.category not in (profile.specialties or []):
        raise TechnicianSpecialtyMismatchError("This job is outside your registered specialties.")
    if service_request.requested_technician_id not in (None, technician.id):
        raise NotPartyToServiceRequestError("The requester chose a specific technician for this job.")
    if service_request.excluded_technicians.filter(pk=technician.pk).exists():
        raise NotPartyToServiceRequestError("You left this job earlier, so you cannot take it again.")

    claimed = ServiceRequest.objects.filter(pk=service_request.pk, status=ServiceRequestStatus.REQUESTED).update(
        technician=technician, status=ServiceRequestStatus.ACCEPTED, accepted_at=timezone.now(),
    )
    if not claimed:
        raise ServiceRequestStateError("This request is no longer available to accept.")
    service_request.refresh_from_db()
    _notify(
        service_request.requester, "SERVICE_REQUEST_ACCEPTED", "A technician accepted your request",
        f"{technician.full_name or technician.username} will handle your {service_request.get_category_display()} job.",
        service_request,
    )
    return service_request


def _unassign_technician(service_request: ServiceRequest, *, statuses, technician=None) -> bool:
    """Atomically puts a pre-work job back to REQUESTED with no technician or quote."""
    matching = ServiceRequest.objects.filter(pk=service_request.pk, status__in=statuses)
    if technician is not None:
        matching = matching.filter(technician=technician)
    released = matching.update(
        technician=None, status=ServiceRequestStatus.REQUESTED, accepted_at=None, en_route_at=None,
        requested_technician=None,
        quoted_amount_xaf=None, quoted_labor_xaf=None, quoted_materials_xaf=None, quote_approved=False,
    )
    if released:
        service_request.refresh_from_db()
        if technician is not None:
            service_request.excluded_technicians.add(technician)
    return bool(released)


def release_service_request(*, service_request: ServiceRequest, technician):
    """A technician backing out before work starts — the request goes
    back on the board instead of leaving the requester stuck."""
    _assigned_technician_or_raise(service_request, technician)
    pre_work = [ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE]
    if not _unassign_technician(service_request, statuses=pre_work, technician=technician):
        raise ServiceRequestStateError("Work has already started — raise a dispute instead of releasing the job.")
    _refund_held_escrow(service_request)
    _notify(
        service_request.requester, "SERVICE_REQUEST_RELEASED", "Your technician had to pull out",
        "Your request is back on the job board for another technician.", service_request,
    )
    _alert_board_technicians(service_request, exclude=technician)
    return service_request


def dismiss_technician(*, service_request: ServiceRequest, requester):
    """The requester replaces an assigned technician before work starts; any held payment is refunded."""
    if service_request.requester_id != requester.id:
        raise NotPartyToServiceRequestError("Only the requester can release the technician.")
    technician = service_request.technician
    if technician is None:
        raise ServiceRequestStateError("No technician is assigned to this job.")
    if service_request.status == ServiceRequestStatus.EN_ROUTE and is_escrow_funded(service_request) and not is_technician_overdue(service_request):
        raise ServiceRequestStateError("Your technician is already on the way — report a problem instead.")
    pre_work = [ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE]
    if not _unassign_technician(service_request, statuses=pre_work, technician=technician):
        raise ServiceRequestStateError("Work has already started — report a problem instead.")
    _refund_held_escrow(service_request)
    _notify(
        technician, "SERVICE_REQUEST_DISMISSED", "You were released from a job",
        f"The requester chose to find another technician for the {service_request.get_category_display()} job.", service_request,
    )
    _alert_board_technicians(service_request, exclude=technician)
    return service_request


def reject_quote(*, service_request: ServiceRequest, requester):
    """The requester turns down the proposed price; the technician must send a new one."""
    if service_request.requester_id != requester.id:
        raise NotPartyToServiceRequestError("Only the requester can reject the quote.")
    if service_request.status not in (ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE):
        raise ServiceRequestStateError("A quote can only be rejected before work starts.")
    if service_request.quoted_amount_xaf is None:
        raise InvalidQuoteError("There is no quote to reject.")
    if service_request.booking_id is not None:
        raise ServiceRequestStateError("The price is locked once you have paid into escrow.")
    service_request.quoted_amount_xaf = None
    service_request.quoted_labor_xaf = None
    service_request.quoted_materials_xaf = None
    service_request.quote_approved = False
    service_request.save(update_fields=["quoted_amount_xaf", "quoted_labor_xaf", "quoted_materials_xaf", "quote_approved"])
    _notify(
        service_request.technician, "SERVICE_REQUEST_QUOTE_REJECTED", "Your quote was declined",
        "The requester did not accept your price. Send a revised quote or message them.", service_request,
    )
    return service_request


def _no_show_reference(service_request: ServiceRequest):
    """The moment the technician was due to be working: when they set off, or the booked time if that is later."""
    candidates = [t for t in (service_request.en_route_at, service_request.scheduled_for) if t is not None]
    return max(candidates) if candidates else None


def is_technician_overdue(service_request: ServiceRequest, now=None, grace_hours: int = NO_SHOW_GRACE_HOURS) -> bool:
    from datetime import timedelta
    from django.utils import timezone
    if service_request.status not in (ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE):
        return False
    reference = _no_show_reference(service_request)
    return reference is not None and reference < (now or timezone.now()) - timedelta(hours=grace_hours)


def release_no_show_technicians(*, grace_hours: int = NO_SHOW_GRACE_HOURS, now=None) -> list:
    """Returns jobs to the board (refunding any held payment) when the technician set off or was
    booked but never started within grace_hours. Meant to run on a schedule."""
    from datetime import timedelta
    from django.db.models import Q
    from django.utils import timezone
    now = now or timezone.now()
    cutoff = now - timedelta(hours=grace_hours)
    candidates = ServiceRequest.objects.filter(
        status__in=[ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE],
    ).filter(Q(en_route_at__lt=cutoff) | Q(scheduled_for__lt=cutoff)).select_related("requester", "technician")
    released = []
    for job in candidates:
        technician = job.technician
        if technician is None or not is_technician_overdue(job, now, grace_hours):
            continue
        if not _unassign_technician(job, statuses=[ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE], technician=technician):
            continue
        _refund_held_escrow(job)
        _notify(
            technician, "SERVICE_REQUEST_NO_SHOW", "You were removed from a job",
            "You did not start the job in time, so it went back to the job board.", job,
        )
        _notify(
            job.requester, "SERVICE_REQUEST_RELEASED", "Your technician did not show up",
            "Your request is back on the job board and any payment held for it was refunded.", job,
        )
        _alert_board_technicians(job, exclude=technician)
        released.append(job)
    return released


def release_unresponsive_technicians(*, max_hours: int = QUOTE_DEADLINE_HOURS, urgent_max_hours: int = URGENT_QUOTE_DEADLINE_HOURS, now=None) -> list:
    """Returns jobs to the board when the technician accepted but never sent a quote
    within max_hours (urgent_max_hours for urgent jobs). Meant to run on a schedule next
    to expire_stale_service_requests."""
    from datetime import timedelta
    from django.db.models import Q
    from django.utils import timezone
    from .models import ServiceRequestPriority
    now = now or timezone.now()
    urgent = Q(priority=ServiceRequestPriority.URGENT)
    overdue = ServiceRequest.objects.filter(
        status=ServiceRequestStatus.ACCEPTED, quoted_amount_xaf__isnull=True,
    ).filter(
        (urgent & Q(accepted_at__lt=now - timedelta(hours=urgent_max_hours)))
        | (~urgent & Q(accepted_at__lt=now - timedelta(hours=max_hours)))
    ).select_related("requester", "technician")
    released = []
    for job in overdue:
        technician = job.technician
        if technician is None or not _unassign_technician(job, statuses=[ServiceRequestStatus.ACCEPTED], technician=technician):
            continue
        hours = urgent_max_hours if job.priority == ServiceRequestPriority.URGENT else max_hours
        _notify(
            technician, "SERVICE_REQUEST_TIMEOUT", "You were removed from a job",
            f"You did not send a quote within {hours} hours, so the job went back to the board.", job,
        )
        _notify(
            job.requester, "SERVICE_REQUEST_RELEASED", "Your technician did not respond",
            "Your request is back on the job board for another technician.", job,
        )
        _alert_board_technicians(job, exclude=technician)
        released.append(job)
    return released


def mark_en_route(*, service_request: ServiceRequest, technician, latitude=None, longitude=None):
    from django.utils import timezone
    _assigned_technician_or_raise(service_request, technician)
    updated = ServiceRequest.objects.filter(
        pk=service_request.pk, technician=technician, status=ServiceRequestStatus.ACCEPTED,
    ).update(status=ServiceRequestStatus.EN_ROUTE, en_route_at=timezone.now())
    if not updated:
        raise ServiceRequestStateError("The job must be accepted (and not yet en route) first.")
    if latitude is not None and longitude is not None:
        submit_technician_location_ping(technician=technician, latitude=latitude, longitude=longitude)
    service_request.refresh_from_db()
    _notify(service_request.requester, "SERVICE_REQUEST_EN_ROUTE", "Your technician is on the way", "Open the request to follow their location.", service_request)
    return service_request


def start_service(service_request: ServiceRequest):
    from django.utils import timezone
    service_request.status = ServiceRequestStatus.IN_PROGRESS
    service_request.started_at = timezone.now()
    service_request.save(update_fields=["status", "started_at"])
    _notify(service_request.requester, "SERVICE_REQUEST_STARTED", "Work has started", "Your technician has started the job.", service_request)
    return service_request


def mark_work_done(*, service_request: ServiceRequest, technician):
    """The technician says the job is finished; the requester then has AUTO_RELEASE_HOURS
    to confirm or report a problem before the held payment is released automatically."""
    from django.utils import timezone
    _assigned_technician_or_raise(service_request, technician)
    if service_request.status != ServiceRequestStatus.IN_PROGRESS:
        raise ServiceRequestStateError("Only a job that is in progress can be marked as done.")
    if service_request.work_completed_at is not None:
        raise ServiceRequestStateError("You already told the requester this job is done.")
    service_request.work_completed_at = timezone.now()
    service_request.save(update_fields=["work_completed_at"])
    message = "Please confirm it is done to release the payment, or report a problem."
    if is_escrow_funded(service_request):
        message += f" If you do nothing, the payment is released automatically in {AUTO_RELEASE_HOURS} hours."
    _notify(service_request.requester, "SERVICE_REQUEST_WORK_DONE", "Your technician finished the job", message, service_request)
    return service_request


def auto_release_completed_jobs(*, max_hours: int = AUTO_RELEASE_HOURS, now=None) -> list:
    """Releases held payment for jobs the technician reported done that the requester never
    confirmed or disputed. Meant to run on a schedule with expire_stale_service_requests."""
    from datetime import timedelta
    from django.utils import timezone
    now = now or timezone.now()
    overdue = ServiceRequest.objects.filter(
        status=ServiceRequestStatus.IN_PROGRESS, work_completed_at__lt=now - timedelta(hours=max_hours),
    ).select_related("requester", "technician", "booking")
    released = []
    for job in overdue:
        if not is_escrow_funded(job):
            continue  # nothing held to release; legacy unpaid jobs still need the requester
        complete_service_request_with_payment(
            service_request=job, amount_xaf=job.quoted_amount_xaf, lock_client=None, payment_gateway=None, phone_number="",
        )
        _notify(
            job.requester, "SERVICE_REQUEST_AUTO_RELEASED", "Payment released to your technician",
            f"You did not respond within {max_hours} hours of the technician finishing, so the payment was released.", job,
        )
        released.append(job)
    return released


def propose_quote(*, service_request: ServiceRequest, technician, amount_xaf=None, labor_xaf=None, materials_xaf=None):
    from decimal import Decimal
    _assigned_technician_or_raise(service_request, technician)
    if service_request.status not in OPEN_JOB_STATUSES:
        raise ServiceRequestStateError("A quote can only be set on an active job.")
    if service_request.booking_id is not None:
        raise ServiceRequestStateError("The price is locked once the requester has paid into escrow.")
    if labor_xaf is not None:
        materials_xaf = materials_xaf or Decimal("0")
        amount_xaf = Decimal(labor_xaf) + Decimal(materials_xaf)
    if amount_xaf is None or Decimal(amount_xaf) <= 0:
        raise InvalidQuoteError("The quote must be greater than zero.")
    service_request.quoted_amount_xaf = amount_xaf
    service_request.quoted_labor_xaf = labor_xaf
    service_request.quoted_materials_xaf = materials_xaf if labor_xaf is not None else None
    service_request.quote_approved = False
    service_request.save(update_fields=["quoted_amount_xaf", "quoted_labor_xaf", "quoted_materials_xaf", "quote_approved"])
    _notify(service_request.requester, "SERVICE_REQUEST_QUOTE", "A quote is waiting for your approval", f"Proposed price: {amount_xaf} XAF.", service_request)
    return service_request


def approve_quote(*, service_request: ServiceRequest, requester):
    if service_request.requester_id != requester.id:
        raise NotPartyToServiceRequestError("Only the requester can approve the quote.")
    if service_request.quoted_amount_xaf is None:
        raise InvalidQuoteError("There is no quote to approve yet.")
    if service_request.status not in OPEN_JOB_STATUSES:
        raise ServiceRequestStateError("The quote can only be approved while the job is active.")
    service_request.quote_approved = True
    service_request.save(update_fields=["quote_approved"])
    if service_request.technician_id:
        _notify(service_request.technician, "SERVICE_REQUEST_QUOTE_APPROVED", "Your quote was approved", f"Agreed price: {service_request.quoted_amount_xaf} XAF.", service_request)
    return service_request


def reschedule_service_request(*, service_request: ServiceRequest, actor, scheduled_for):
    """Either party can move the date until work starts; the other party is told."""
    from django.utils import timezone
    if actor.id not in (service_request.requester_id, service_request.technician_id):
        raise NotPartyToServiceRequestError("Only the requester or the assigned technician can reschedule this job.")
    if service_request.status not in (ServiceRequestStatus.REQUESTED, ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE):
        raise ServiceRequestStateError("A job can only be rescheduled before work has started.")
    if actor.id != service_request.requester_id and service_request.status == ServiceRequestStatus.REQUESTED:
        raise NotPartyToServiceRequestError("Only the requester can reschedule an unaccepted job.")
    if scheduled_for <= timezone.now():
        raise ServiceRequestStateError("The new time must be in the future.")
    service_request.scheduled_for = scheduled_for
    service_request.save(update_fields=["scheduled_for"])
    other = service_request.technician if actor.id == service_request.requester_id else service_request.requester
    if other is not None:
        _notify(other, "SERVICE_REQUEST_RESCHEDULED", "The job time changed", f"New time: {scheduled_for:%Y-%m-%d %H:%M}.", service_request)
    return service_request


def post_service_request_message(*, service_request: ServiceRequest, sender, text: str):
    from .models import ServiceRequestMessage
    if sender.id not in (service_request.requester_id, service_request.technician_id):
        raise NotPartyToServiceRequestError("Only the requester or the assigned technician can chat on this job.")
    # After completion the payment is settled, so sharing contact details no longer skips the platform.
    if service_request.status != ServiceRequestStatus.COMPLETED and contains_contact_details(text):
        raise ContactSharingBlockedError(CONTACT_SHARING_MESSAGE)
    message = ServiceRequestMessage.objects.create(service_request=service_request, sender=sender, text=text)
    other = service_request.technician if sender.id == service_request.requester_id else service_request.requester
    if other is not None:
        _notify(other, "SERVICE_REQUEST_MESSAGE", f"New message from {sender.full_name or sender.username}", text[:100], service_request)
    return message


def dispute_service_request(*, service_request: ServiceRequest, actor, reason: str):
    if actor.id not in (service_request.requester_id, service_request.technician_id):
        raise NotPartyToServiceRequestError("Only the requester or the assigned technician can dispute this job.")
    if service_request.status not in OPEN_JOB_STATUSES:
        raise ServiceRequestStateError("Only an active job can be disputed.")
    service_request.status = ServiceRequestStatus.DISPUTED
    service_request.dispute_reason = reason
    # A resumed job needs a fresh "work done" signal, so the auto-release clock never carries over.
    service_request.work_completed_at = None
    service_request.save(update_fields=["status", "dispute_reason", "work_completed_at"])
    other = service_request.technician if actor.id == service_request.requester_id else service_request.requester
    if other is not None:
        _notify(other, "SERVICE_REQUEST_DISPUTED", "A job was disputed", "Support will review this job.", service_request)
    return service_request


def resolve_service_dispute(*, service_request: ServiceRequest, outcome: str, notes: str = ""):
    """Admin decision on a DISPUTED job. Disputes can only be raised while a
    job is active, i.e. before payment, so no money is held at this point."""
    from django.utils import timezone
    from .models import ServiceDisputeResolution
    if service_request.status != ServiceRequestStatus.DISPUTED:
        raise ServiceRequestStateError("Only a disputed job can be resolved.")
    if outcome not in ServiceDisputeResolution.values:
        raise ValueError("Unknown dispute outcome.")

    technician = service_request.technician
    fields = ["status", "dispute_resolution", "dispute_resolution_notes", "dispute_resolved_at"]
    if outcome == ServiceDisputeResolution.CANCEL:
        service_request.status = ServiceRequestStatus.CANCELLED
    elif outcome == ServiceDisputeResolution.REASSIGN or technician is None:
        service_request.status = ServiceRequestStatus.REQUESTED
        service_request.technician = None
        service_request.requested_technician = None
        service_request.accepted_at = None
        service_request.en_route_at = None
        service_request.started_at = None
        service_request.quoted_amount_xaf = None
        service_request.quoted_labor_xaf = None
        service_request.quoted_materials_xaf = None
        service_request.quote_approved = False
        fields += ["technician", "requested_technician", "accepted_at", "en_route_at", "started_at", "quoted_amount_xaf", "quoted_labor_xaf", "quoted_materials_xaf", "quote_approved"]
    else:
        service_request.status = (
            ServiceRequestStatus.IN_PROGRESS if service_request.started_at else ServiceRequestStatus.ACCEPTED
        )
    service_request.dispute_resolution = outcome
    service_request.dispute_resolution_notes = notes
    service_request.dispute_resolved_at = timezone.now()
    service_request.save(update_fields=fields)
    if outcome != ServiceDisputeResolution.RESUME or service_request.technician_id is None:
        _refund_held_escrow(service_request)
    if outcome == ServiceDisputeResolution.REASSIGN:
        if technician is not None:
            service_request.excluded_technicians.add(technician)
        _alert_board_technicians(service_request)

    messages = {
        ServiceDisputeResolution.RESUME: "Support reviewed the dispute and the job can continue.",
        ServiceDisputeResolution.REASSIGN: "Support reviewed the dispute and the job is back on the job board.",
        ServiceDisputeResolution.CANCEL: "Support reviewed the dispute and the job was cancelled.",
    }
    detail = f"{messages[outcome]} {notes}".strip()
    for party in {service_request.requester, technician}:
        if party is not None:
            _notify(party, "SERVICE_REQUEST_DISPUTE_RESOLVED", "Your job dispute was resolved", detail, service_request)
    return service_request


def _save_job_review(*, service_request: ServiceRequest, author, subject, score, comment: str, subject_is_requester: bool):
    from .models import ServiceReview
    review, created = ServiceReview.objects.update_or_create(
        service_request=service_request, author=author,
        defaults={"subject": subject, "subject_is_requester": subject_is_requester, "score": score, "comment": comment.strip()},
    )
    if created:
        # Reviews stay hidden until the other party has reviewed too, so neither side can retaliate.
        _notify(
            subject, "SERVICE_REQUEST_REVIEWED", "You received a review",
            "Leave your own review of this job to see what they wrote.", service_request,
        )
    return review


def rate_technician(*, service_request: ServiceRequest, requester, score, comment: str = ""):
    """Only the requester of a COMPLETED job can rate its technician, then
    TechnicianProfile.avg_rating is recomputed from every rating they hold."""
    from django.db.models import Avg
    from social.models import Rating
    from social.services import create_or_update_rating
    if service_request.requester_id != requester.id:
        raise NotPartyToServiceRequestError("Only the requester can rate this job's technician.")
    if service_request.status != ServiceRequestStatus.COMPLETED or service_request.technician_id is None:
        raise ServiceRequestStateError("You can rate the technician once the job is completed.")
    rating = create_or_update_rating(author=requester, score=score, subject_user=service_request.technician)
    profile = getattr(service_request.technician, "technician_profile", None)
    if profile is not None:
        average = Rating.objects.filter(subject_user=service_request.technician).aggregate(avg=Avg("score"))["avg"]
        profile.avg_rating = round(average or 0, 2)
        profile.save(update_fields=["avg_rating"])
    _save_job_review(
        service_request=service_request, author=requester, subject=service_request.technician,
        score=score, comment=comment, subject_is_requester=False,
    )
    return rating


def rate_requester(*, service_request: ServiceRequest, technician, score, comment: str = ""):
    """The assigned technician reviews the client after a COMPLETED job; shown to technicians
    on future jobs from that client so they can judge who they are working for."""
    _assigned_technician_or_raise(service_request, technician)
    if service_request.status != ServiceRequestStatus.COMPLETED:
        raise ServiceRequestStateError("You can review the client once the job is completed.")
    return _save_job_review(
        service_request=service_request, author=technician, subject=service_request.requester,
        score=score, comment=comment, subject_is_requester=True,
    )


def get_requester_reputation(user) -> dict:
    """Average score and count of technician reviews a client has received."""
    from django.db.models import Avg, Count
    from .models import ServiceReview
    stats = ServiceReview.objects.filter(subject=user, subject_is_requester=True).aggregate(avg=Avg("score"), count=Count("id"))
    return {"average": round(float(stats["avg"]), 2) if stats["avg"] is not None else None, "count": stats["count"]}


def cancel_service_request(*, service_request: ServiceRequest):
    """The real gap this closes: a requester had NO way to back out of a
    request before a technician accepted it — the ViewSet only ever
    exposed accept/start/complete, no cancel at all."""
    if service_request.status != ServiceRequestStatus.REQUESTED:
        raise ServiceRequestAlreadyAcceptedError(
            "This request can no longer be cancelled — a technician has already accepted it."
        )
    service_request.status = ServiceRequestStatus.CANCELLED
    service_request.save(update_fields=["status"])
    return service_request


def add_service_request_photo(*, service_request: ServiceRequest, actor, photo_type: str, file_url: str):
    """Real before/after job documentation — the model and read-only
    serializer already existed, but nothing ever let anyone actually
    attach one. Protects both sides: BEFORE proves the property's
    condition going in, AFTER proves the work was actually done.
    Restricted to the two real parties on the job, matching every
    other action on this ViewSet."""
    if actor.id not in (service_request.requester_id, service_request.technician_id):
        raise NotPartyToServiceRequestError("Only the requester or the assigned technician can add photos to this job.")
    return ServiceRequestPhoto.objects.create(service_request=service_request, photo_type=photo_type, file_url=file_url)


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

    if _held_escrow(service_request) is not None:
        # Already paid into escrow before work started: confirming the job releases that money.
        from django.utils import timezone
        from transactions.services import complete_booking
        booking = service_request.booking
        with db_transaction.atomic():
            service_request.status = ServiceRequestStatus.COMPLETED
            service_request.completed_at = timezone.now()
            service_request.save(update_fields=["status", "completed_at"])
        escrow = complete_booking(booking=booking)
        if service_request.technician_id:
            _notify(service_request.technician, "SERVICE_REQUEST_COMPLETED", "Job completed and paid", "Your payment has been released to your wallet.", service_request)
        return booking, escrow

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

    # WHY complete_booking() is called OUTSIDE the atomic block above,
    # and not booking.complete(): complete_booking() already opens its
    # own atomic transaction and releases the escrow — the earlier
    # version left the escrow HELD forever, so the technician was never
    # actually paid for a real completed job.
    from transactions.services import complete_booking
    escrow = complete_booking(booking=booking)

    if service_request.technician_id:
        _notify(service_request.technician, "SERVICE_REQUEST_COMPLETED", "Job completed and paid", "Your payment has been released to your wallet.", service_request)
    return booking, escrow


def expire_stale_service_requests(*, max_age_hours: int = 48, now=None) -> list:
    """Cancels jobs nobody accepted within max_age_hours, so they don't sit on
    the board forever. A job booked for a future date is left alone until that
    date has passed. Meant to run on a schedule (see the management command)."""
    from datetime import timedelta
    from django.db.models import Q
    from django.utils import timezone
    now = now or timezone.now()
    stale = ServiceRequest.objects.filter(
        status=ServiceRequestStatus.REQUESTED, requested_at__lt=now - timedelta(hours=max_age_hours),
    ).filter(Q(scheduled_for__isnull=True) | Q(scheduled_for__lt=now)).select_related("requester")
    expired = []
    for job in stale:
        updated = ServiceRequest.objects.filter(pk=job.pk, status=ServiceRequestStatus.REQUESTED).update(
            status=ServiceRequestStatus.CANCELLED,
        )
        if not updated:
            continue
        _notify(
            job.requester, "SERVICE_REQUEST_EXPIRED", "Your request expired",
            f"No technician accepted your {job.get_category_display()} request in time. You can post it again anytime.", job,
        )
        expired.append(job)
    return expired


class TechnicianReviewStateError(Exception):
    pass


def _notify_technician(profile, notification_type: str, title: str, message: str):
    from notifications.services import notify
    notify(
        recipient=profile.user, notification_type=notification_type, title=title,
        message=message, related_reference=str(profile.id),
    )


def verify_technician(profile):
    from django.utils import timezone
    if profile.is_verified:
        raise TechnicianReviewStateError("This technician is already verified.")
    profile.is_verified = True
    profile.rejection_reason = ""
    profile.reviewed_at = timezone.now()
    profile.save(update_fields=["is_verified", "rejection_reason", "reviewed_at"])
    _notify_technician(
        profile, "TECHNICIAN_VERIFIED", "You are now a verified technician",
        "You can now accept jobs on the Taskln job board.",
    )
    return profile


def reject_technician(profile, reason: str):
    """Turns down a pending application; it leaves the review queue until the
    technician uploads new documents."""
    from django.utils import timezone
    if profile.is_verified:
        raise TechnicianReviewStateError("This technician is already verified — revoke verification instead.")
    profile.rejection_reason = reason
    profile.reviewed_at = timezone.now()
    profile.save(update_fields=["rejection_reason", "reviewed_at"])
    _notify_technician(
        profile, "TECHNICIAN_REJECTED", "Your technician application needs changes",
        f"{reason} Update your documents and your application will be reviewed again.",
    )
    return profile


def revoke_technician(profile, reason: str) -> dict:
    """Takes verification away. Accepted-but-not-started jobs go back to the job
    board (refunding any held payment); jobs already underway are left for the
    parties and admins to resolve, and are only counted here."""
    from django.utils import timezone
    if not profile.is_verified:
        raise TechnicianReviewStateError("Only a verified technician can have verification revoked.")
    profile.is_verified = False
    profile.rejection_reason = reason
    profile.reviewed_at = timezone.now()
    profile.save(update_fields=["is_verified", "rejection_reason", "reviewed_at"])

    released = 0
    for job in ServiceRequest.objects.filter(
        technician=profile.user, status__in=[ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE],
    ):
        release_service_request(service_request=job, technician=profile.user)
        released += 1
    in_progress = ServiceRequest.objects.filter(technician=profile.user, status=ServiceRequestStatus.IN_PROGRESS).count()

    _notify_technician(
        profile, "TECHNICIAN_REVOKED", "Your technician verification was removed",
        f"{reason} You can no longer accept new jobs.",
    )
    return {"released_jobs": released, "in_progress_jobs": in_progress}


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


def get_technician_dashboard_summary(technician):
    """The Technician Dashboard: job dispatch ledger, earnings, and
    inspection history — all from real data, no cached numbers."""
    from django.db.models import Sum
    from .models import ServiceRequest, ServiceRequestStatus
    from monetization.services import get_or_create_wallet
    from monetization.models import WalletTransactionType

    active_jobs = ServiceRequest.objects.filter(
        technician=technician, status__in=[ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE, ServiceRequestStatus.IN_PROGRESS],
    )
    completed_jobs = ServiceRequest.objects.filter(technician=technician, status=ServiceRequestStatus.COMPLETED)

    wallet = get_or_create_wallet(technician)
    recent_earnings = wallet.transactions.filter(
        transaction_type__in=[WalletTransactionType.GIFT_PAYOUT],
    ).order_by("-created_at")[:10]

    from oaziland.analytics import compute_period_over_period
    all_jobs = ServiceRequest.objects.filter(technician=technician)
    jobs_trend = compute_period_over_period(queryset=all_jobs, date_field="requested_at")

    return {
        "active_job_count": active_jobs.count(),
        "active_jobs": list(active_jobs.values("id", "category", "priority", "status", "quoted_amount_xaf", "quote_approved")),
        "completed_job_count": completed_jobs.count(),
        "wallet_balance_xaf": wallet.balance_xaf,
        "recent_transaction_count": recent_earnings.count(),
        "jobs_trend": jobs_trend,
    }


# ---------------------------------------------------------------------------
# FacilityManagementContract — docs/01 §2.4: recurring facility-management
# arrangements between a property owner and a technician/agency.
# ---------------------------------------------------------------------------

def create_facility_contract(*, owner, target_content_type: str, target_id, scope: str, frequency: str, start_date, technician=None, agency=None):
    from .models import FacilityManagementContract
    return FacilityManagementContract.objects.create(
        owner=owner, target_content_type=target_content_type, target_id=target_id,
        scope=scope, frequency=frequency, start_date=start_date, technician=technician, agency=agency,
    )


def list_facility_contracts_for_user(user):
    """Everyone with a real stake in a contract can see it: the owner who
    commissioned it, the technician assigned to it, or (via the agency
    roster) any agent on the assigned agency. WHY the agency_id guard:
    a plain `Q(agency_id=agency_id)` with agency_id=None would match
    every contract with NO agency set at all (agency IS NULL), leaking
    unrelated contracts to any user without an agent profile."""
    from django.db.models import Q
    from .models import FacilityManagementContract
    agency_id = getattr(getattr(user, "agent_profile", None), "agency_id", None)
    query = Q(owner=user) | Q(technician=user)
    if agency_id is not None:
        query |= Q(agency_id=agency_id)
    return FacilityManagementContract.objects.filter(query).distinct().order_by("-created_at")


def log_facility_visit(*, contract, actor, notes: str = "", photo_url: str = ""):
    """The 'routine inspection logs' capability — restricted to the
    contract's own owner or assigned technician, matching the actor
    restriction already used on ServiceRequest photos."""
    from .models import FacilityVisitLog
    if actor.id not in (contract.owner_id, contract.technician_id):
        raise NotAuthorizedForFacilityContractError("Only this contract's owner or assigned technician can log a visit.")
    return FacilityVisitLog.objects.create(contract=contract, logged_by=actor, notes=notes, photo_url=photo_url)


# ---------------------------------------------------------------------------
# ProjectManagementCase — docs/01 §2.4: larger jobs (renovations, new
# builds) with milestones, budget, and linked technicians.
# ---------------------------------------------------------------------------

def create_project_case(*, owner, title: str, description: str, budget_xaf, target_content_type: str = "", target_id=None):
    from .models import ProjectManagementCase
    return ProjectManagementCase.objects.create(
        owner=owner, title=title, description=description, budget_xaf=budget_xaf,
        target_content_type=target_content_type, target_id=target_id,
    )


def list_project_cases_for_user(user):
    from django.db.models import Q
    from .models import ProjectManagementCase
    return ProjectManagementCase.objects.filter(Q(owner=user) | Q(technicians=user)).distinct().order_by("-created_at")


def link_technician_to_project(*, case, actor, technician):
    if actor.id != case.owner_id:
        raise NotAuthorizedForProjectCaseError("Only this project's owner can link a technician.")
    case.technicians.add(technician)
    return case


def add_project_milestone(*, case, actor, title: str, budget_allocation_xaf, due_date=None):
    from .models import ProjectMilestone
    if actor.id != case.owner_id:
        raise NotAuthorizedForProjectCaseError("Only this project's owner can add a milestone.")
    return ProjectMilestone.objects.create(case=case, title=title, budget_allocation_xaf=budget_allocation_xaf, due_date=due_date)


def complete_project_milestone(*, milestone, actor):
    """Either the project's owner or any technician linked to it can mark
    a milestone done — whoever actually finished the work reports it."""
    from django.utils import timezone
    from .models import ProjectMilestoneStatus
    case = milestone.case
    if actor.id != case.owner_id and not case.technicians.filter(id=actor.id).exists():
        raise NotAuthorizedForProjectCaseError("Only this project's owner or an assigned technician can complete a milestone.")
    milestone.status = ProjectMilestoneStatus.COMPLETED
    milestone.completed_at = timezone.now()
    milestone.save(update_fields=["status", "completed_at"])
    return milestone
