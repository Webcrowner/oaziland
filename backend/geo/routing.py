"""
geo.routing — real road distance and driving time between two points, from Google's Routes API.

Set GOOGLE_MAPS_API_KEY (a key with the Routes API enabled) to turn it on. Without a key, or if Google
can't be reached or finds no road, the straight-line distance times a winding factor is used instead and
the result says so (source="estimate"), so booking a ride never breaks because a map service is down.

Google results are cached for a while, so the price a rider is quoted is the price they're charged and a
quote followed by a booking costs one Google request, not two.
"""
import logging
import math
import os
from dataclasses import dataclass
from decimal import Decimal

from django.core.cache import cache

from .services import haversine_distance_km

logger = logging.getLogger(__name__)

GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
GOOGLE_TIMEOUT_SECONDS = 6
CACHE_SECONDS = 30 * 60
ROAD_WINDING_FACTOR = Decimal("1.3")
ESTIMATE_SPEED_KMH = 25  # Typical city driving speed in Yaoundé/Douala traffic.


@dataclass(frozen=True)
class Route:
    distance_km: Decimal
    duration_minutes: int
    # Google's encoded polyline of the road taken; empty for an estimate.
    polyline: str
    # "google" for a real road route, "estimate" for the straight-line fallback.
    source: str


def routing_configured() -> bool:
    return bool(os.environ.get("GOOGLE_MAPS_API_KEY", "").strip())


def _cache_key(origin, destination) -> str:
    points = [f"{float(value):.5f}" for value in (*origin, *destination)]
    return "route:" + ",".join(points)


def estimated_route(origin, destination) -> Route:
    straight = Decimal(haversine_distance_km(origin[0], origin[1], destination[0], destination[1]))
    distance = (straight * ROAD_WINDING_FACTOR).quantize(Decimal("0.01"))
    minutes = max(1, math.ceil(float(distance) / ESTIMATE_SPEED_KMH * 60))
    return Route(distance_km=distance, duration_minutes=minutes, polyline="", source="estimate")


def _google_route(origin, destination, api_key: str):
    import requests

    def waypoint(point):
        return {"location": {"latLng": {"latitude": float(point[0]), "longitude": float(point[1])}}}

    traffic_aware = os.environ.get("GOOGLE_ROUTES_TRAFFIC_AWARE", "").strip().lower() in ("1", "true", "yes")
    body = {
        "origin": waypoint(origin),
        "destination": waypoint(destination),
        "travelMode": "DRIVE",
        # Traffic-aware routing is billed at a higher rate; distance (what the fare uses) barely changes.
        "routingPreference": "TRAFFIC_AWARE" if traffic_aware else "TRAFFIC_UNAWARE",
        "units": "METRIC",
    }
    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    }
    try:
        response = requests.post(GOOGLE_ROUTES_URL, json=body, headers=headers, timeout=GOOGLE_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        logger.warning("Google Routes API unreachable, using an estimate: %s", exc)
        return None
    if not response.ok:
        logger.warning("Google Routes API returned %s, using an estimate: %s", response.status_code, response.text[:300])
        return None
    routes = (response.json() or {}).get("routes") or []
    # Google leaves distanceMeters out when it is zero (both points on the same spot).
    if not routes or not routes[0].get("distanceMeters"):
        return None
    first = routes[0]
    seconds = float(str(first.get("duration", "0s")).rstrip("s") or 0)
    return Route(
        distance_km=(Decimal(first["distanceMeters"]) / 1000).quantize(Decimal("0.01")),
        duration_minutes=max(1, math.ceil(seconds / 60)),
        polyline=(first.get("polyline") or {}).get("encodedPolyline", ""),
        source="google",
    )


def driving_route(origin, destination) -> Route:
    """The driving route from origin to destination, each a (latitude, longitude) pair."""
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not api_key:
        return estimated_route(origin, destination)
    key = _cache_key(origin, destination)
    cached = cache.get(key)
    if cached is not None:
        return cached
    route = _google_route(origin, destination, api_key)
    if route is None:
        return estimated_route(origin, destination)
    cache.set(key, route, CACHE_SECONDS)
    return route
