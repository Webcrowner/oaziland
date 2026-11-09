"""The admin verification queue: context to judge each request, filters, and reviewing it properly."""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from engagement.models import VerificationRequest, VerificationRequestStatus, VerificationRequestType
from identity.models import AdminProfile, KYCProfile, User, VerificationStatus
from marketplace.models import MarketplaceListingBase
from marketplace.tests.test_marketplace_api import _auth_client, _verify, quarter  # noqa: F401
from notifications.models import Notification
from trust_safety.models import AuditLog, UserWarning

URL = "/api/admin/verification-requests/"


@pytest.fixture
def admin(db):
    user = User.objects.create(username="vr_admin", phone="+237699880001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def seller(db):
    return _verify(User.objects.create(username="vr_seller", phone="+237699880002", first_name="Sam", last_name="Seller"))


@pytest.fixture
def car(seller, quarter):
    created = _auth_client(seller).post("/api/cars/", {
        "title": "Toyota Corolla 2012", "description": "Clean car, papers ready", "price_basis": "SALE", "price_xaf": "4000000",
        "quarter": str(quarter.id), "vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2012},
    }, format="json")
    assert created.status_code == 201, created.data
    return MarketplaceListingBase.objects.get(pk=created.data["id"])


def make_request(requester, subject_type, subject_id, *, kind=VerificationRequestType.VEHICLE_OWNERSHIP, doc="https://files.example.com/title.pdf"):
    return VerificationRequest.objects.create(
        requester=requester, request_type=kind, subject_content_type=subject_type, subject_id=subject_id, supporting_document_url=doc,
    )


def browse(admin, **params):
    response = _auth_client(admin).get(URL, params)
    assert response.status_code == 200, response.data
    return response.data


# ---------------------------------------------------------------- context

@pytest.mark.django_db
def test_only_admins_can_see_or_review(seller, car):
    item = make_request(seller, "marketplace.CarListing", car.id)
    assert _auth_client(seller).get(URL).status_code == 403
    assert _auth_client(seller).post(f"{URL}{item.id}/approve/").status_code == 403
    item.refresh_from_db()
    assert item.status == VerificationRequestStatus.PENDING


@pytest.mark.django_db
def test_a_request_shows_the_subject_the_requester_and_the_document(admin, seller, car):
    item = make_request(seller, "marketplace.CarListing", car.id)

    row = browse(admin)["results"][0]

    assert row["id"] == str(item.id) and row["status"] == "PENDING" and row["request_type"] == "VEHICLE_OWNERSHIP"
    assert row["subject"]["title"] == "Toyota Corolla 2012" and row["subject"]["found"] is True
    assert row["subject"]["owner"]["username"] == "vr_seller" and row["subject"]["path"] == f"/marketplace/cars/{car.id}"
    assert row["requester"]["username"] == "vr_seller" and row["requester"]["kyc_status"] in ("NONE", "VERIFIED", "PENDING")
    assert row["requester"]["strikes"] == 0 and row["requester"]["requests_total"] == 1
    assert row["document"] == {"url": "https://files.example.com/title.pdf", "host": "files.example.com"}
    assert "not_owner" not in row["flags"] and "no_document" not in row["flags"] and "insecure_document" not in row["flags"]


@pytest.mark.django_db
def test_warning_flags_are_raised(admin, seller, car):
    other = User.objects.create(username="vr_other", phone="+237699880003")
    UserWarning.objects.create(subject=other, reason="SPAM", strike_number=1)
    stranger_claim = make_request(other, "marketplace.CarListing", car.id, doc="")
    missing = make_request(other, "marketplace.CarListing", uuid.uuid4(), doc="http://plain.example.com/doc.pdf")
    old = make_request(other, "marketplace.CarListing", car.id)
    VerificationRequest.objects.filter(pk=old.pk).update(submitted_at=timezone.now() - timedelta(days=5))
    other.account_status = "SUSPENDED"
    other.save(update_fields=["account_status"])

    rows = {r["id"]: r for r in browse(admin)["results"]}

    claim = rows[str(stranger_claim.id)]["flags"]
    assert {"not_owner", "no_document", "id_not_verified", "has_strikes", "account_restricted"} <= set(claim)
    assert "subject_missing" in rows[str(missing.id)]["flags"] and "insecure_document" in rows[str(missing.id)]["flags"]
    assert "waiting_long" in rows[str(old.id)]["flags"] and "waiting_long" not in claim


@pytest.mark.django_db
def test_a_verified_owner_with_a_document_has_no_warning_flags(admin, seller, car):
    KYCProfile.objects.update_or_create(user=seller, defaults=dict(
        legal_full_name="Sam Seller", date_of_birth="1990-01-01", national_id_number="ID-sam", residential_address="Yaounde",
        kyc_status=VerificationStatus.VERIFIED,
    ))
    make_request(seller, "marketplace.CarListing", car.id)

    assert browse(admin)["results"][0]["flags"] == []


@pytest.mark.django_db
def test_a_person_subject_that_is_someone_else_is_flagged(admin, seller):
    other = User.objects.create(username="vr_victim", phone="+237699880004", first_name="Vic", last_name="Tim")
    make_request(seller, "identity.User", other.id, kind=VerificationRequestType.IDENTITY_VERIFICATION, doc="")

    row = browse(admin)["results"][0]
    assert row["subject"]["kind"] == "user" and row["subject"]["title"] == "Vic Tim" and "not_owner" in row["flags"]


@pytest.mark.django_db
def test_a_previous_rejection_for_the_same_thing_is_flagged(admin, seller, car):
    first = make_request(seller, "marketplace.CarListing", car.id)
    _auth_client(admin).post(f"{URL}{first.id}/reject/", {"reason": "Blurry photo"}, format="json")
    second = make_request(seller, "marketplace.CarListing", car.id)

    row = browse(admin)["results"][0]
    assert row["id"] == str(second.id) and "previously_rejected" in row["flags"]
    assert row["requester"]["requests_total"] == 2 and row["requester"]["requests_rejected"] == 1


@pytest.mark.django_db
def test_other_kinds_of_subject_and_unknown_types_are_described_or_fall_back(admin, seller, quarter):
    from property.models import Listing, ListingType, PropertyAsset
    from social.models import ContentStatus, Post

    asset = PropertyAsset.objects.create(owner=seller, quarter=quarter, type="HOUSE", description="Near the market")
    flat = Listing.objects.create(property_asset=asset, listed_by=seller, listing_type=ListingType.RENT, price_xaf=Decimal("90000"), status="PUBLISHED")
    post = Post.objects.create(author=seller, caption="Our new shop", status=ContentStatus.PUBLISHED)
    make_request(seller, "property.Listing", flat.id, kind=VerificationRequestType.BUSINESS_VERIFICATION)
    make_request(seller, "social.Post", post.id, kind=VerificationRequestType.BUSINESS_VERIFICATION)
    make_request(seller, "weird.Thing", uuid.uuid4(), kind=VerificationRequestType.BUSINESS_VERIFICATION)

    subjects = {r["subject"]["kind"]: r["subject"] for r in browse(admin)["results"]}

    assert subjects["property_listing"]["title"].startswith("House") and subjects["property_listing"]["path"] == f"/listing/{flat.id}"
    assert subjects["post"]["title"] == "Our new shop"
    assert subjects["weird.Thing"]["found"] is False


# ---------------------------------------------------------------- listing

@pytest.mark.django_db
def test_pending_oldest_first_by_default_with_state_type_and_search_filters(admin, seller, car):
    other = User.objects.create(username="vr_odile", phone="+237699880005", first_name="Odile", last_name="Ngo")
    first = make_request(seller, "marketplace.CarListing", car.id)
    second = make_request(other, "marketplace.CarListing", car.id, kind=VerificationRequestType.BUSINESS_VERIFICATION)
    VerificationRequest.objects.filter(pk=first.pk).update(submitted_at=timezone.now() - timedelta(hours=5))
    _auth_client(admin).post(f"{URL}{second.id}/approve/")

    assert [r["id"] for r in browse(admin)["results"]] == [str(first.id)]
    assert [r["id"] for r in browse(admin, state="approved")["results"]] == [str(second.id)]
    assert browse(admin, state="all")["count"] == 2
    assert browse(admin, state="all", type="BUSINESS_VERIFICATION")["count"] == 1
    assert [r["id"] for r in browse(admin, state="all", q="odile")["results"]] == [str(second.id)]
    assert [r["id"] for r in browse(admin, state="all", q="+237699880002")["results"]] == [str(first.id)]
    assert browse(admin, state="all", q="nobody")["count"] == 0


@pytest.mark.django_db
def test_paging(admin, seller, car):
    for _ in range(21):
        make_request(seller, "marketplace.CarListing", car.id)

    page = browse(admin)
    assert page["count"] == 21 and len(page["results"]) == 20 and page["next"]


@pytest.mark.django_db
def test_bad_filters_are_rejected(admin):
    client = _auth_client(admin)
    assert client.get(URL, {"state": "weird"}).status_code == 400
    assert client.get(URL, {"type": "NOPE"}).status_code == 400


@pytest.mark.django_db
def test_a_single_request_can_be_fetched_with_its_context(admin, seller, car):
    item = make_request(seller, "marketplace.CarListing", car.id)

    response = _auth_client(admin).get(f"{URL}{item.id}/")
    assert response.status_code == 200 and response.data["subject"]["title"] == "Toyota Corolla 2012"


# ---------------------------------------------------------------- reviewing

@pytest.mark.django_db
def test_approving_records_the_reviewer_tells_the_requester_and_is_audited(admin, seller, car):
    item = make_request(seller, "marketplace.CarListing", car.id)

    response = _auth_client(admin).post(f"{URL}{item.id}/approve/")

    assert response.status_code == 200 and response.data["status"] == "APPROVED" and response.data["reviewed_by"] == "vr_admin"
    item.refresh_from_db()
    assert item.reviewed_by == admin and item.reviewed_at is not None
    assert Notification.objects.filter(recipient=seller, notification_type="VERIFICATION_APPROVED").count() == 1
    entry = AuditLog.objects.get(action="admin-verification-request/approve")
    assert entry.status_code == 200 and "vr_seller" in entry.target_label
    from engagement.services import is_verified
    assert is_verified(MarketplaceListingBase.objects.get(pk=car.id).carlisting) is True


@pytest.mark.django_db
def test_rejecting_needs_a_reason_stores_it_and_tells_the_requester(admin, seller, car):
    item = make_request(seller, "marketplace.CarListing", car.id)
    client = _auth_client(admin)

    assert client.post(f"{URL}{item.id}/reject/", {}, format="json").status_code == 400
    assert client.post(f"{URL}{item.id}/reject/", {"reason": "   "}, format="json").status_code == 400
    assert client.post(f"{URL}{item.id}/reject/", {"reason": "x" * 301}, format="json").status_code == 400
    item.refresh_from_db()
    assert item.status == VerificationRequestStatus.PENDING and not Notification.objects.filter(recipient=seller).exists()

    response = client.post(f"{URL}{item.id}/reject/", {"reason": "The title is unreadable"}, format="json")
    assert response.status_code == 200 and response.data["rejection_reason"] == "The title is unreadable"
    item.refresh_from_db()
    assert item.status == VerificationRequestStatus.REJECTED and item.rejection_reason == "The title is unreadable"
    assert "unreadable" in Notification.objects.get(recipient=seller, notification_type="VERIFICATION_REJECTED").message
    assert AuditLog.objects.get(action="admin-verification-request/reject", status_code=200).details["reason"] == "The title is unreadable"


@pytest.mark.django_db
def test_a_reviewed_request_cannot_be_reviewed_again(admin, seller, car):
    item = make_request(seller, "marketplace.CarListing", car.id)
    client = _auth_client(admin)
    client.post(f"{URL}{item.id}/approve/")

    assert client.post(f"{URL}{item.id}/approve/").status_code == 400
    assert client.post(f"{URL}{item.id}/reject/", {"reason": "Too late"}, format="json").status_code == 400
    item.refresh_from_db()
    assert item.status == VerificationRequestStatus.APPROVED and item.rejection_reason == ""
    assert Notification.objects.filter(recipient=seller).count() == 1


@pytest.mark.django_db
def test_french_clients_get_a_french_error(admin, seller, car):
    item = make_request(seller, "marketplace.CarListing", car.id)

    response = _auth_client(admin).post(f"{URL}{item.id}/reject/", {}, format="json", HTTP_ACCEPT_LANGUAGE="fr")
    assert response.status_code == 400 and response.json()["detail"] == "Un motif est requis pour rejeter une demande de vérification."
