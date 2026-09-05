"""
Tests for real saved-search creation and property comparison — closing
two real gaps: check_saved_searches_for_new_listing() could MATCH
against saved searches, but nothing ever let a user CREATE one; and
create_or_update_comparison() had real logic with no API reaching it.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from discovery.models import SavedSearch, PropertyComparison
from discovery.services import create_saved_search, publish_listing_and_notify
from notifications.models import Notification


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Bastos District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_create_saved_search_and_get_real_notification_on_a_real_match(quarter):
    """The literal end-to-end journey this whole feature exists for:
    create a saved search, publish a matching listing through the
    REAL approve() endpoint (the one just fixed to actually trigger
    this), and confirm a real notification fires."""
    seeker = User.objects.create(username="saved_search_seeker", phone="+237699666601")
    landlord = User.objects.create(username="saved_search_landlord", phone="+237699666602")

    create_saved_search(user=seeker, name="Cheap houses in Bastos", filters={"quarter_id": str(quarter.id), "max_price": 100000})

    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PENDING_REVIEW, price_xaf=Decimal("80000"))

    from identity.models import AdminProfile
    admin_user = User.objects.create(username="saved_search_admin", phone="+237699666603")
    AdminProfile.objects.create(user=admin_user, permissions=[])

    approve_response = _auth_client(admin_user).post(f"/api/listings/{listing.id}/approve/")
    assert approve_response.status_code == 200

    assert Notification.objects.filter(recipient=seeker, notification_type="SAVED_SEARCH_MATCH").exists()


@pytest.mark.django_db
def test_saved_search_api_create_list_and_scoping():
    user_a = User.objects.create(username="saved_search_api_a", phone="+237699666604")
    user_b = User.objects.create(username="saved_search_api_b", phone="+237699666605")

    create_response = _auth_client(user_a).post("/api/saved-searches/", {"name": "My search", "filters": {"max_price": 50000}}, format="json")
    assert create_response.status_code == 201

    a_list = _auth_client(user_a).get("/api/saved-searches/")
    b_list = _auth_client(user_b).get("/api/saved-searches/")
    assert a_list.data["count"] == 1
    assert b_list.data["count"] == 0  # never sees user_a's saved search


@pytest.mark.django_db
def test_property_comparison_singleton_behavior(quarter):
    """WHY this tests the SINGLETON behavior specifically:
    create_or_update_comparison() uses update_or_create — there's
    exactly ONE comparison per user, updating in place, not a growing list."""
    user = User.objects.create(username="comparison_user", phone="+237699666606")
    landlord = User.objects.create(username="comparison_landlord", phone="+237699666607")
    house_a = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    house_b = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing_a = Listing.objects.create(property_asset=house_a, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("80000"))
    listing_b = Listing.objects.create(property_asset=house_b, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("90000"))

    client = _auth_client(user)

    not_found = client.get("/api/my-comparison/")
    assert not_found.status_code == 404  # honestly nothing yet, not an empty list

    create_response = client.post("/api/my-comparison/", {"listing_ids": [str(listing_a.id), str(listing_b.id)]}, format="json")
    assert create_response.status_code == 200
    assert len(create_response.data["listing_ids"]) == 2

    # Updating with a different set REPLACES it — still exactly one row.
    house_c = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing_c = Listing.objects.create(property_asset=house_c, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("70000"))
    update_response = client.post("/api/my-comparison/", {"listing_ids": [str(listing_a.id), str(listing_c.id)]}, format="json")
    assert update_response.status_code == 200
    assert PropertyComparison.objects.filter(user=user).count() == 1


@pytest.mark.django_db
def test_property_comparison_enforces_the_2_to_4_limit():
    user = User.objects.create(username="comparison_limit_user", phone="+237699666608")
    client = _auth_client(user)

    too_few = client.post("/api/my-comparison/", {"listing_ids": ["11111111-1111-1111-1111-111111111111"]}, format="json")
    assert too_few.status_code == 400

    too_many = client.post("/api/my-comparison/", {"listing_ids": [f"1111111{i}-1111-1111-1111-111111111111" for i in range(5)]}, format="json")
    assert too_many.status_code == 400


@pytest.mark.django_db
def test_approve_endpoint_now_actually_enforces_moderation_not_just_notifications(quarter):
    """A THIRD real bug in the same class as the saved-search one:
    publish_listing_with_moderation() (blocks AUTO_REMOVE content) and
    publish_listing_and_notify() (saved-search alerts) each existed as
    a separate 'enforced pathway', built without knowing about each
    other — the real approve() endpoint could only call ONE of them,
    silently skipping the other's protection. Confirms a listing with
    moderation-blocked content is genuinely rejected by the real API,
    not just by a bare listing.publish() call."""
    from identity.models import AdminProfile

    landlord = User.objects.create(username="moderation_gap_landlord", phone="+237699666609")
    admin_user = User.objects.create(username="moderation_gap_admin", phone="+237699666610")
    AdminProfile.objects.create(user=admin_user, permissions=[])

    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE", description="This is a badword description.")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PENDING_REVIEW, price_xaf=Decimal("80000"))

    response = _auth_client(admin_user).post(f"/api/listings/{listing.id}/approve/")
    assert response.status_code == 400

    listing.refresh_from_db()
    assert listing.status == ListingStatus.PENDING_REVIEW  # never actually published
