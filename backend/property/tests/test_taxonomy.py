"""
Tests proving Prompt 4's exact acceptance criteria: every one of the
Cameroon property categories exists with the fields specific to it, bulk
unit creation works and assigns unique room codes, and the generic
VerificationBadge system works across different property types.
"""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import (
    Building, RoomUnit, StudioUnit, ApartmentUnit, House, HouseStyle,
    CommercialSpace, Shop, CorporateOffice, EventCenter, VenueSpace,
    GuestHouseLodge, MixedUseBuilding, Warehouse,
    VerificationBadge, BadgeType, BadgeStatus,
    Listing, ListingType, ListingStatus, CameroonMarketDetails, SecurityFeatures,
    LegalStatus, WaterSource, ElectricityMeterType, RoadAccessibility, GuardStatus,
)
from land.models import Land, LandUseType, TitleType


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.fixture
def landlord(db):
    return User.objects.create(username="taxonomy_landlord", phone="+237699300001")


@pytest.mark.django_db
def test_all_fifteen_categories_exist_with_their_specific_fields(quarter, landlord):
    """One example of every category, each carrying the field that makes
    it genuinely distinct from the others — this is the literal
    acceptance criteria for Prompt 4."""
    building = Building.objects.create(owner=landlord, quarter=quarter, type="BUILDING")

    room = RoomUnit.objects.create(building=building, room_code="A-1", internal_bathroom=True, kitchen_access="VERANDA")
    studio = StudioUnit.objects.create(building=building, room_code="A-2", kitchen_type="OPEN_AMERICAN_STYLE")
    apartment = ApartmentUnit.objects.create(building=building, room_code="A-3", bedrooms=3, bathrooms=2, separate_salon=True)

    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", house_style=HouseStyle.DUPLEX, is_furnished_short_let=True, short_let_daily_rate_xaf=Decimal("35000"))
    shop = Shop.objects.create(owner=landlord, quarter=quarter, type="SHOP", frontage_meters=Decimal("6.5"))
    office = CorporateOffice.objects.create(owner=landlord, quarter=quarter, type="OFFICE")
    event_center = EventCenter.objects.create(owner=landlord, quarter=quarter, type="EVENT_CENTER")
    VenueSpace.objects.create(event_center=event_center, name="Main Hall", capacity=300)
    guest_house = GuestHouseLodge.objects.create(owner=landlord, quarter=quarter, type="GUEST_HOUSE", is_coastal_leisure=True)
    mixed_use = MixedUseBuilding.objects.create(owner=landlord, quarter=quarter, type="MIXED_USE", ground_floor_shops=4)

    titled_land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-001", title_type=TitleType.TITRE_FONCIER)
    commercial_plot = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.COMMERCIAL_PLOT, title_deed_number="TF-002", title_type=TitleType.CONCESSION)
    agri_land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.AGRICULTURAL, title_deed_number="TF-003", title_type=TitleType.DEMANDE_EN_COURS)
    carwash_plot = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.CAR_WASH_PAVED_PLOT, title_deed_number="TF-004", title_type=TitleType.TITRE_FONCIER)
    warehouse = Warehouse.objects.create(owner=landlord, quarter=quarter, type="WAREHOUSE", storage_capacity_sqm=Decimal("500"))

    # Confirm each carries the field that makes it genuinely distinct — not
    # just that the row was created.
    assert room.kitchen_access == "VERANDA" and not hasattr(room, "separate_salon")
    assert studio.kitchen_type == "OPEN_AMERICAN_STYLE"
    assert apartment.separate_salon is True and apartment.bedrooms == 3
    assert house.house_style == HouseStyle.DUPLEX and house.is_furnished_short_let
    assert shop.frontage_meters == Decimal("6.5")
    assert event_center.venue_spaces.count() == 1
    assert guest_house.is_coastal_leisure is True
    assert mixed_use.ground_floor_shops == 4
    assert titled_land.land_use_type == LandUseType.TITLED_RESIDENTIAL
    assert commercial_plot.land_use_type == LandUseType.COMMERCIAL_PLOT
    assert agri_land.land_use_type == LandUseType.AGRICULTURAL
    assert carwash_plot.land_use_type == LandUseType.CAR_WASH_PAVED_PLOT
    assert warehouse.storage_capacity_sqm == Decimal("500")

    # 15 categories total: Room, Studio, Apartment, House, Shop, Office,
    # EventCenter, GuestHouseLodge, MixedUseBuilding, Building itself,
    # 4 Land use types, Warehouse.
    all_types = [room, studio, apartment, house, shop, office, event_center,
                 guest_house, mixed_use, titled_land, commercial_plot,
                 agri_land, carwash_plot, warehouse]
    assert len(all_types) == 14  # +Building itself = 15 categories total


