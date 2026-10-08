"""The chatbot must hand the user working links: specific listings, plus the area page even when nothing matches."""
from decimal import Decimal

import pytest

from engagement.chat_retrieval import detect_price_range, detect_intents
from engagement.services import build_platform_context
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from hotels.models import Hotel, RoomType
from identity.models import User
from property.models import House, Listing, ListingType, ListingStatus


@pytest.fixture
def places(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé")
    yaounde = VillageOrDistrict.objects.create(subdivision=subdivision, name="Yaoundé")
    littoral = Region.objects.create(country=country, name="Littoral")
    wouri = Division.objects.create(region=littoral, name="Wouri")
    douala_sub = Subdivision.objects.create(division=wouri, name="Douala")
    douala = VillageOrDistrict.objects.create(subdivision=douala_sub, name="Douala")
    return {
        "bastos": Quarter.objects.create(village_or_district=yaounde, name="Bastos"),
        "mvan": Quarter.objects.create(village_or_district=yaounde, name="Mvan"),
        "akwa": Quarter.objects.create(village_or_district=douala, name="Akwa"),
        "mokolo_y": Quarter.objects.create(village_or_district=yaounde, name="Mokolo"),
        "mokolo_d": Quarter.objects.create(village_or_district=douala, name="Mokolo"),
    }


def _listing(quarter, price, listing_type=ListingType.RENT):
    owner = User.objects.create(username=f"owner_{Listing.objects.count()}", phone=f"+2376990{Listing.objects.count():05d}")
    house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE")
    return Listing.objects.create(
        property_asset=house, listed_by=owner, listing_type=listing_type, status=ListingStatus.PUBLISHED, price_xaf=Decimal(price),
    )


def test_price_and_intent_parsing():
    assert detect_price_range("under 100k please") == (None, 100000)
    assert detect_price_range("budget 1.5 million") == (None, 1500000)
    assert detect_price_range("rent at 80,000 XAF") == (None, 80000)
    assert detect_price_range("above 200 000") == (200000, None)
    assert detect_price_range("3 bedroom house in 2026") == (None, None)
    assert detect_intents("I want a house to rent") == {"property"}
    assert detect_intents("any hotel with a room?") == {"hotel"}
    assert detect_intents("what time is it") == set()


@pytest.mark.django_db
def test_matching_listing_comes_with_its_link_and_the_area_page(places):
    cheap = _listing(places["bastos"], "80000")
    context = build_platform_context(user=None, message="I need a house to rent in Bastos")
    assert f"/listing/{cheap.id}" in context
    assert f"/search?quarter={places['bastos'].id}&listing_type=RENT" in context


@pytest.mark.django_db
def test_budget_with_no_match_says_so_but_still_gives_area_link(places):
    expensive = _listing(places["bastos"], "500000")
    context = build_platform_context(user=None, message="house for rent in Bastos under 100k")
    assert "NO listing in this area matches" in context
    assert f"/listing/{expensive.id}" in context  # the closest option
    assert f"/search?quarter={places['bastos'].id}&listing_type=RENT&max_price=100000" in context


@pytest.mark.django_db
def test_empty_area_still_gets_an_area_link(places):
    context = build_platform_context(user=None, message="apartment to rent in Mvan")
    assert "NO published listings exist in this area" in context
    assert f"/search?quarter={places['mvan'].id}" in context


@pytest.mark.django_db
def test_missing_area_asks_for_one_and_ambiguous_area_asks_which_city(places):
    _listing(places["akwa"], "90000")
    no_area = build_platform_context(user=None, message="I want a house to rent")
    assert "did not name a specific area" in no_area
    assert f"/search?quarter={places['akwa'].id}" in no_area  # popular areas offered

    ambiguous = build_platform_context(user=None, message="house for rent in Mokolo")
    assert "several cities" in ambiguous and "Douala" in ambiguous and "Yaoundé" in ambiguous

    clarified = build_platform_context(user=None, message="Mokolo in Douala")  # no intent alone, so use history
    assert clarified == ""
    followup = build_platform_context(
        user=None, message="Mokolo in Douala",
        history=[{"sender_type": "USER", "text": "house for rent"}, {"sender_type": "AI_AGENT", "text": "Which area?"}],
    )
    assert f"quarter={places['mokolo_d'].id}" in followup


@pytest.mark.django_db
def test_city_level_question_lists_neighborhoods_with_listings(places):
    _listing(places["akwa"], "90000")
    context = build_platform_context(user=None, message="any house for rent in Douala?")
    assert "Akwa (Douala): 1" in context
    assert f"/search?quarter={places['akwa'].id}&listing_type=RENT" in context


@pytest.mark.django_db
def test_a_bare_city_word_finds_places_in_differently_named_districts(places):
    """'kribi' must reach a hotel in 'Kribi Beachfront Resort Area' (district 'Kribi Beach') even though
    a separate district named 'Kribi' exists — the bot used to offer the hotel, then deny it existed."""
    region = Region.objects.get(name="Centre")
    division = Division.objects.get(region=region)
    subdivision = Subdivision.objects.get(division=division)
    kribi_city = VillageOrDistrict.objects.create(subdivision=subdivision, name="Kribi")
    Quarter.objects.create(village_or_district=kribi_city, name="Mpalla")
    beach_district = VillageOrDistrict.objects.create(subdivision=subdivision, name="Kribi Beach")
    beach = Quarter.objects.create(village_or_district=beach_district, name="Kribi Beachfront Resort Area")
    owner = User.objects.create(username="kribi_hotel_owner", phone="+237699700002")
    hotel = Hotel.objects.create(owner=owner, quarter=beach, type="HOTEL", verified=True)
    RoomType.objects.create(hotel=hotel, category="STANDARD", capacity=2, base_rate_xaf=Decimal("45000"))

    context = build_platform_context(
        user=None, message="kribi",
        history=[{"sender_type": "USER", "text": "I want a hotel"}, {"sender_type": "AI_AGENT", "text": "Which area?"}],
    )
    assert f"/hotels/{hotel.id}" in context
    assert f"/hotels?quarter={beach.id}" in context


@pytest.mark.django_db
def test_hotel_results_link_to_hotel_and_hotels_area_page(places):
    owner = User.objects.create(username="hotel_owner_chat", phone="+237699700001")
    hotel = Hotel.objects.create(owner=owner, quarter=places["bastos"], type="HOTEL", verified=True)
    RoomType.objects.create(hotel=hotel, category="STANDARD", capacity=2, base_rate_xaf=Decimal("30000"))
    context = build_platform_context(user=None, message="a hotel in Bastos")
    assert f"/hotels/{hotel.id}" in context
    assert f"/hotels?quarter={places['bastos'].id}" in context

    over_budget = build_platform_context(user=None, message="hotel in Bastos under 10000")
    assert "NO hotel in this area fits" in over_budget
    assert f"/hotels?quarter={places['bastos'].id}&max_price=10000" in over_budget


def test_mangled_model_links_are_rewritten_to_clean_site_paths():
    from engagement.support_agent import clean_reply_links

    broken = (
        "- **Browse Molyko** \u2013 2 listings: `[Browse this area\u2192](http://localhost:3000/en/search?quarter=39da4dd3-8fa1-430f-9337-88e4da2f000d`)\n"
        "Also see [all](http://localhost:3000/fr/hotels) and [Other site](https://example.com/page)."
    )
    cleaned = clean_reply_links(broken)
    assert "[Browse this area](/search?quarter=39da4dd3-8fa1-430f-9337-88e4da2f000d)" in cleaned
    assert "[all](/hotels)" in cleaned
    assert "[Other site](https://example.com/page)" in cleaned  # external links are left alone
    assert "`" not in cleaned and "localhost" not in cleaned


@pytest.mark.django_db
def test_search_with_a_malformed_quarter_id_returns_no_results_instead_of_failing():
    from rest_framework.test import APIClient
    response = APIClient().get("/api/listings/", {"quarter": "39da4dd3-8fa1-430f-9337-88e4da2f000d`"})
    assert response.status_code == 200
    assert response.data["count"] == 0
