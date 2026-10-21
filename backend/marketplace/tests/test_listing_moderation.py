"""Marketplace listings are screened before going live, can be reported, and a confirmed report hides the listing for good."""
import pytest
from identity.models import User, AdminProfile
from marketplace.models import WarehouseListing
from trust_safety.models import AIModerationResult, ContentReport, ReportStatus, UserWarning
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401

PAYLOAD = {"title": "Clean warehouse", "price_basis": "RENT_MONTHLY", "price_xaf": "500000", "size_sqm": "800"}


@pytest.fixture
def lister(db):
    return _verify(User.objects.create(username="mod_lister", phone="+237699500001"))


@pytest.fixture
def admin(db):
    user = User.objects.create(username="mod_admin", phone="+237699500002")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def listing_id(lister, quarter):
    response = _auth_client(lister).post("/api/warehouses/", {**PAYLOAD, "quarter": str(quarter.id)})
    assert response.status_code == 201, response.data
    return response.data["id"]


def _report(user, listing_id, reason="SCAM_SUSPECTED"):
    return _auth_client(user).post("/api/content-reports/", {"target_listing_id": listing_id, "reason": reason, "notes": "Looks fake"}, format="json")


@pytest.mark.django_db
def test_a_listing_with_prohibited_wording_is_blocked_and_the_check_is_recorded(lister, quarter):
    response = _auth_client(lister).post("/api/warehouses/", {**PAYLOAD, "description": "contains badword here", "quarter": str(quarter.id)})
    assert response.status_code == 400 and "moderation" in response.data["detail"]
    assert WarehouseListing.objects.count() == 0
    assert AIModerationResult.objects.filter(action="AUTO_REMOVE").exists()


@pytest.mark.django_db
def test_clean_listings_are_published_and_their_check_is_recorded(listing_id):
    assert AIModerationResult.objects.filter(target_listing_id=listing_id, action="ALLOW").exists()


@pytest.mark.django_db
def test_editing_a_listing_to_add_prohibited_wording_is_blocked(lister, listing_id):
    client = _auth_client(lister)
    response = client.patch(f"/api/warehouses/{listing_id}/", {"description": "scamword inside"}, format="json")
    assert response.status_code == 400
    assert WarehouseListing.objects.get(pk=listing_id).description == ""
    assert client.patch(f"/api/warehouses/{listing_id}/", {"price_xaf": "450000"}, format="json").status_code == 200


@pytest.mark.django_db
def test_an_inappropriate_photo_cannot_be_attached(lister, listing_id):
    client = _auth_client(lister)
    url = f"/api/warehouses/{listing_id}/add-media/"
    assert client.post(url, {"url": "https://cdn.example.com/nudetest.jpg", "media_type": "PHOTO"}, format="json").status_code == 400
    assert client.post(url, {"url": "https://cdn.example.com/ok.jpg", "media_type": "PHOTO"}, format="json").status_code == 201
    assert WarehouseListing.objects.get(pk=listing_id).media.count() == 1


@pytest.mark.django_db
def test_reporting_a_listing_rules(lister, listing_id):
    reporter = User.objects.create(username="mod_reporter", phone="+237699500003")
    assert _report(lister, listing_id).status_code == 400  # own listing
    assert _report(reporter, listing_id).status_code == 201
    assert _report(reporter, listing_id).status_code == 400  # already open
    from rest_framework.test import APIClient
    assert APIClient().post("/api/content-reports/", {"target_listing_id": listing_id, "reason": "OTHER"}, format="json").status_code == 401


@pytest.mark.django_db
def test_a_confirmed_report_hides_the_listing_and_strikes_the_lister(lister, admin, listing_id):
    reporter = User.objects.create(username="mod_reporter2", phone="+237699500004")
    report_id = _report(reporter, listing_id).data["id"]

    resolved = _auth_client(admin).post(f"/api/admin/content-reports/{report_id}/resolve/", {"action_taken": "Fake listing", "issue_strike": True}, format="json")
    assert resolved.status_code == 200

    listing = WarehouseListing.objects.get(pk=listing_id)
    assert listing.removed_by_moderation and listing.availability_status == "UNAVAILABLE"
    assert UserWarning.objects.filter(subject=lister).count() == 1
    assert ContentReport.objects.get(pk=report_id).status == ReportStatus.REVIEWED

    # Gone from the public list and the public detail page, but the lister still sees it.
    assert listing_id not in [row["id"] for row in _auth_client(reporter).get("/api/warehouses/").data["results"]]
    assert _auth_client(reporter).get(f"/api/warehouses/{listing_id}/").status_code == 404
    seen_by_lister = _auth_client(lister).get(f"/api/warehouses/{listing_id}/")
    assert seen_by_lister.status_code == 200 and seen_by_lister.data["removed_by_moderation"] is True

    # The lister cannot bring it back; an admin can.
    assert _auth_client(lister).post(f"/api/warehouses/{listing_id}/set-status/", {"status": "AVAILABLE"}, format="json").status_code == 403
    assert _auth_client(admin).post(f"/api/warehouses/{listing_id}/set-status/", {"status": "AVAILABLE"}, format="json").status_code == 200
    assert WarehouseListing.objects.get(pk=listing_id).removed_by_moderation is False


@pytest.mark.django_db
def test_a_dismissed_report_leaves_the_listing_alone(lister, admin, listing_id):
    reporter = User.objects.create(username="mod_reporter3", phone="+237699500005")
    report_id = _report(reporter, listing_id).data["id"]
    _auth_client(admin).post(f"/api/admin/content-reports/{report_id}/resolve/", {"action_taken": "No violation"}, format="json")
    listing = WarehouseListing.objects.get(pk=listing_id)
    assert not listing.removed_by_moderation and listing.availability_status == "AVAILABLE"
    assert UserWarning.objects.filter(subject=lister).count() == 0