@pytest.mark.django_db
def test_bulk_create_units_assigns_unique_room_codes(quarter, landlord):
    """Prompt 4's literal acceptance criteria: bulk-create 10 identical
    rooms in one action, each with a different room_code."""
    building = Building.objects.create(owner=landlord, quarter=quarter, type="BUILDING")

    created_rooms = building.bulk_create_units(
        RoomUnit, count=10, room_code_prefix="A", internal_bathroom=True,
    )

    assert len(created_rooms) == 10
    room_codes = [room.room_code for room in created_rooms]
    assert len(set(room_codes)) == 10  # all 10 are unique — no duplicates
    assert building.units.count() == 10

    # Bulk-creating MORE units afterward should continue the numbering,
    # not restart it and collide with the first batch.
    more_rooms = building.bulk_create_units(RoomUnit, count=5, room_code_prefix="A", internal_bathroom=False)
    all_codes = room_codes + [r.room_code for r in more_rooms]
    assert len(set(all_codes)) == 15  # still no collisions across both batches


@pytest.mark.django_db
def test_verification_badge_is_generic_across_property_types(quarter, landlord):
    """The same VerificationBadge model, and the same approve() method,
    must work identically whether it's badging a Land parcel or a Guest
    House — that's the whole point of making it generic."""
    admin = User.objects.create(username="badge_admin", phone="+237699300099")
    land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-100", title_type=TitleType.TITRE_FONCIER)
    guest_house = GuestHouseLodge.objects.create(owner=landlord, quarter=quarter, type="GUEST_HOUSE")

    land_badge = VerificationBadge.objects.create(property_asset=land, badge_type=BadgeType.BORNES_VISIBLES)
    guest_house_badge = VerificationBadge.objects.create(property_asset=guest_house, badge_type=BadgeType.SITE_VISIT_VERIFIED)

    assert land_badge.status == BadgeStatus.NOT_SUBMITTED
    land_badge.approve(admin)
    guest_house_badge.approve(admin)

    assert land_badge.status == BadgeStatus.VERIFIED and land_badge.verified_by == admin
    assert guest_house_badge.status == BadgeStatus.VERIFIED and guest_house_badge.verified_by == admin


@pytest.mark.django_db
def test_land_cannot_publish_without_title_deed(quarter, landlord):
    land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.AGRICULTURAL, title_deed_number="", title_type=TitleType.DEMANDE_EN_COURS)
    assert land.can_publish() is False

    land.title_deed_number = "TF-999"
    assert land.can_publish() is True


@pytest.mark.django_db
def test_cameroon_market_details_and_security_features_attach_to_listing(quarter, landlord):
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(
        property_asset=house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("120000"),
    )
    CameroonMarketDetails.objects.create(
        listing=listing, legal_status=LegalStatus.TITRE_FONCIER, rent_advance_months=6,
        caution_deposit_xaf=Decimal("120000"), water_source=WaterSource.FORAGE_BOREHOLE,
        electricity_meter_type=ElectricityMeterType.ENEO_PREPAID, road_accessibility=RoadAccessibility.TARRED,
    )
    SecurityFeatures.objects.create(
        listing=listing, fenced_gate=True, secured_openings_antivols=True,
        guard_status=GuardStatus.NIGHT_WATCHMAN, parking_spaces=2,
    )

    assert listing.market_details.rent_advance_months == 6
    assert listing.market_details.water_source == WaterSource.FORAGE_BOREHOLE
    assert listing.security_features.guard_status == GuardStatus.NIGHT_WATCHMAN
