from decimal import Decimal

import pytest

from geo.routing import Route


class FakeRoad:
    """Stands in for Google in ride tests: every route is `km` long by road (5 km unless a test changes it)."""

    def __init__(self):
        self.km = Decimal("5")
        self.calls = []

    def __call__(self, origin, destination):
        self.calls.append((origin, destination))
        return Route(distance_km=Decimal(self.km), duration_minutes=12, polyline="abc", source="google")


@pytest.fixture(autouse=True)
def road(monkeypatch):
    fake = FakeRoad()
    monkeypatch.setattr("marketplace.services.driving_route", fake)
    return fake
