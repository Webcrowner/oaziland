"""
Tests proving Prompt 12's exact acceptance criteria: saving a search and
getting a real notification when a matching listing publishes, and
uploading a photo to get visually similar listings back — plus filtered
search, comparison limits, draw-your-own-area, and listing recommendations.
"""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, MediaAsset, Listing, ListingType, ListingStatus
from discovery.models import SavedSearch, PropertyComparison
from discovery.services import (
    check_saved_searches_for_new_listing, publish_listing_and_notify,
    create_or_update_comparison, ComparisonLimitError, run_visual_search,
    search_listings_within_drawn_area, get_recommended_listings,
    search_listings_with_filters,
)
from social.models import Favorite
from notifications.models import Notification


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
    return User.objects.create(username="discovery_landlord", phone="+237699300001")


@pytest.mark.django_db
def test_saved_search_triggers_real_notification_on_matching_publish(quarter, landlord):
    """Prompt 12's literal acceptance criteria."""
    searcher = User.objects.create(username="discovery_searcher", phone="+237699300002")
    saved_search = SavedSearch.objects.create(
        user=searcher, name="2BR under 100k in Bastos",
        filters={"max_price": 100000, "quarter_id": str(quarter.id), "min_bedrooms": 2},
    )

    matching_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", bedrooms=2)
    matching_listing = Listing.objects.create(
        property_asset=matching_house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.DRAFT, price_xaf=Decimal("90000"),
    )

    non_matching_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", bedrooms=1)
    non_matching_listing = Listing.objects.create(
        property_asset=non_matching_house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.DRAFT, price_xaf=Decimal("90000"),  # too few bedrooms
    )

    assert Notification.objects.filter(recipient=searcher).count() == 0

    publish_listing_and_notify(matching_listing)
    matches = Notification.objects.filter(recipient=searcher, notification_type="SAVED_SEARCH_MATCH")
    assert matches.count() == 1
    assert matches.first().delivered is True
    assert str(matching_listing.id) in matches.first().related_reference

    publish_listing_and_notify(non_matching_listing)
    # Still just the one — the non-matching listing must not have triggered anything.
    assert Notification.objects.filter(recipient=searcher, notification_type="SAVED_SEARCH_MATCH").count() == 1

    saved_search.refresh_from_db()
    assert saved_search.last_notified_at is not None


@pytest.mark.django_db
def test_visual_search_returns_similar_listings(quarter, landlord):
    """Prompt 12's other literal acceptance criteria."""
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    MediaAsset.objects.create(property_asset=house, media_type="PHOTO", file_url="https://example.com/bastos-modern-house-1.jpg")

    unrelated_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    unrelated_listing = Listing.objects.create(property_asset=unrelated_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    MediaAsset.objects.create(property_asset=unrelated_house, media_type="PHOTO", file_url="https://example.com/totally-different-warehouse.jpg")

    searcher = User.objects.create(username="visual_searcher", phone="+237699300003")
    query = run_visual_search(user=searcher, image_url="https://uploads.example.com/my-photo-of-a-modern-house.jpg")

    assert str(listing.id) in query.matched_listing_ids
    assert str(unrelated_listing.id) not in query.matched_listing_ids


@pytest.mark.django_db
def test_filtered_search_across_price_bedrooms_and_utilities(quarter, landlord):
    from property.models import CameroonMarketDetails, WaterSource

    cheap_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", bedrooms=2)
    cheap_listing = Listing.objects.create(property_asset=cheap_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("60000"))
    CameroonMarketDetails.objects.create(listing=cheap_listing, water_source=WaterSource.FORAGE_BOREHOLE)

    expensive_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", bedrooms=2)
    expensive_listing = Listing.objects.create(property_asset=expensive_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("500000"))
    CameroonMarketDetails.objects.create(listing=expensive_listing, water_source=WaterSource.CAMWATER_CDE)

    results = search_listings_with_filters({"max_price": 100000, "water_source": WaterSource.FORAGE_BOREHOLE})
    result_ids = [l.id for l in results]

    assert cheap_listing.id in result_ids
    assert expensive_listing.id not in result_ids


@pytest.mark.django_db
def test_comparison_enforces_two_to_four_listings(landlord):
    user = User.objects.create(username="comparison_user", phone="+237699300004")
    with pytest.raises(ComparisonLimitError):
        create_or_update_comparison(user=user, listing_ids=["only-one-id"])
    with pytest.raises(ComparisonLimitError):
        create_or_update_comparison(user=user, listing_ids=[f"id-{i}" for i in range(5)])

    comparison = create_or_update_comparison(user=user, listing_ids=["id-1", "id-2", "id-3"])
    assert len(comparison.listing_ids) == 3

    # Updating replaces, not appends, for the same user.
    updated = create_or_update_comparison(user=user, listing_ids=["id-4", "id-5"])
    assert updated.id == comparison.id
    assert updated.listing_ids == ["id-4", "id-5"]


@pytest.mark.django_db
def test_draw_your_own_area_search_finds_points_inside_polygon(quarter, landlord):
    # A simple square polygon around Bastos.
    polygon = [(3.875, 11.515), (3.885, 11.515), (3.885, 11.525), (3.875, 11.525)]

    inside_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", latitude=Decimal("3.880"), longitude=Decimal("11.520"))
    Listing.objects.create(property_asset=inside_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    outside_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", latitude=Decimal("4.050"), longitude=Decimal("9.770"))  # Douala
    Listing.objects.create(property_asset=outside_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    results = search_listings_within_drawn_area(polygon)
    result_property_ids = [l.property_asset_id for l in results]

    assert inside_house.id in result_property_ids
    assert outside_house.id not in result_property_ids


@pytest.mark.django_db
def test_recommended_listings_favor_favorited_quarter(quarter, landlord):
    other_country = Country.objects.create(name="Nigeria", iso_code="NGA")
    other_region = Region.objects.create(country=other_country, name="Lagos State")
    other_division = Division.objects.create(region=other_region, name="Lagos Division")
    other_subdivision = Subdivision.objects.create(division=other_division, name="Ikeja")
    other_village = VillageOrDistrict.objects.create(subdivision=other_subdivision, name="Ikeja District")
    other_quarter = Quarter.objects.create(village_or_district=other_village, name="Ikeja GRA")

    viewer = User.objects.create(username="recommend_viewer", phone="+237699300005")

    favorited_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    favorited_listing = Listing.objects.create(property_asset=favorited_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    Favorite.objects.create(user=viewer, listing_id=favorited_listing.id)

    same_quarter_house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    same_quarter_listing = Listing.objects.create(property_asset=same_quarter_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("110000"))

    different_quarter_house = House.objects.create(owner=landlord, quarter=other_quarter, type="HOUSE")
    different_quarter_listing = Listing.objects.create(property_asset=different_quarter_house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("110000"))

    recommendations = get_recommended_listings(viewer)
    rec_ids = [l.id for l in recommendations]

    assert rec_ids.index(same_quarter_listing.id) < rec_ids.index(different_quarter_listing.id)
