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


# ---------------------------------------------------------------------------
# Public agent/agency profile and private dashboard — the founder's own
# professional space as an agent+agency owner, and every other agent/
# agency's equivalent.
# ---------------------------------------------------------------------------
def get_agent_public_profile(agent_user):
    """Real aggregated data for a PUBLIC-facing agent page — anyone
    should be able to see this without logging in, the same as
    browsing a listing."""
    from django.db.models import Avg
    from property.models import Listing, ListingStatus
    from social.models import Rating

    active_listings = Listing.objects.filter(listed_by=agent_user, status=ListingStatus.PUBLISHED)
    ratings = Rating.objects.filter(subject_user=agent_user)
    average_rating = ratings.aggregate(avg=Avg("score"))["avg"]

    is_kyc_verified = hasattr(agent_user, "kyc_profile") and agent_user.kyc_profile.kyc_status == "VERIFIED"

    return {
        "full_name": agent_user.full_name or agent_user.username,
        "is_kyc_verified": is_kyc_verified,
        "average_rating": round(average_rating, 2) if average_rating else None,
        "rating_count": ratings.count(),
        "active_listing_count": active_listings.count(),
        "agency_name": agent_user.agent_profile.agency.user.full_name if hasattr(agent_user, "agent_profile") and agent_user.agent_profile.agency else None,
    }


def get_agency_public_profile(agency):
    """Same idea, for the agency itself — aggregates across every
    agent on its roster."""
    from django.db.models import Avg
    from property.models import Listing, ListingStatus
    from social.models import Rating

    roster_user_ids = list(agency.agents.values_list("user_id", flat=True))
    active_listings = Listing.objects.filter(listed_by_id__in=roster_user_ids, status=ListingStatus.PUBLISHED)
    ratings = Rating.objects.filter(subject_user_id__in=roster_user_ids)
    average_rating = ratings.aggregate(avg=Avg("score"))["avg"]

    return {
        "agency_name": agency.user.full_name or agency.user.username,
        "registration_number": agency.registration_number,
        "agent_count": agency.agents.count(),
        "average_rating": round(average_rating, 2) if average_rating else None,
        "rating_count": ratings.count(),
        "active_listing_count": active_listings.count(),
    }


def get_agent_private_dashboard(agent_user):
    """The PRIVATE, logged-in-only view — real leads, commission, and
    performance data, reusing the EXISTING agent_performance_score()
    and agency_roster()/agency_aggregated_commission() rather than
    rebuilding a second reporting layer.

    WHY commission lookup goes through Listing.listed_by rather than a
    direct Commission.agent field: Commission only has a OneToOneField
    to Booking, and Booking's target is a generic (content_type, id)
    reference, not a real FK — there's no direct 'this commission
    belongs to this agent' column to filter on. The correct join is
    Booking → its target Listing → listed_by."""
    from .models import Enquiry
    from property.models import Listing
    from transactions.models import Commission

    performance = agent_performance_score(agent_user)
    open_enquiries = Enquiry.objects.filter(agent=agent_user, first_response_at__isnull=True).count()

    agent_listing_ids = list(Listing.objects.filter(listed_by=agent_user).values_list("id", flat=True))
    agent_commissions = Commission.objects.filter(
        booking__target_content_type="property.Listing", booking__target_id__in=agent_listing_ids,
    )
    total_commission_earned = agent_commissions.count()

    from oaziland.analytics import compute_period_over_period
    commission_trend = compute_period_over_period(queryset=agent_commissions, date_field="created_at", aggregate_field="agent_share_xaf")

    dashboard = {
        "performance_score": performance,
        "open_enquiries": open_enquiries,
        "commission_trend_xaf": commission_trend,
        "total_completed_deals_with_commission": total_commission_earned,
    }

    if hasattr(agent_user, "agency_profile"):
        agency = agent_user.agency_profile
        dashboard["is_agency_owner"] = True
        dashboard["agency_roster"] = list(agency_roster(agency).values("user__username"))
        dashboard["agency_aggregated_commission_xaf"] = agency_aggregated_commission(agency)
    else:
        dashboard["is_agency_owner"] = False

    return dashboard


def resolve_caller_agency(user):
    """Which agency (if any) this user is authorized to see team data
    for — either because they own it, or because they're an agent on
    its roster. Server-side only; the frontend never gets to say which
    agency it wants to see."""
    if hasattr(user, "agency_profile"):
        return user.agency_profile
    if hasattr(user, "agent_profile") and user.agent_profile.agency is not None:
        return user.agent_profile.agency
    return None


def get_agency_private_dashboard(agency):
    """The PRIVATE, logged-in-only TEAM view for an agency — every
    authorized member (the owner, or any agent on its roster) sees the
    same real, aggregated picture: real team listings, real open
    leads, and real commission earned across every agent under this
    agency. This previously only existed bolted onto the founder's own
    agent dashboard (is_agency_owner branch) — team members who are
    agents but not the owner had no way to see it at all."""
    from agency.models import Enquiry
    from property.models import Listing, ListingStatus
    from transactions.models import Commission
    from oaziland.analytics import compute_period_over_period

    roster = list(agency_roster(agency).select_related("user"))
    roster_user_ids = [ap.user_id for ap in roster]

    team_listing_ids = _listing_ids_for_agents(roster_user_ids)
    active_team_listings = Listing.objects.filter(id__in=team_listing_ids, status=ListingStatus.PUBLISHED).count()
    open_team_leads = Enquiry.objects.filter(agent_id__in=roster_user_ids, first_response_at__isnull=True).count()

    team_commissions = Commission.objects.filter(
        booking__target_content_type="property.Listing", booking__target_id__in=team_listing_ids,
    )
    commission_trend = compute_period_over_period(
        queryset=team_commissions, date_field="created_at", aggregate_field="agency_share_xaf"
    )

    team = []
    for agent_profile in roster:
        agent_user = agent_profile.user
        agent_listing_ids = _listing_ids_for_agents([agent_user.id])
        team.append({
            "user_id": str(agent_user.id),
            "full_name": agent_user.full_name or agent_user.username,
            "active_listing_count": Listing.objects.filter(id__in=agent_listing_ids, status=ListingStatus.PUBLISHED).count(),
            "open_enquiries": Enquiry.objects.filter(agent=agent_user, first_response_at__isnull=True).count(),
        })

    return {
        "agency_profile": get_agency_public_profile(agency),
        "team": team,
        "team_size": len(team),
        "active_team_listings": active_team_listings,
        "open_team_leads": open_team_leads,
        "agency_aggregated_commission_xaf": agency_aggregated_commission(agency),
        "commission_trend_xaf": commission_trend,
    }
