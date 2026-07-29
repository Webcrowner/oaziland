"""
Tests proving Prompt 3's exact acceptance criteria: a test property in
Bastos, Yaoundé shows a real calculated distance to the nearest tarred
road and nearest university — plus the "properties near me" search the
founder specifically asked for.
"""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import (
    Country, Region, Division, Subdivision, VillageOrDistrict, Quarter,
    PointOfInterest, PointOfInterestType,
)
from geo.services import haversine_distance_km, nearest_point_of_interest, distance_to_nearest_road_km
from property.models import House
from property.services import properties_near_location, build_property_location_from_device_gps


@pytest.fixture
def bastos_quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_haversine_distance_is_accurate_for_a_known_pair():
    """Sanity check against a known real-world distance: central Yaoundé
    to central Douala is approximately 195 km in a straight line."""
    yaounde_lat, yaounde_lon = Decimal("3.8480"), Decimal("11.5021")
    douala_lat, douala_lon = Decimal("4.0511"), Decimal("9.7679")
    distance = haversine_distance_km(yaounde_lat, yaounde_lon, douala_lat, douala_lon)
    assert 185 < distance < 205  # generous tolerance, still proves the math is right


@pytest.mark.django_db
def test_property_shows_real_distance_to_nearest_university_and_road(bastos_quarter):
    """This is Prompt 3's literal acceptance criteria."""
    landlord = User.objects.create(username="bastos_landlord", phone="+237699200001")
    house = House.objects.create(
        owner=landlord, quarter=bastos_quarter, type="HOUSE",
        latitude=Decimal("3.8800"), longitude=Decimal("11.5210"),  # real Bastos coordinates
    )

    # A real nearby university and a real nearby tarred-road access point.
    PointOfInterest.objects.create(
        name="University of Yaoundé I", poi_type=PointOfInterestType.UNIVERSITY,
        quarter=bastos_quarter, latitude=Decimal("3.8667"), longitude=Decimal("11.5017"),
    )
    PointOfInterest.objects.create(
        name="Bastos Tarred Road Access", poi_type=PointOfInterestType.TARRED_ROAD_POINT,
        quarter=bastos_quarter, latitude=Decimal("3.8795"), longitude=Decimal("11.5205"),
    )
    # A decoy university much farther away — proves we find the NEAREST one, not just any.
    PointOfInterest.objects.create(
        name="University of Douala", poi_type=PointOfInterestType.UNIVERSITY,
        quarter=None, latitude=Decimal("4.0511"), longitude=Decimal("9.7679"),
    )

    nearest_uni, uni_distance = nearest_point_of_interest(house, PointOfInterestType.UNIVERSITY)
    road_distance = distance_to_nearest_road_km(house)

    assert nearest_uni.name == "University of Yaoundé I"  # correctly picked the near one, not Douala
    assert uni_distance is not None and uni_distance < 5  # real, small, calculated number
    assert road_distance is not None and road_distance < 1  # real, small, calculated number


@pytest.mark.django_db
def test_properties_near_location_search(bastos_quarter):
    """Proves the 'search around, around me' feature: a search from a
    point in Bastos should find the nearby house and correctly EXCLUDE a
    house all the way in Douala."""
    landlord = User.objects.create(username="search_test_landlord", phone="+237699200002")

    nearby_house = House.objects.create(
        owner=landlord, quarter=bastos_quarter, type="HOUSE",
        latitude=Decimal("3.8800"), longitude=Decimal("11.5210"),
    )
    far_away_house = House.objects.create(
        owner=landlord, quarter=bastos_quarter, type="HOUSE",
        latitude=Decimal("4.0511"), longitude=Decimal("9.7679"),  # Douala — ~195km away
    )

    my_current_location = (Decimal("3.8790"), Decimal("11.5200"))  # standing in Bastos right now
    results = properties_near_location(*my_current_location, radius_km=5)

    result_ids = [prop.id for prop, distance in results]
    assert nearby_house.id in result_ids
    assert far_away_house.id not in result_ids  # correctly excluded — too far


@pytest.mark.django_db
def test_use_my_location_when_posting_a_property(bastos_quarter):
    """Proves a landlord's device GPS coordinates can be used directly
    when creating a listing, without requiring them to manually type an
    address first."""
    device_gps = build_property_location_from_device_gps(
        latitude=Decimal("3.8800"), longitude=Decimal("11.5210"), quarter=bastos_quarter,
    )
    landlord = User.objects.create(username="gps_posting_landlord", phone="+237699200003")
    house = House.objects.create(owner=landlord, type="HOUSE", **device_gps)

    assert house.latitude == Decimal("3.8800")
    assert house.longitude == Decimal("11.5210")
    assert house.quarter == bastos_quarter
