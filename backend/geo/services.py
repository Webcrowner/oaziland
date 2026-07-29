"""
geo.services — distance calculations shared by every "how far is X"
feature in the platform: distance-to-university, distance-to-market,
distance-to-tarred-road, and "properties near me."

WHY one shared function instead of one per feature: the math for "how far
apart are two points on Earth" never changes based on what those two
points represent. Writing it once here and having every feature call it
means a bug fix or precision improvement happens in one place, not four.
"""
import math
from decimal import Decimal


def haversine_distance_km(lat1, lon1, lat2, lon2) -> Decimal:
    """Straight-line ('as the crow flies') distance between two
    latitude/longitude points, in kilometers, using the Haversine formula.

    WHY straight-line and not road-network distance: true road-network
    distance requires calling an external routing service (OSRM, Google
    Directions API) for every single calculation, which costs money and
    time at scale. Straight-line distance is free, instant, computed
    locally, and close enough for search/filtering and "roughly how far"
    displays. `road_network_distance_km` below is the documented upgrade
    path once a routing API is connected (Prompt 3's Google Maps
    Platform option).
    """
    lat1, lon1, lat2, lon2 = float(lat1), float(lon1), float(lat2), float(lon2)
    earth_radius_km = 6371.0

    lat1_rad, lon1_rad = math.radians(lat1), math.radians(lon1)
    lat2_rad, lon2_rad = math.radians(lat2), math.radians(lon2)
    delta_lat = lat2_rad - lat1_rad
    delta_lon = lon2_rad - lon1_rad

    a = (math.sin(delta_lat / 2) ** 2
         + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2)
    c = 2 * math.asin(math.sqrt(a))
    return Decimal(str(round(earth_radius_km * c, 3)))


def road_network_distance_km(lat1, lon1, lat2, lon2) -> Decimal:
    """Placeholder for real road-network distance via an external routing
    API (e.g. OSRM or Google Directions). NOT YET CONNECTED to a real
    service — falls back to the straight-line distance, multiplied by a
    rough 'roads aren't straight' correction factor, so callers get a
    more realistic estimate than a pure straight line until a real
    routing API is wired in.

    This is flagged clearly rather than silently pretending to be exact:
    do not treat this number as precise until a real routing API replaces
    this fallback."""
    straight_line = haversine_distance_km(lat1, lon1, lat2, lon2)
    ROAD_WINDING_FACTOR = Decimal("1.3")  # rough real-world roads-aren't-straight correction
    return round(straight_line * ROAD_WINDING_FACTOR, 3)


def nearest_point_of_interest(property_asset, poi_type: str):
    """Finds the closest PointOfInterest of a given type to a property,
    and how far away it is. Returns (PointOfInterest, distance_km), or
    (None, None) if the property has no coordinates or none exist of
    that type yet."""
    from .models import PointOfInterest

    if property_asset.latitude is None or property_asset.longitude is None:
        return None, None

    candidates = PointOfInterest.objects.filter(poi_type=poi_type)
    closest, closest_distance = None, None
    for poi in candidates:
        distance = haversine_distance_km(
            property_asset.latitude, property_asset.longitude, poi.latitude, poi.longitude,
        )
        if closest_distance is None or distance < closest_distance:
            closest, closest_distance = poi, distance
    return closest, closest_distance


def distance_to_nearest_road_km(property_asset):
    """Distance from a property to the nearest tarred-road access point,
    used to populate PropertyAsset.distance_to_tarmac_km. Uses the same
    generic PointOfInterest lookup as any other amenity type — a tarred
    road access point IS a point of interest, just a different type."""
    from .models import PointOfInterestType
    _, distance = nearest_point_of_interest(property_asset, PointOfInterestType.TARRED_ROAD_POINT)
    return distance
