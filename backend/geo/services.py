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


class AreaSuggestionError(Exception):
    pass


MAX_NAME_LENGTH = 100
MAX_REASON_LENGTH = 300


def _clean_name(value, label: str) -> str:
    value = " ".join((value or "").split())
    if not value:
        raise AreaSuggestionError(f"The {label} cannot be empty.")
    if len(value) > MAX_NAME_LENGTH:
        raise AreaSuggestionError(f"The {label} must be {MAX_NAME_LENGTH} characters or fewer.")
    return value


def similar_quarters(suggestion, limit: int = 4) -> list[dict]:
    """Neighbourhoods already in the same region whose name resembles the request, so a duplicate or a
    spelling variant is spotted before a new one is created."""
    from django.db.models import Q
    from .models import Quarter

    name = suggestion.area_name.strip()
    first_word = name.split()[0] if name.split() else name
    rows = Quarter.objects.filter(
        village_or_district__subdivision__division__region=suggestion.region,
    ).filter(Q(name__icontains=name) | Q(name__icontains=first_word) | Q(name__istartswith=name[:4])).select_related(
        "village_or_district",
    ).order_by("name")[:limit]
    return [{"id": str(q.id), "name": q.name, "city": q.village_or_district.name} for q in rows]


def _notify_requester(suggestion, title: str, message: str) -> None:
    if suggestion.suggested_by_id is None:
        return
    from notifications.services import notify

    notify(
        recipient=suggestion.suggested_by, notification_type="AREA_SUGGESTION", channel="IN_APP",
        title=title, message=message, related_reference=str(suggestion.id),
    )


def notify_admins_of_area_suggestion(suggestion) -> None:
    """Tells every admin a neighbourhood request is waiting."""
    from identity.models import AdminProfile
    from notifications.services import notify

    who = (suggestion.suggested_by.full_name or suggestion.suggested_by.username) if suggestion.suggested_by_id else "A user"
    for admin_profile in AdminProfile.objects.select_related("user"):
        notify(
            recipient=admin_profile.user, notification_type="AREA_SUGGESTION_REQUESTED", channel="IN_APP",
            title="New neighbourhood request",
            message=f"{who} asked to add {suggestion.area_name} ({suggestion.city_name}, {suggestion.region.name}).",
            related_reference=str(suggestion.id),
        )


def approve_area_suggestion(suggestion, *, admin=None, area_name: str = "", city_name: str = ""):
    """Creates the neighbourhood (and its city, if new) and closes the request. The reviewer may correct the
    spelling of the area or city first. Approving a name that already exists simply links the request to it."""
    from django.db import transaction
    from django.utils import timezone
    from .models import AreaSuggestion, AreaSuggestionStatus, Division, Quarter, Subdivision, VillageOrDistrict

    with transaction.atomic():
        locked = AreaSuggestion.objects.select_for_update().select_related("region", "suggested_by").get(pk=suggestion.pk)
        if locked.status != AreaSuggestionStatus.PENDING:
            raise AreaSuggestionError("This request has already been reviewed.")
        area = _clean_name(area_name or locked.area_name, "neighbourhood name")
        city = _clean_name(city_name or locked.city_name, "city name")

        district = VillageOrDistrict.objects.filter(
            name__iexact=city, subdivision__division__region=locked.region,
        ).first()
        if district is None:
            division, _ = Division.objects.get_or_create(region=locked.region, name="Other")
            subdivision, _ = Subdivision.objects.get_or_create(division=division, name=city)
            district, _ = VillageOrDistrict.objects.get_or_create(subdivision=subdivision, name=city)
        quarter = Quarter.objects.filter(village_or_district=district, name__iexact=area).first()
        if quarter is None:
            quarter = Quarter.objects.create(village_or_district=district, name=area)

        locked.area_name, locked.city_name = area, district.name
        locked.created_quarter = quarter
        locked.status = AreaSuggestionStatus.APPROVED
        locked.reviewed_by, locked.reviewed_at = admin, timezone.now()
        locked.save(update_fields=["area_name", "city_name", "created_quarter", "status", "reviewed_by", "reviewed_at"])
        _notify_requester(
            locked, "Your neighbourhood was added",
            f"{quarter.name} ({district.name}) is now available when you list a property or item.",
        )
    return locked


def reject_area_suggestion(suggestion, *, admin=None, reason: str = ""):
    from django.db import transaction
    from django.utils import timezone
    from .models import AreaSuggestion, AreaSuggestionStatus

    reason = (reason or "").strip()
    if not reason:
        raise AreaSuggestionError("A reason is required to decline a request.")
    if len(reason) > MAX_REASON_LENGTH:
        raise AreaSuggestionError(f"The reason must be {MAX_REASON_LENGTH} characters or fewer.")

    with transaction.atomic():
        locked = AreaSuggestion.objects.select_for_update().select_related("region", "suggested_by").get(pk=suggestion.pk)
        if locked.status != AreaSuggestionStatus.PENDING:
            raise AreaSuggestionError("This request has already been reviewed.")
        locked.status = AreaSuggestionStatus.REJECTED
        locked.rejection_reason = reason
        locked.reviewed_by, locked.reviewed_at = admin, timezone.now()
        locked.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
        _notify_requester(
            locked, "Your neighbourhood request was declined",
            f"We couldn't add \u201c{locked.area_name}\u201d. Reason: {reason}",
        )
    return locked
