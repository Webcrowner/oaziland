"""
guest_houses.ota_connectors — the OTAConnector interface, same pattern
as every other swappable external-provider abstraction in this
codebase (PaymentGateway, NotificationDispatcher, VisualSearchProvider).
"""
from abc import ABC, abstractmethod


class OTAConnector(ABC):
    @abstractmethod
    def push_availability(self, *, external_listing_id: str, blocked_dates: list) -> bool:
        raise NotImplementedError


class SandboxOTAConnector(OTAConnector):
    """A working stand-in — always succeeds, no real network call."""
    def push_availability(self, *, external_listing_id: str, blocked_dates: list) -> bool:
        return True


class BookingComConnector(OTAConnector):
    """NOT YET CONNECTED — needs real Booking.com Connectivity API partner credentials."""
    def push_availability(self, *, external_listing_id: str, blocked_dates: list) -> bool:
        raise NotImplementedError("Booking.com integration not yet built — requires partner API credentials.")


class AirbnbConnector(OTAConnector):
    """NOT YET CONNECTED — needs real Airbnb API partner credentials."""
    def push_availability(self, *, external_listing_id: str, blocked_dates: list) -> bool:
        raise NotImplementedError("Airbnb integration not yet built — requires partner API credentials.")


def get_active_ota_connector(channel: str) -> OTAConnector:
    """Every channel maps to the sandbox for now — same 'flag, don't
    fake' pattern as get_active_gateway()/get_active_dispatcher()."""
    return SandboxOTAConnector()
