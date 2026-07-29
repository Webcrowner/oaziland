"""
property.services — search and discovery logic that doesn't belong on the
models themselves (models describe WHAT a property is; this file
describes HOW to find one).
"""
from geo.services import haversine_distance_km


def properties_near_location(latitude, longitude, radius_km=5, queryset=None):
    """'Properties around me' — Prompt 3's explicit requirement. Returns
    every property within `radius_km` of the given point, sorted nearest
    first.

    WHY this is a plain Python function instead of a database query: a
    true 'find everything within N km' database query needs PostGIS's
    spatial indexing to run fast at scale. This straightforward version
    (fetch candidates, compute distance in Python, filter and sort) is
    correct and fine for now; swapping it for a PostGIS ST_DWithin query
    later is a pure performance upgrade that doesn't change what this
    function promises to callers.

    `queryset` lets a caller pre-filter (e.g. only PUBLISHED listings,
    only houses) before the distance search runs — defaults to every
    PropertyAsset with coordinates set.
    """
    from .models import PropertyAsset

    if queryset is None:
        queryset = PropertyAsset.objects.all()

    candidates = queryset.exclude(latitude__isnull=True).exclude(longitude__isnull=True)

    results = []
    for prop in candidates:
        distance = haversine_distance_km(latitude, longitude, prop.latitude, prop.longitude)
        if distance <= radius_km:
            results.append((prop, distance))

    results.sort(key=lambda pair: pair[1])  # nearest first
    return results


def build_property_location_from_device_gps(latitude, longitude, quarter=None):
    """Supports 'use my location when posting a property' — Prompt 3's
    other explicit requirement. This is a thin, named helper (rather than
    landlords just setting property.latitude directly) so the ONE place
    that accepts device GPS coordinates for a new listing is easy to find
    and adjust later — e.g. if we later want to snap the coordinates to
    the nearest known Quarter automatically, or validate they fall within
    Cameroon, this is where that logic would live.

    Returns a dict of field values ready to pass into PropertyAsset
    creation — kept as a dict rather than partially constructing the
    model, so this function has no opinion about which PropertyAsset
    subclass (House, Shop, Land...) is actually being created.
    """
    return {
        "latitude": latitude,
        "longitude": longitude,
        "quarter": quarter,  # still required — GPS alone doesn't tell us which named Quarter this falls in
    }
