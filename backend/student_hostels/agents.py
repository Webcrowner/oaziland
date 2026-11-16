"""
student_hostels.agents — who runs a hostel besides its owner.

An agent can list a hostel for its landlord, the way agents list property for owners: the landlord stays the
owner (and the one paid for every booking: escrow pays the owner) and the agent gets a FULL management
contract. A landlord can also give anyone (a caretaker, relative, staff member or agent) access to run their
hostel, with full management or bookings only, and remove it at any time. People given access are notified.
"""
from django.db import transaction
from django.utils import timezone

from .models import (
    HostelManagementContract, ManagementScope, ManagerProfile, ManagerType, OwnerProfile, OwnerType,
)


class AgentListingError(Exception):
    pass


def agent_profile_of(user):
    return getattr(user, "agent_profile", None)


def find_landlord(identifier: str):
    from .management import find_student  # the same phone-or-username lookup
    return find_student(identifier)


def list_hostel_for_landlord(*, agent, landlord_identifier: str, quarter, property_type: str, name: str = "",
                             latitude=None, longitude=None):
    from .services import create_student_hostel

    agent_profile = agent_profile_of(agent)
    if agent_profile is None:
        raise AgentListingError("Only registered agents can list a hostel for a landlord.")
    landlord = find_landlord(landlord_identifier)
    if landlord is None:
        raise AgentListingError(
            "No Oaziland account has that phone number or username. Ask the landlord to create an account first: "
            "they are the one paid for bookings."
        )
    if landlord.pk == agent.pk:
        raise AgentListingError("To list your own hostel, leave the landlord field empty.")

    with transaction.atomic():
        owner_profile, _ = OwnerProfile.objects.get_or_create(account_user=landlord, defaults={"owner_type": OwnerType.LANDLORD})
        hostel = create_student_hostel(
            owner_profile=owner_profile, quarter=quarter, property_type=property_type, latitude=latitude, longitude=longitude,
        )
        hostel.name = name
        hostel.listed_by = agent
        hostel.save(update_fields=["name", "listed_by"])
        manager_type = ManagerType.AGENCY if agent_profile.agency_id else ManagerType.AGENT
        manager, _ = ManagerProfile.objects.get_or_create(
            account_user=agent, manager_type=manager_type, defaults={"agency_id": agent_profile.agency_id},
        )
        HostelManagementContract.objects.create(
            hostel=hostel, manager=manager, scope=ManagementScope.FULL, start_date=timezone.localdate(),
            commission_or_fee_terms="Listed by the agent on the landlord's behalf.",
        )

    from notifications.services import notify
    agent_name = agent.full_name or agent.username
    label = hostel.name or f"your hostel in {quarter.name}"
    notify(
        recipient=landlord, notification_type="HOSTEL_LISTED_FOR_YOU", title="An agent listed your hostel",
        message=(
            f"{agent_name} listed {label} on Oaziland for you. You are the owner and every booking is paid to you. "
            "The agent can manage its rooms; you can remove their access at any time from Hostel rooms."
        ),
        related_reference=str(hostel.pk),
    )
    return hostel


def active_contracts(hostel):
    from django.db.models import Q
    today = timezone.localdate()
    return hostel.management_contracts.filter(revoked_at__isnull=True).filter(
        Q(end_date__isnull=True) | Q(end_date__gte=today),
    ).select_related("manager__account_user")


def managers_for_board(hostel, viewer) -> list[dict]:
    is_owner = viewer is not None and viewer.pk == hostel.owner_id
    rows = []
    for contract in active_contracts(hostel):
        user = contract.manager.account_user
        rows.append({
            "contract": str(contract.pk), "name": user.full_name or user.username, "username": user.username,
            "manager_type": contract.manager.manager_type, "scope": contract.scope, "since": contract.start_date,
            "can_revoke": is_owner,
        })
    return rows


def assign_manager(hostel, *, by, identifier: str, scope: str = ManagementScope.FULL):
    """The owner gives someone (a caretaker, relative, staff member or agent) access to run this hostel."""
    from .management import find_student

    if by.pk != hostel.owner_id:
        raise AgentListingError("Only the hostel's owner can add a manager.")
    if scope not in (ManagementScope.FULL, ManagementScope.BOOKINGS_ONLY):
        raise AgentListingError("Choose full management or bookings only.")
    user = find_student(identifier)
    if user is None:
        raise AgentListingError("No Oaziland account has that phone number or username. Ask them to create an account first.")
    if user.pk == hostel.owner_id:
        raise AgentListingError("You already manage your own hostel.")
    if active_contracts(hostel).filter(manager__account_user=user).exists():
        raise AgentListingError("This person already manages this hostel.")

    agent_profile = agent_profile_of(user)
    if agent_profile is None:
        manager_type = ManagerType.STAFF
    else:
        manager_type = ManagerType.AGENCY if agent_profile.agency_id else ManagerType.AGENT
    with transaction.atomic():
        manager, _ = ManagerProfile.objects.get_or_create(
            account_user=user, manager_type=manager_type,
            defaults={"agency_id": agent_profile.agency_id if agent_profile else None},
        )
        contract = HostelManagementContract.objects.create(
            hostel=hostel, manager=manager, scope=scope, start_date=timezone.localdate(),
            commission_or_fee_terms="Added by the owner.",
        )

    from notifications.services import notify
    owner_name = by.full_name or by.username
    notify(
        recipient=user, notification_type="HOSTEL_ACCESS_GRANTED", title="You can now manage a hostel",
        message=(
            f"{owner_name} gave you access to manage {hostel.name or 'their hostel'} on Oaziland "
            f"({'full management' if scope == ManagementScope.FULL else 'bookings only'}). Open Hostel rooms to start."
        ),
        related_reference=str(hostel.pk),
    )
    return contract


def revoke_manager(hostel, *, by, contract_id):
    """Only the owner removes a manager (an agent can't remove another, or keep themselves in)."""
    if by.pk != hostel.owner_id:
        raise AgentListingError("Only the hostel's owner can remove a manager.")
    contract = active_contracts(hostel).filter(pk=contract_id).first()
    if contract is None:
        raise AgentListingError("That manager no longer has access to this hostel.")
    contract.revoke(reason="Removed by the owner.")
    from notifications.services import notify
    notify(
        recipient=contract.manager.account_user, notification_type="HOSTEL_ACCESS_REMOVED", title="Hostel access removed",
        message=f"The owner of {hostel.name or 'a hostel you managed'} removed your access to it.",
        related_reference=str(hostel.pk),
    )
    return contract
