"""
property_management.services — the business logic behind maintenance
cost tracking, lease renewal reminders, consent-gated tenant screening,
agent safety check-ins (including real overdue-alert detection), and
dispute SLA enforcement.
"""
from datetime import timedelta
from decimal import Decimal


class ConsentRequiredError(Exception):
    pass


class CheckInAlreadyClosedError(Exception):
    pass


def add_maintenance_cost(*, request, amount_xaf: Decimal, note: str = ""):
    from .models import MaintenanceCostEntry
    entry = MaintenanceCostEntry.objects.create(request=request, amount_xaf=amount_xaf, note=note)
    total = sum((e.amount_xaf for e in request.cost_entries.all()), Decimal("0"))
    request.cost_estimate_xaf = total
    request.save(update_fields=["cost_estimate_xaf"])
    return entry


REMINDER_MILESTONES = [60, 30, 7]


def schedule_renewal_reminders(lease):
    from .models import LeaseRenewalReminder
    return [
        LeaseRenewalReminder.objects.get_or_create(lease=lease, days_before_end=days)[0]
        for days in REMINDER_MILESTONES
    ]


def send_due_renewal_reminders(today=None):
    from django.utils import timezone
    from notifications.services import notify
    from .models import LeaseRenewalReminder

    today = today or timezone.now().date()
    sent = []
    for reminder in LeaseRenewalReminder.objects.filter(sent_at__isnull=True):
        trigger_date = reminder.lease.end_date - timedelta(days=reminder.days_before_end)
        if today >= trigger_date:
            notify(
                recipient=reminder.lease.booking.requester,
                notification_type="LEASE_RENEWAL_REMINDER",
                title="Your lease is ending soon",
                message=f"Your lease ends on {reminder.lease.end_date} ({reminder.days_before_end} days notice).",
                related_reference=str(reminder.lease.id),
            )
            reminder.sent_at = timezone.now()
            reminder.save(update_fields=["sent_at"])
            sent.append(reminder)
    return sent


def request_tenant_screening(*, landlord, prospective_tenant):
    from .models import TenantScreeningRequest
    return TenantScreeningRequest.objects.create(landlord=landlord, prospective_tenant=prospective_tenant)


def tenant_grants_consent(*, screening_request, tenant):
    from django.utils import timezone
    from .models import TenantScreeningStatus

    if tenant.id != screening_request.prospective_tenant_id:
        raise PermissionError("Only the tenant being screened can grant consent.")
    screening_request.status = TenantScreeningStatus.CONSENTED
    screening_request.consented_at = timezone.now()
    screening_request.save(update_fields=["status", "consented_at"])
    return screening_request


def generate_screening_report(screening_request):
    from django.db.models import Avg
    from .models import TenantScreeningStatus
    from transactions.models import Booking, BookingStatus
    from social.models import Review
    from trust_safety.models import UserWarning

    if screening_request.status != TenantScreeningStatus.CONSENTED:
        raise ConsentRequiredError("Cannot generate a screening report without tenant consent.")

    tenant = screening_request.prospective_tenant
    completed_bookings = Booking.objects.filter(requester=tenant, status=BookingStatus.COMPLETED).count()
    reviews = Review.objects.filter(booking__requester=tenant)
    avg_review_score = reviews.aggregate(avg=Avg("score"))["avg"]
    warning_count = UserWarning.objects.filter(subject=tenant).count()

    summary = {
        "completed_bookings": completed_bookings,
        "average_review_score": float(avg_review_score) if avg_review_score else None,
        "warning_count": warning_count,
    }

    screening_request.report_summary = summary
    screening_request.status = TenantScreeningStatus.COMPLETED
    screening_request.save(update_fields=["report_summary", "status"])
    return summary


def start_safety_check_in(*, agent, property_asset, emergency_contact_name, emergency_contact_phone, expected_duration_minutes):
    from django.utils import timezone
    from .models import AgentSafetyCheckIn

    return AgentSafetyCheckIn.objects.create(
        agent=agent, property_asset=property_asset,
        emergency_contact_name=emergency_contact_name, emergency_contact_phone=emergency_contact_phone,
        expected_checkout_at=timezone.now() + timedelta(minutes=expected_duration_minutes),
    )


def check_out_safely(check_in):
    from django.utils import timezone
    from .models import CheckInStatus

    if check_in.status != CheckInStatus.ACTIVE:
        raise CheckInAlreadyClosedError("This check-in has already been closed.")
    check_in.checked_out_at = timezone.now()
    check_in.status = CheckInStatus.CHECKED_OUT
    check_in.save(update_fields=["checked_out_at", "status"])
    return check_in


def process_overdue_check_ins(now=None):
    from django.utils import timezone
    from identity.models import AdminProfile
    from notifications.services import notify
    from .models import AgentSafetyCheckIn, CheckInStatus

    now = now or timezone.now()
    overdue = AgentSafetyCheckIn.objects.filter(status=CheckInStatus.ACTIVE, expected_checkout_at__lt=now)

    alerted = []
    for check_in in overdue:
        notify(
            external_phone_number=check_in.emergency_contact_phone,
            notification_type="AGENT_SAFETY_ALERT",
            title="Safety check-in overdue",
            message=f"{check_in.agent.full_name or check_in.agent.username} has not checked out from a property visit as expected.",
            channel="SMS",
            related_reference=str(check_in.id),
        )
        for admin_profile in AdminProfile.objects.select_related("user").all():
            notify(
                recipient=admin_profile.user,
                notification_type="AGENT_SAFETY_ALERT",
                title="Agent safety check-in overdue",
                message=f"Agent {check_in.agent.username} is overdue on a solo property visit.",
                related_reference=str(check_in.id),
            )
        check_in.status = CheckInStatus.ALERT_TRIGGERED
        check_in.save(update_fields=["status"])
        alerted.append(check_in)
    return alerted


DISPUTE_RESPONSE_SLA_HOURS = 48
DISPUTE_RESOLUTION_SLA_DAYS = 7


def open_dispute(*, escrow, raised_by, reason: str):
    from django.utils import timezone
    from transactions.models import EscrowStatus
    from .models import DisputeCase

    now = timezone.now()
    escrow.status = EscrowStatus.DISPUTED
    escrow.save(update_fields=["status"])

    return DisputeCase.objects.create(
        escrow=escrow, raised_by=raised_by, reason=reason, created_at=now,
        response_due_at=now + timedelta(hours=DISPUTE_RESPONSE_SLA_HOURS),
        resolution_due_at=now + timedelta(days=DISPUTE_RESOLUTION_SLA_DAYS),
    )


def admin_respond_to_dispute(dispute):
    from django.utils import timezone
    from .models import DisputeStatus
    dispute.status = DisputeStatus.ADMIN_RESPONDED
    dispute.admin_responded_at = timezone.now()
    dispute.save(update_fields=["status", "admin_responded_at"])
    return dispute


def resolve_dispute(*, dispute, outcome: str, notes: str = ""):
    from django.utils import timezone
    from .models import DisputeStatus

    if outcome == "RELEASE":
        dispute.escrow.release()
    elif outcome == "REFUND":
        dispute.escrow.refund()
    else:
        raise ValueError("outcome must be 'RELEASE' or 'REFUND'")

    dispute.status = DisputeStatus.RESOLVED
    dispute.resolved_at = timezone.now()
    dispute.resolution_notes = notes
    dispute.save(update_fields=["status", "resolved_at", "resolution_notes"])
    return dispute
