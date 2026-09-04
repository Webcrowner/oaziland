"""
agency.services — the actual business logic: commission splitting, agent
performance scoring, and agency roster management.

WHY this is code and not just documentation of a policy: "agents earn
commission, agencies take a cut" means nothing to a computer until
something actually computes the numbers, the same way, every time. This
file is that one place.
"""
from decimal import Decimal


def calculate_commission_split(*, gross_amount_xaf: Decimal, agent):
    """The core commission rule from the Architecture: a booking made
    directly with a landlord (agent is None) produces NO commission at
    all — this function returns None in that case, and callers must NOT
    create a Commission row with zero values instead. A booking closed by
    an agent splits between the agent and, if the agent belongs to an
    agency, the agency too.

    Returns a dict {total, agent_share, agency_share} or None.
    """
    if agent is None:
        return None  # direct landlord deal — genuinely no commission, not a zero one

    agent_profile = agent.agent_profile  # raises if this user isn't actually an agent — intentional
    total = gross_amount_xaf * (agent_profile.agent_commission_percent / Decimal("100"))

    if agent_profile.agency is not None:
        agency_cut_percent = agent_profile.agency.agency_commission_percent
        agency_share = total * (agency_cut_percent / Decimal("100"))
        agent_share = total - agency_share
    else:
        agency_share = Decimal("0")
        agent_share = total

    return {"total": total, "agent_share": agent_share, "agency_share": agency_share}


def create_commission_for_booking(*, booking, agent=None):
    """Creates the Commission row for a completed booking, using
    calculate_commission_split above. If agent is None, deliberately
    creates NOTHING — this is what the acceptance criteria means by
    'a test deal made directly with a landlord must show ZERO commission
    generated', not a Commission row full of zeros."""
    from transactions.models import Commission

    split = calculate_commission_split(gross_amount_xaf=booking.amount_xaf, agent=agent)
    if split is None:
        return None

    return Commission.objects.create(
        booking=booking,
        total_amount_xaf=split["total"],
        agent_share_xaf=split["agent_share"],
        agency_share_xaf=split["agency_share"],
        paid_to_landlord=False,
    )


def agent_performance_score(agent):
    """Average response time, percentage of verified-document listings,
    and completed deal count — the three metrics Prompt 6 specifies for
    a public agent profile page."""
    from django.db.models import Avg, F
    from agency.models import Enquiry
    from property.models import Listing, VerificationBadge, BadgeStatus
    from transactions.models import Booking, BookingStatus

    # --- Average response time ---
    answered = Enquiry.objects.filter(agent=agent, first_response_at__isnull=False)
    avg_seconds = answered.annotate(
        delta=F("first_response_at") - F("created_at")
    ).aggregate(avg=Avg("delta"))["avg"]
    avg_response_minutes = round(avg_seconds.total_seconds() / 60, 1) if avg_seconds else None

    # --- Percentage of this agent's listings with a verified document badge ---
    agent_listings = Listing.objects.filter(listed_by=agent)
    total_listings = agent_listings.count()
    if total_listings > 0:
        verified_count = 0
        for listing in agent_listings:
            has_verified_badge = VerificationBadge.objects.filter(
                property_asset=listing.property_asset, status=BadgeStatus.VERIFIED,
            ).exists()
            if has_verified_badge:
                verified_count += 1
        percent_verified = round((verified_count / total_listings) * 100, 1)
    else:
        percent_verified = None

    # --- Completed deals ---
    listing_ids = list(agent_listings.values_list("id", flat=True))
    completed_deals = Booking.objects.filter(
        target_content_type="property.Listing", target_id__in=listing_ids,
        status=BookingStatus.COMPLETED,
    ).count()

    return {
        "avg_response_time_minutes": avg_response_minutes,
        "percent_listings_verified": percent_verified,
        "completed_deals_count": completed_deals,
    }


# --- Agency roster management ---

def add_agent_to_agency(*, agent, agency):
    """Assigns an agent to an agency's roster."""
    agent_profile = agent.agent_profile
    agent_profile.agency = agency
    agent_profile.save(update_fields=["agency"])
    return agent_profile


def remove_agent_from_agency(*, agent):
    """Makes an agent independent again — does NOT delete the agent's
    account or their past commission history, only the current
    affiliation going forward."""
    agent_profile = agent.agent_profile
    agent_profile.agency = None
    agent_profile.save(update_fields=["agency"])
    return agent_profile


def agency_roster(agency):
    """Every agent currently under this agency."""
    return agency.agents.all()


def agency_aggregated_commission(agency):
    """Total commission this agency has earned across every one of its
    agents' deals — summed from the real Commission records, not
    recomputed from scratch, so it always matches what was actually paid."""
    from django.db.models import Sum
    from transactions.models import Commission

    agent_ids = list(agency.agents.values_list("user_id", flat=True))
    agent_listing_ids = _listing_ids_for_agents(agent_ids)

    total = Commission.objects.filter(
        booking__target_content_type="property.Listing",
        booking__target_id__in=agent_listing_ids,
    ).aggregate(total=Sum("agency_share_xaf"))["total"]

    return total or Decimal("0")


def _listing_ids_for_agents(agent_user_ids):
    from property.models import Listing
    return list(Listing.objects.filter(listed_by_id__in=agent_user_ids).values_list("id", flat=True))


def schedule_showing(*, agent, client, listing_id, scheduled_at):
    from .models import ShowingAppointment
    return ShowingAppointment.objects.create(agent=agent, client=client, listing_id=listing_id, scheduled_at=scheduled_at)


def complete_showing(appointment):
    from .models import ShowingAppointmentStatus
    appointment.status = ShowingAppointmentStatus.COMPLETED
    appointment.save(update_fields=["status"])
    return appointment


def cancel_showing(appointment):
    from .models import ShowingAppointmentStatus
    appointment.status = ShowingAppointmentStatus.CANCELLED
    appointment.save(update_fields=["status"])
    return appointment
