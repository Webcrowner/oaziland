"""Provider verification: users submit requests for their own standing, hostels and guest houses; admins review
them with context; approval has a visible effect; caterers are verified by the team."""
import uuid
from decimal import Decimal

import pytest

from engagement.models import VerificationRequest, VerificationRequestStatus, VerificationRequestType
from events.models import Caterer
from identity.models import AdminProfile, AgencyProfile, AgentProfile, LandlordProfile, User
from marketplace.tests.test_marketplace_api import _auth_client, _verify, quarter  # noqa: F401
from notifications.models import Notification
from property.models import BadgeStatus, BadgeType, GuestHouseLodge, PropertyAsset, VerificationBadge
from student_hostels.models import HostelPropertyType, OwnerProfile, OwnerType
from student_hostels.services import create_student_hostel
from trust_safety.models import AuditLog

MINE = "/api/verification-requests/"
ADMIN_URL = "/api/admin/verification-requests/"
DOC = "https://files.example.com/licence.pdf"


@pytest.fixture
def admin(db):
    user = User.objects.create(username="pv_admin", phone="+237699890001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def agency_owner(db):
    user = _verify(User.objects.create(username="pv_agency", phone="+237699890002", first_name="Ada", last_name="Agency"))
    AgencyProfile.objects.create(user=user, registration_number="RC-YDE-2024-001", agency_commission_percent=Decimal("5.00"))
    return user


@pytest.fixture
def agent(db, agency_owner):
    user = _verify(User.objects.create(username="pv_agent", phone="+237699890003", first_name="Ali", last_name="Agent"))
    AgentProfile.objects.create(user=user, agency=agency_owner.agency_profile, agent_commission_percent=Decimal("2.50"))
    return user


@pytest.fixture
def hostel_owner(db, quarter):
    user = _verify(User.objects.create(username="pv_hostel", phone="+237699890004", first_name="Hugo", last_name="Hostel"))
    profile = OwnerProfile.objects.create(account_user=user, owner_type=OwnerType.LANDLORD)
    hostel = create_student_hostel(owner_profile=profile, quarter=quarter, property_type=HostelPropertyType.BLOCK)
    return user, hostel


@pytest.fixture
def guest_house(db, quarter):
    owner = _verify(User.objects.create(username="pv_guest", phone="+237699890005", first_name="Gina", last_name="Guest"))
    house = GuestHouseLodge.objects.create(owner=owner, quarter=quarter, type="GUEST_HOUSE", description="Sea view rooms in Kribi")
    return owner, house


def submit(user, request_type, subject_id=None, doc=DOC):
    body = {"request_type": request_type, "supporting_document_url": doc}
    if subject_id:
        body["subject_id"] = str(subject_id)
    return _auth_client(user).post(MINE, body, format="json")


def queue(admin, **params):
    response = _auth_client(admin).get(ADMIN_URL, params)
    assert response.status_code == 200, response.data
    return {row["request_type"]: row for row in response.data["results"]}


# ---------------------------------------------------------------- submitting

@pytest.mark.django_db
def test_signing_in_is_required():
    from rest_framework.test import APIClient
    assert APIClient().get(MINE).status_code == 401
    assert APIClient().post(MINE, {}, format="json").status_code == 401


@pytest.mark.django_db
def test_an_agency_can_ask_to_be_verified_and_admins_are_alerted(admin, agency_owner):
    response = submit(agency_owner, "AGENCY_VERIFICATION")

    assert response.status_code == 201, response.data
    item = VerificationRequest.objects.get(pk=response.data["id"])
    assert item.requester == agency_owner and item.subject_content_type == "identity.User" and item.subject_id == agency_owner.pk
    assert item.supporting_document_url == DOC and item.status == "PENDING"
    assert Notification.objects.filter(recipient=admin, notification_type="VERIFICATION_REQUESTED").count() == 1


@pytest.mark.django_db
def test_agents_and_landlords_need_the_matching_account(agent):
    assert submit(agent, "AGENT_VERIFICATION").status_code == 201
    assert submit(agent, "LANDLORD_VERIFICATION").status_code == 400
    assert submit(agent, "AGENCY_VERIFICATION").status_code == 400
    LandlordProfile.objects.create(user=agent)
    assert submit(agent, "LANDLORD_VERIFICATION").status_code == 201


@pytest.mark.django_db
def test_hostel_and_guest_house_owners_can_ask_for_their_own_only(hostel_owner, guest_house):
    owner, hostel = hostel_owner
    gh_owner, house = guest_house

    assert submit(owner, "HOSTEL_VERIFICATION", hostel.pk).status_code == 201
    assert submit(gh_owner, "GUEST_HOUSE_VERIFICATION", house.pk).status_code == 201
    assert submit(gh_owner, "HOSTEL_VERIFICATION", hostel.pk).status_code == 400  # someone else's hostel
    assert submit(owner, "GUEST_HOUSE_VERIFICATION", house.pk).status_code == 400  # someone else's guest house
    assert submit(owner, "HOSTEL_VERIFICATION", uuid.uuid4()).status_code == 400
    assert submit(owner, "HOSTEL_VERIFICATION").status_code == 400  # no subject
    assert VerificationRequest.objects.count() == 2


@pytest.mark.django_db
def test_a_document_is_required_and_must_be_a_secure_link(agency_owner):
    assert submit(agency_owner, "AGENCY_VERIFICATION", doc="").status_code == 400
    assert submit(agency_owner, "AGENCY_VERIFICATION", doc="http://plain.example.com/a.pdf").status_code == 400
    assert submit(agency_owner, "AGENCY_VERIFICATION", doc="not a link").status_code == 400
    assert submit(agency_owner, "AGENCY_VERIFICATION", doc="https://x.example.com/" + "a" * 250).status_code == 400
    assert not VerificationRequest.objects.exists()


@pytest.mark.django_db
def test_a_file_from_the_platforms_own_upload_is_accepted_even_over_http(admin, agency_owner, settings):
    settings.BACKEND_BASE_URL = "http://localhost:8000"
    assert submit(agency_owner, "AGENCY_VERIFICATION", doc="http://localhost:8000/media/verification/abc.jpg").status_code == 201
    assert "insecure_document" not in queue(admin)["AGENCY_VERIFICATION"]["flags"]
    LandlordProfile.objects.create(user=agency_owner)
    assert submit(agency_owner, "LANDLORD_VERIFICATION", doc="http://localhost:8000/other/abc.jpg").status_code == 400
    assert submit(agency_owner, "LANDLORD_VERIFICATION", doc="http://elsewhere.example.com/media/abc.jpg").status_code == 400


@pytest.mark.django_db
def test_unknown_types_and_identity_are_refused(agency_owner):
    assert submit(agency_owner, "NONSENSE").status_code == 400
    assert submit(agency_owner, "IDENTITY_VERIFICATION", agency_owner.pk).status_code == 400
    assert _auth_client(agency_owner).post(MINE, {"request_type": "HOSTEL_VERIFICATION", "subject_id": "nope", "supporting_document_url": DOC}, format="json").status_code == 400


@pytest.mark.django_db
def test_no_second_open_request_and_no_request_once_verified_but_a_rejected_one_can_be_resubmitted(admin, agency_owner):
    first = submit(agency_owner, "AGENCY_VERIFICATION")
    assert submit(agency_owner, "AGENCY_VERIFICATION").status_code == 400

    _auth_client(admin).post(f"{ADMIN_URL}{first.data['id']}/reject/", {"reason": "Blurry scan"}, format="json")
    again = submit(agency_owner, "AGENCY_VERIFICATION")
    assert again.status_code == 201

    _auth_client(admin).post(f"{ADMIN_URL}{again.data['id']}/approve/")
    assert submit(agency_owner, "AGENCY_VERIFICATION").status_code == 400


@pytest.mark.django_db
def test_business_and_car_listings_must_be_the_requesters_own(agency_owner, quarter):
    other = _verify(User.objects.create(username="pv_seller", phone="+237699890006"))
    created = _auth_client(other).post("/api/cars/", {
        "title": "Toyota Corolla", "description": "Clean", "price_basis": "SALE", "price_xaf": "4000000",
        "quarter": str(quarter.id), "vehicle_spec": {"make": "Toyota", "model": "Corolla", "year": 2012},
    }, format="json")
    assert created.status_code == 201, created.data

    assert submit(agency_owner, "VEHICLE_OWNERSHIP", created.data["id"]).status_code == 400
    assert submit(other, "VEHICLE_OWNERSHIP", created.data["id"]).status_code == 201
    assert submit(other, "BUSINESS_VERIFICATION", created.data["id"]).status_code == 400  # a car is not a business


@pytest.mark.django_db
def test_the_user_is_offered_what_they_can_verify_with_its_status(admin, agency_owner, quarter):
    house = GuestHouseLodge.objects.create(owner=agency_owner, quarter=quarter, type="GUEST_HOUSE")
    submit(agency_owner, "AGENCY_VERIFICATION")

    options = {o["request_type"]: o for o in _auth_client(agency_owner).get(MINE).data["options"]}

    assert set(options) == {"AGENCY_VERIFICATION", "GUEST_HOUSE_VERIFICATION"}
    assert options["AGENCY_VERIFICATION"]["status"] == "PENDING" and options["AGENCY_VERIFICATION"]["subject_id"] == str(agency_owner.pk)
    assert options["GUEST_HOUSE_VERIFICATION"]["status"] == "" and options["GUEST_HOUSE_VERIFICATION"]["subject_id"] == str(house.pk)


@pytest.mark.django_db
def test_a_user_sees_only_their_own_requests_with_the_decision(admin, agency_owner, agent):
    mine = submit(agency_owner, "AGENCY_VERIFICATION")
    submit(agent, "AGENT_VERIFICATION")
    _auth_client(admin).post(f"{ADMIN_URL}{mine.data['id']}/reject/", {"reason": "Registration number is unreadable"}, format="json")

    rows = _auth_client(agency_owner).get(MINE).data["results"]

    assert len(rows) == 1 and rows[0]["status"] == "REJECTED" and rows[0]["rejection_reason"] == "Registration number is unreadable"
    assert rows[0]["subject"]["kind"] == "user"


# ---------------------------------------------------------------- admin context and effects

@pytest.mark.django_db
def test_the_admin_sees_role_details_and_the_right_flags(admin, agency_owner, agent):
    submit(agency_owner, "AGENCY_VERIFICATION")
    submit(agent, "AGENT_VERIFICATION")

    rows = queue(admin)

    agency = rows["AGENCY_VERIFICATION"]
    assert agency["subject"]["facts"]["registration_number"] == "RC-YDE-2024-001" and agency["subject"]["facts"]["agents"] == 1
    assert agency["subject"]["owner"]["username"] == "pv_agency" and "role_missing" not in agency["flags"]
    person = rows["AGENT_VERIFICATION"]
    assert person["subject"]["facts"] == {"agency": "Ada Agency", "commission_percent": "2.50"}


@pytest.mark.django_db
def test_a_role_that_was_removed_is_flagged(admin, agent):
    submit(agent, "AGENT_VERIFICATION")
    agent.agent_profile.delete()

    assert "role_missing" in queue(admin)["AGENT_VERIFICATION"]["flags"]


@pytest.mark.django_db
def test_hostels_and_guest_houses_are_described_with_their_pages(admin, hostel_owner, guest_house):
    owner, hostel = hostel_owner
    gh_owner, house = guest_house
    submit(owner, "HOSTEL_VERIFICATION", hostel.pk)
    submit(gh_owner, "GUEST_HOUSE_VERIFICATION", house.pk)

    rows = queue(admin)

    assert rows["HOSTEL_VERIFICATION"]["subject"]["kind"] == "student_hostel"
    assert rows["HOSTEL_VERIFICATION"]["subject"]["path"] == f"/student-hostels/{hostel.pk}"
    assert rows["HOSTEL_VERIFICATION"]["subject"]["owner"]["username"] == "pv_hostel"
    assert rows["GUEST_HOUSE_VERIFICATION"]["subject"]["kind"] == "guest_house"
    assert rows["GUEST_HOUSE_VERIFICATION"]["subject"]["path"] == f"/guest-houses/{house.pk}"
    assert "not_owner" not in rows["HOSTEL_VERIFICATION"]["flags"]


@pytest.mark.django_db
def test_approving_a_hostel_or_guest_house_gives_it_a_verified_badge(admin, hostel_owner, guest_house):
    owner, hostel = hostel_owner
    gh_owner, house = guest_house
    one = submit(owner, "HOSTEL_VERIFICATION", hostel.pk)
    two = submit(gh_owner, "GUEST_HOUSE_VERIFICATION", house.pk)

    assert _auth_client(admin).post(f"{ADMIN_URL}{one.data['id']}/approve/").status_code == 200
    assert _auth_client(admin).post(f"{ADMIN_URL}{two.data['id']}/approve/").status_code == 200

    for asset in (hostel, house):
        badge = VerificationBadge.objects.get(property_asset_id=asset.pk, badge_type=BadgeType.VERIFIED_DOCUMENT)
        assert badge.status == BadgeStatus.VERIFIED and badge.verified_by == admin and badge.verified_at is not None


@pytest.mark.django_db
def test_rejecting_a_hostel_leaves_no_badge(admin, hostel_owner):
    owner, hostel = hostel_owner
    item = submit(owner, "HOSTEL_VERIFICATION", hostel.pk)

    _auth_client(admin).post(f"{ADMIN_URL}{item.data['id']}/reject/", {"reason": "Not a licence"}, format="json")

    assert not VerificationBadge.objects.filter(property_asset_id=hostel.pk).exists()


@pytest.mark.django_db
def test_approving_when_the_hostel_was_deleted_is_refused_and_changes_nothing(admin, hostel_owner):
    owner, hostel = hostel_owner
    item = submit(owner, "HOSTEL_VERIFICATION", hostel.pk)
    PropertyAsset.objects.filter(pk=hostel.pk).delete()

    response = _auth_client(admin).post(f"{ADMIN_URL}{item.data['id']}/approve/")

    assert response.status_code == 400
    assert VerificationRequest.objects.get(pk=item.data["id"]).status == VerificationRequestStatus.PENDING


@pytest.mark.django_db
def test_approved_roles_appear_on_the_public_profile(admin, agency_owner, agent):
    from rest_framework.test import APIClient
    first = submit(agency_owner, "AGENCY_VERIFICATION")
    submit(agency_owner, "AGENT_VERIFICATION")  # not an agent: refused above, so nothing here
    pending_only = APIClient().get(f"/api/users/{agency_owner.pk}/index/")

    _auth_client(admin).post(f"{ADMIN_URL}{first.data['id']}/approve/")
    after = APIClient().get(f"/api/users/{agency_owner.pk}/index/")

    assert pending_only.status_code == 200 and pending_only.data["verified_roles"] == []
    assert after.data["verified_roles"] == ["agency"]
    assert APIClient().get(f"/api/users/{agent.pk}/index/").data["verified_roles"] == []


# ---------------------------------------------------------------- caterers

@pytest.fixture
def caterers(db):
    return (
        Caterer.objects.create(name="Chez Marie", cuisine_type="Cameroonian", price_per_head_min_xaf=Decimal("5000"), price_per_head_max_xaf=Decimal("7000")),
        Caterer.objects.create(name="Grill House", cuisine_type="Barbecue", price_per_head_min_xaf=Decimal("3000"), price_per_head_max_xaf=Decimal("4000"), verified=True),
    )


@pytest.mark.django_db
def test_caterer_admin_is_admin_only(caterers, agency_owner):
    assert _auth_client(agency_owner).get("/api/admin/caterers/").status_code == 403
    assert _auth_client(agency_owner).post(f"/api/admin/caterers/{caterers[0].pk}/verify/").status_code == 403
    caterers[0].refresh_from_db()
    assert caterers[0].verified is False


@pytest.mark.django_db
def test_caterers_can_be_listed_filtered_verified_and_unverified(admin, caterers):
    pending, verified = caterers
    client = _auth_client(admin)

    assert [r["name"] for r in client.get("/api/admin/caterers/").data["results"]] == ["Chez Marie"]
    assert [r["name"] for r in client.get("/api/admin/caterers/?state=verified").data["results"]] == ["Grill House"]
    assert client.get("/api/admin/caterers/?state=all").data["count"] == 2
    assert [r["name"] for r in client.get("/api/admin/caterers/?state=all&q=barbecue").data["results"]] == ["Grill House"]
    assert client.get("/api/admin/caterers/?state=weird").status_code == 400

    assert client.post(f"/api/admin/caterers/{pending.pk}/verify/").data["verified"] is True
    assert client.post(f"/api/admin/caterers/{pending.pk}/verify/").status_code == 400
    assert client.post(f"/api/admin/caterers/{verified.pk}/unverify/").data["verified"] is False
    assert client.post(f"/api/admin/caterers/{verified.pk}/unverify/").status_code == 400
    assert AuditLog.objects.filter(action="admin-caterer/verify", status_code=200, target_label="Chez Marie").exists()
    assert AuditLog.objects.filter(action="admin-caterer/unverify", status_code=200).exists()
