"""Road distance for ride fares comes from Google's Routes API, with a clearly marked estimate when it's unavailable."""
from decimal import Decimal

import pytest
import requests

from geo import routing

BASTOS = (Decimal("3.8800000"), Decimal("11.5210000"))
AIRPORT = (Decimal("3.7226000"), Decimal("11.5533000"))


class _Response:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self.ok = status_code < 400
        self._payload = payload or {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


@pytest.fixture
def google(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")
    monkeypatch.delenv("GOOGLE_ROUTES_TRAFFIC_AWARE", raising=False)
    calls = []
    state = {"response": _Response(payload={"routes": [{"distanceMeters": 18234, "duration": "1530.4s", "polyline": {"encodedPolyline": "_p~iF~ps|U"}}]})}

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        if isinstance(state["response"], Exception):
            raise state["response"]
        return state["response"]

    monkeypatch.setattr(requests, "post", fake_post)
    return calls, state


def test_google_road_distance_is_used_and_cached(google):
    calls, _ = google
    route = routing.driving_route(BASTOS, AIRPORT)
    assert route == routing.Route(distance_km=Decimal("18.23"), duration_minutes=26, polyline="_p~iF~ps|U", source="google")

    url, kwargs = calls[0]
    assert url == "https://routes.googleapis.com/directions/v2:computeRoutes"
    assert kwargs["headers"]["X-Goog-Api-Key"] == "test-key"
    assert "routes.distanceMeters" in kwargs["headers"]["X-Goog-FieldMask"]
    assert kwargs["json"]["origin"]["location"]["latLng"] == {"latitude": 3.88, "longitude": 11.521}
    assert kwargs["json"]["travelMode"] == "DRIVE" and kwargs["json"]["routingPreference"] == "TRAFFIC_UNAWARE"

    # A quote then a booking for the same points costs a single Google request and gives the same distance.
    assert routing.driving_route(BASTOS, AIRPORT) == route
    assert len(calls) == 1


@pytest.mark.parametrize("failure", [_Response(403, {"error": "API key not valid"}), _Response(payload={"routes": []}), requests.Timeout("slow")])
def test_falls_back_to_a_marked_estimate_when_google_fails(google, failure):
    calls, state = google
    state["response"] = failure
    route = routing.driving_route(BASTOS, AIRPORT)
    assert route.source == "estimate" and route.polyline == ""
    # Straight line is ~17.8 km; roads are counted 1.3 times longer.
    assert Decimal("22") < route.distance_km < Decimal("24") and route.duration_minutes > 50
    # Failures aren't cached, so Google is tried again next time.
    routing.driving_route(BASTOS, AIRPORT)
    assert len(calls) == 2


def test_without_a_key_google_is_never_called(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    monkeypatch.setattr(requests, "post", lambda *a, **k: pytest.fail("Google must not be called without a key"))
    assert routing.driving_route(BASTOS, AIRPORT).source == "estimate"
