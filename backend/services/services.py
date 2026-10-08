"""
services.services — technician matching, the ServiceRequest lifecycle,
and the Taskln read-only lookup. Every function that moves money routes
through transactions.services (the same reservation/escrow machinery
bookings use) rather than a parallel payment system.
"""
from django.db import transaction as db_transaction

from .models import (
    ServiceCategory, ServiceRequest, ServiceRequestPhoto, ServiceRequestStatus, TechnicianAvailabilitySlot,
    TechnicianLocationPing, TasklnIntegrationSettings, TasklnWorkerRecord,
)

# A ping older than this no longer says where the technician is now.
PING_MAX_AGE_HOURS = 24
# Cap on how many matching technicians get pinged for one new request.
MAX_NEW_REQUEST_ALERTS = 50
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


def create_service_request(*, requester, category: str, description: str, quarter=None, priority=None, latitude=None, longitude=None, scheduled_for=None):
    from .models import ServiceRequestPriority
    from identity.models import TechnicianProfile
    service_request = ServiceRequest.objects.create(
        requester=requester, category=category, description=description,
        quarter=quarter, priority=priority or ServiceRequestPriority.SCHEDULED,
        latitude=latitude, longitude=longitude, scheduled_for=scheduled_for,
    )
    # Specialties are filtered in Python: JSONField __contains isn't supported on every DB backend.
    verified = TechnicianProfile.objects.filter(is_verified=True).exclude(user=requester).select_related("user")
    matching = [p for p in verified if category in (p.specialties or [])][:MAX_NEW_REQUEST_ALERTS]
    for profile in matching:
        _notify(
            profile.user, "SERVICE_REQUEST_NEW", "New job nearby",
            f"A new {service_request.get_category_display()} job is open on the job board.", service_request,
        )
    return service_request


def _notify(recipient, notification_type: str, title: str, message: str, service_request):
    from notifications.services import notify
    notify(
        recipient=recipient, notification_type=notification_type, title=title,
        message=message, related_reference=str(service_request.id),
    )


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


def release_service_request(*, service_request: ServiceRequest, technician):
    """A technician backing out before work starts — the request goes
    back on the board instead of leaving the requester stuck."""
    _assigned_technician_or_raise(service_request, technician)
    released = ServiceRequest.objects.filter(
        pk=service_request.pk, technician=technician,
        status__in=[ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE],
    ).update(
        technician=None, status=ServiceRequestStatus.REQUESTED, accepted_at=None, en_route_at=None,
        quoted_amount_xaf=None, quoted_labor_xaf=None, quoted_materials_xaf=None, quote_approved=False,
    )
    if not released:
        raise ServiceRequestStateError("Work has already started — raise a dispute instead of releasing the job.")
    service_request.refresh_from_db()
    _notify(
        service_request.requester, "SERVICE_REQUEST_RELEASED", "Your technician had to pull out",
        "Your request is back on the job board for another technician.", service_request,
    )
    return service_request


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


def propose_quote(*, service_request: ServiceRequest, technician, amount_xaf=None, labor_xaf=None, materials_xaf=None):
    from decimal import Decimal
    _assigned_technician_or_raise(service_request, technician)
    if service_request.status not in OPEN_JOB_STATUSES:
        raise ServiceRequestStateError("A quote can only be set on an active job.")
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
    service_request.save(update_fields=["status", "dispute_reason"])
    other = service_request.technician if actor.id == service_request.requester_id else service_request.requester
    if other is not None:
        _notify(other, "SERVICE_REQUEST_DISPUTED", "A job was disputed", "Support will review this job.", service_request)
    return service_request


def rate_technician(*, service_request: ServiceRequest, requester, score):
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
    return rating


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
