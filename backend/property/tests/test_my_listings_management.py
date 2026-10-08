import pytest
from decimal import Decimal
from django.utils import timezone
from rest_framework.test import APIClient

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


def _listing(owner, quarter, status, published=True):
    house = House.objects.create(owner=owner, quarter=quarter, type="HOUSE")
    return Listing.objects.create(
        property_asset=house, listed_by=owner, listing_type=ListingType.RENT, status=status,
        price_xaf=Decimal("100000"), published_at=timezone.now() if published else None,
    )


def _client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.mark.django_db
def test_my_listings_shows_every_status_but_only_my_own(quarter):
    me = User.objects.create(username="lister_me", phone="+237699993001")
    other = User.objects.create(username="lister_other", phone="+237699993002")
    _listing(me, quarter, ListingStatus.PUBLISHED)
    _listing(me, quarter, ListingStatus.PENDING_REVIEW, published=False)
    _listing(me, quarter, ListingStatus.REJECTED, published=False)
    _listing(other, quarter, ListingStatus.PUBLISHED)

    response = _client(me).get("/api/my-listings/")
    assert response.data["count"] == 3
    rejected_only = _client(me).get("/api/my-listings/", {"status": "REJECTED"})
    assert rejected_only.data["count"] == 1
    assert APIClient().get("/api/my-listings/").status_code == 401


@pytest.mark.django_db
def test_owner_can_pause_close_and_reopen_but_not_skip_review(quarter):
    me = User.objects.create(username="lister_me2", phone="+237699993003")
    live = _listing(me, quarter, ListingStatus.PUBLISHED)
    client = _client(me)

    assert client.post(f"/api/listings/{live.id}/set-status/", {"status": "CLOSED"}, format="json").data["status"] == "CLOSED"
    assert client.post(f"/api/listings/{live.id}/set-status/", {"status": "PUBLISHED"}, format="json").data["status"] == "PUBLISHED"

    pending = _listing(me, quarter, ListingStatus.PENDING_REVIEW, published=False)
    assert client.post(f"/api/listings/{pending.id}/set-status/", {"status": "PUBLISHED"}, format="json").status_code == 400


@pytest.mark.django_db
def test_other_users_cannot_change_status_and_live_listings_cannot_be_deleted(quarter):
    me = User.objects.create(username="lister_me3", phone="+237699993004")
    other = User.objects.create(username="lister_other3", phone="+237699993005")
    live = _listing(me, quarter, ListingStatus.PUBLISHED)

    assert _client(other).post(f"/api/listings/{live.id}/set-status/", {"status": "CLOSED"}, format="json").status_code == 403
    assert _client(me).delete(f"/api/listings/{live.id}/").status_code == 400

    draft = _listing(me, quarter, ListingStatus.REJECTED, published=False)
    assert _client(other).delete(f"/api/listings/{draft.id}/").status_code == 403
    assert _client(me).delete(f"/api/listings/{draft.id}/").status_code == 204
