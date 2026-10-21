"""Job-board privacy, safe accept, and the quote / en-route / release / dispute / rating lifecycle."""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus
from services.models import ServiceCategory, ServiceRequest, TechnicianLocationPing
from monetization.models import PlatformFeePolicy, TransactionCategory

LOC = {"latitude": "3.8481234", "longitude": "11.5021234"}


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _requester(name, phone):
    user = User.objects.create(username=name, phone=phone, first_name="Marie", last_name="Ngono")
    KYCProfile.objects.create(
        user=user, legal_full_name=name, date_of_birth="1990-01-01", national_id_number=f"CM-{user.id}",
        residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED,
    )
    return user


def _technician(name, phone, specialties, verified=True):
    user = User.objects.create(username=name, phone=phone)
    TechnicianProfile.objects.create(user=user, is_verified=verified, specialties=specialties)
    return user


def _post_job(requester, category=ServiceCategory.PLUMBING):
    response = _client(requester).post("/api/service-requests/", {"category": category, "description": "Leak", **LOC})
    assert response.status_code == 201, response.data
    return response.data["id"]


@pytest.mark.django_db
def test_job_board_is_limited_to_verified_technicians_in_their_specialty():
    requester = _requester("lc_req1", "+237699777001")
    plumber = _technician("lc_plumber", "+237699777002", [ServiceCategory.PLUMBING])
    painter = _technician("lc_painter", "+237699777003", [ServiceCategory.PAINTING])
    unverified = _technician("lc_unverified", "+237699777004", [ServiceCategory.PLUMBING], verified=False)
    outsider = User.objects.create(username="lc_outsider", phone="+237699777005")
    request_id = _post_job(requester)

    def listed(user):
        return [r["id"] for r in _client(user).get("/api/service-requests/").data["results"]]

    assert request_id in listed(plumber)
    assert request_id not in listed(painter)
    assert request_id not in listed(unverified)
    assert request_id not in listed(outsider)
    assert request_id in listed(requester)

    assert _client(outsider).get(f"/api/service-requests/{request_id}/").status_code == 404
    assert _client(painter).get(f"/api/service-requests/{request_id}/").status_code == 404
    assert _client(plumber).get(f"/api/service-requests/{request_id}/").status_code == 200


@pytest.mark.django_db
def test_job_board_viewers_only_get_approximate_location_and_first_name():
    requester = _requester("lc_req2", "+237699777011")
    plumber = _technician("lc_plumber2", "+237699777012", [ServiceCategory.PLUMBING])
    request_id = _post_job(requester)

    board = _client(plumber).get(f"/api/service-requests/{request_id}/").data
    assert board["latitude"] == "3.85"
    assert board["requester"] is None
    assert board["requester_name"] == "Marie"

    own = _client(requester).get(f"/api/service-requests/{request_id}/").data
    assert own["latitude"].startswith("3.84812")


@pytest.mark.django_db
def test_technician_cannot_accept_a_job_outside_their_specialty():
    requester = _requester("lc_req3", "+237699777021")
    painter = _technician("lc_painter3", "+237699777022", [ServiceCategory.PAINTING])
    request_id = _post_job(requester)

    response = _client(painter).post(f"/api/service-requests/{request_id}/accept/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_a_request_needs_a_location():
    requester = _requester("lc_req4", "+237699777031")
    response = _client(requester).post("/api/service-requests/", {"category": ServiceCategory.PLUMBING, "description": "No location"})
    assert response.status_code == 400


@pytest.mark.django_db
def test_technician_can_release_an_accepted_job_back_to_the_board():
    requester = _requester("lc_req5", "+237699777041")
    plumber = _technician("lc_plumber5", "+237699777042", [ServiceCategory.PLUMBING])
    other = _technician("lc_plumber5b", "+237699777043", [ServiceCategory.PLUMBING])
    request_id = _post_job(requester)
    _client(plumber).post(f"/api/service-requests/{request_id}/accept/")

    assert _client(other).post(f"/api/service-requests/{request_id}/release/").status_code == 403
    response = _client(plumber).post(f"/api/service-requests/{request_id}/release/")

    assert response.status_code == 200
    assert response.data["status"] == "REQUESTED"
    assert response.data["technician"] is None
    assert _client(other).post(f"/api/service-requests/{request_id}/accept/").status_code == 200


@pytest.mark.django_db
def test_en_route_then_the_requester_can_follow_the_technician():
    requester = _requester("lc_req6", "+237699777051")
    plumber = _technician("lc_plumber6", "+237699777052", [ServiceCategory.PLUMBING])
    request_id = _post_job(requester)
    _client(plumber).post(f"/api/service-requests/{request_id}/accept/")

    response = _client(plumber).post(f"/api/service-requests/{request_id}/en-route/", {"latitude": "3.86", "longitude": "11.51"})

    assert response.status_code == 200
    assert response.data["status"] == "EN_ROUTE"
    assert TechnicianLocationPing.objects.filter(technician=plumber).count() == 1
    seen_by_requester = _client(requester).get(f"/api/service-requests/{request_id}/").data
    assert seen_by_requester["technician_location"]["latitude"] == "3.8600000"
    assert _client(plumber).get(f"/api/service-requests/{request_id}/").data["technician_location"] is None


@pytest.mark.django_db
def test_work_cannot_start_or_be_paid_without_an_approved_quote():
    requester = _requester("lc_req7", "+237699777061")
    plumber = _technician("lc_plumber7", "+237699777062", [ServiceCategory.PLUMBING])
    request_id = _post_job(requester)
    _client(plumber).post(f"/api/service-requests/{request_id}/accept/")

    assert _client(plumber).post(f"/api/service-requests/{request_id}/start/").status_code == 400

    assert _client(plumber).post(f"/api/service-requests/{request_id}/quote/", {"amount_xaf": "0"}).status_code == 400
    assert _client(requester).post(f"/api/service-requests/{request_id}/quote/", {"amount_xaf": "5000"}).status_code == 403
    assert _client(plumber).post(f"/api/service-requests/{request_id}/quote/", {"amount_xaf": "12000"}).status_code == 200
    assert _client(plumber).post(f"/api/service-requests/{request_id}/approve-quote/").status_code == 403
    assert _client(requester).post(f"/api/service-requests/{request_id}/approve-quote/").status_code == 200

    # A revised quote must be re-approved.
    _client(plumber).post(f"/api/service-requests/{request_id}/quote/", {"amount_xaf": "15000"})
    assert ServiceRequest.objects.get(id=request_id).quote_approved is False


@pytest.mark.django_db
def test_dispute_by_either_party_and_rating_after_completion():
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.SERVICE_PAYMENT, defaults={"fee_percent": Decimal("4.0")})
    requester = _requester("lc_req8", "+237699777071")
    plumber = _technician("lc_plumber8", "+237699777072", [ServiceCategory.PLUMBING])
    stranger = User.objects.create(username="lc_stranger8", phone="+237699777073")

    disputed_id = _post_job(requester)
    _client(plumber).post(f"/api/service-requests/{disputed_id}/accept/")
    assert _client(stranger).post(f"/api/service-requests/{disputed_id}/dispute/", {"reason": "Not my job"}).status_code == 403
    response = _client(requester).post(f"/api/service-requests/{disputed_id}/dispute/", {"reason": "Technician never showed up"})
    assert response.status_code == 200
    assert response.data["status"] == "DISPUTED"
    assert response.data["dispute_reason"] == "Technician never showed up"

    request_id = _post_job(requester)
    assert _client(requester).post(f"/api/service-requests/{request_id}/rate/", {"score": "5"}).status_code == 400  # not completed yet
    _client(plumber).post(f"/api/service-requests/{request_id}/accept/")
    _client(plumber).post(f"/api/service-requests/{request_id}/quote/", {"amount_xaf": "9000"})
    _client(requester).post(f"/api/service-requests/{request_id}/approve-quote/")
    _client(requester).post(f"/api/service-requests/{request_id}/fund/", {"phone_number": requester.phone})
    _client(plumber).post(f"/api/service-requests/{request_id}/start/")
    _client(requester).post(f"/api/service-requests/{request_id}/complete/", {"phone_number": requester.phone})

    assert _client(plumber).post(f"/api/service-requests/{request_id}/rate/", {"score": "5"}).status_code == 403
    assert _client(requester).post(f"/api/service-requests/{request_id}/rate/", {"score": "4.5"}).status_code == 200
    assert TechnicianProfile.objects.get(user=plumber).avg_rating == Decimal("4.50")


@pytest.mark.django_db
def test_new_job_notifies_matching_verified_technicians_only():
    from notifications.models import Notification
    requester = _requester("lc_req9", "+237699777081")
    plumber = _technician("lc_plumber9", "+237699777082", [ServiceCategory.PLUMBING])
    painter = _technician("lc_painter9", "+237699777083", [ServiceCategory.PAINTING])
    _post_job(requester)

    assert Notification.objects.filter(recipient=plumber, notification_type="SERVICE_REQUEST_NEW").count() == 1
    assert Notification.objects.filter(recipient=painter, notification_type="SERVICE_REQUEST_NEW").count() == 0


@pytest.mark.django_db
def test_registering_as_a_technician_twice_is_a_clean_400():
    user = User.objects.create(username="lc_twice", phone="+237699777091")
    client = _client(user)
    first = client.post("/api/my-technician-profile/", {"specialties": [ServiceCategory.PLUMBING]}, format="json")
    second = client.post("/api/my-technician-profile/", {"specialties": [ServiceCategory.PLUMBING]}, format="json")
    assert first.status_code == 201
    assert second.status_code == 400


@pytest.mark.django_db
def test_public_directory_lists_only_verified_technicians_and_filters_by_specialty():
    _technician("lc_dir_plumber", "+237699777101", [ServiceCategory.PLUMBING])
    _technician("lc_dir_painter", "+237699777102", [ServiceCategory.PAINTING])
    _technician("lc_dir_pending", "+237699777103", [ServiceCategory.PLUMBING], verified=False)

    everyone = APIClient().get("/api/technicians/")
    plumbers = APIClient().get("/api/technicians/", {"specialty": ServiceCategory.PLUMBING})

    assert everyone.status_code == 200
    assert len(everyone.data) == 2
    assert len(plumbers.data) == 1


@pytest.mark.django_db
def test_admin_cannot_verify_a_technician_without_credentials_and_directory_shows_portfolio():
    admin = User.objects.create(username="lc_admin", phone="+237699777111", is_staff=True, is_superuser=True)
    from identity.models import AdminProfile
    AdminProfile.objects.get_or_create(user=admin)
    tech = _technician("lc_docs_tech", "+237699777112", [ServiceCategory.PLUMBING], verified=False)
    profile = TechnicianProfile.objects.get(user=tech)

    blocked = _client(admin).post(f"/api/admin/technicians/{profile.id}/verify/")
    assert blocked.status_code == 400

    assert _client(admin).post("/api/my-technician-documents/", {}).status_code == 405
    assert _client(User.objects.create(username="lc_not_tech", phone="+237699777113")).put(
        "/api/my-technician-documents/", {"credential_urls": [], "portfolio_urls": []}, format="json").status_code == 403
    saved = _client(tech).put("/api/my-technician-documents/", {
        "credential_urls": ["https://example.com/cert.jpg"], "portfolio_urls": ["https://example.com/work.jpg"],
    }, format="json")
    assert saved.status_code == 200
    assert saved.data["credential_urls"] == ["https://example.com/cert.jpg"]

    assert _client(admin).post(f"/api/admin/technicians/{profile.id}/verify/").status_code == 200
    listing = APIClient().get("/api/technicians/").data
    assert listing[0]["portfolio_urls"] == ["https://example.com/work.jpg"]


@pytest.mark.django_db
def test_itemized_quote_sums_to_the_total_and_a_receipt_is_issued_to_the_parties_only():
    PlatformFeePolicy.objects.update_or_create(category=TransactionCategory.SERVICE_PAYMENT, defaults={"fee_percent": Decimal("4.0")})
    requester = _requester("lc_req12", "+237699777121")
    plumber = _technician("lc_plumber12", "+237699777122", [ServiceCategory.PLUMBING])
    stranger = User.objects.create(username="lc_stranger12", phone="+237699777123")
    request_id = _post_job(requester)
    _client(plumber).post(f"/api/service-requests/{request_id}/accept/")

    assert _client(plumber).post(f"/api/service-requests/{request_id}/quote/", {"materials_xaf": "500"}).status_code == 400
    quoted = _client(plumber).post(f"/api/service-requests/{request_id}/quote/", {"labor_xaf": "8000", "materials_xaf": "2000"})
    assert quoted.status_code == 200
    assert quoted.data["quoted_amount_xaf"] == "10000.00"
    assert quoted.data["quoted_materials_xaf"] == "2000.00"

    assert _client(requester).get(f"/api/service-requests/{request_id}/receipt/").status_code == 404  # not completed yet
    _client(requester).post(f"/api/service-requests/{request_id}/approve-quote/")
    _client(requester).post(f"/api/service-requests/{request_id}/fund/", {"phone_number": requester.phone})
    _client(plumber).post(f"/api/service-requests/{request_id}/start/")
    _client(requester).post(f"/api/service-requests/{request_id}/complete/", {"phone_number": requester.phone})

    receipt = _client(requester).get(f"/api/service-requests/{request_id}/receipt/")
    assert receipt.status_code == 200
    assert receipt.data["total_xaf"] == Decimal("10000.00")
    assert receipt.data["labor_xaf"] == Decimal("8000.00")
    assert receipt.data["platform_fee_xaf"] == Decimal("400.00")
    assert _client(plumber).get(f"/api/service-requests/{request_id}/receipt/").status_code == 200
    assert _client(stranger).get(f"/api/service-requests/{request_id}/receipt/").status_code == 404


@pytest.mark.django_db
def test_job_chat_is_private_to_the_two_parties_and_notifies_the_other_side():
    from notifications.models import Notification
    requester = _requester("lc_req13", "+237699777131")
    plumber = _technician("lc_plumber13", "+237699777132", [ServiceCategory.PLUMBING])
    stranger = User.objects.create(username="lc_stranger13", phone="+237699777133")
    request_id = _post_job(requester)

    # No technician yet: the requester can write notes-to-self-style, but outsiders can't read or write.
    assert _client(stranger).get(f"/api/service-requests/{request_id}/messages/").status_code == 404
    _client(plumber).post(f"/api/service-requests/{request_id}/accept/")

    sent = _client(requester).post(f"/api/service-requests/{request_id}/messages/", {"text": "Gate code is 1234"})
    assert sent.status_code == 201
    reply = _client(plumber).post(f"/api/service-requests/{request_id}/messages/", {"text": "On it, thanks"})
    assert reply.status_code == 201

    thread = _client(requester).get(f"/api/service-requests/{request_id}/messages/").data
    assert [m["text"] for m in thread] == ["Gate code is 1234", "On it, thanks"]
    assert _client(stranger).post(f"/api/service-requests/{request_id}/messages/", {"text": "hi"}).status_code == 404
    assert Notification.objects.filter(recipient=plumber, notification_type="SERVICE_REQUEST_MESSAGE").count() == 1


@pytest.mark.django_db
def test_rescheduling_rules_and_scheduled_creation():
    from datetime import timedelta
    from django.utils import timezone
    requester = _requester("lc_req14", "+237699777141")
    plumber = _technician("lc_plumber14", "+237699777142", [ServiceCategory.PLUMBING])
    other = _technician("lc_plumber14b", "+237699777143", [ServiceCategory.PLUMBING])
    later = (timezone.now() + timedelta(days=2)).isoformat()
    earlier = (timezone.now() - timedelta(days=1)).isoformat()

    created = _client(requester).post("/api/service-requests/", {
        "category": ServiceCategory.PLUMBING, "description": "Leak", "scheduled_for": later, **LOC,
    })
    assert created.status_code == 201
    assert created.data["scheduled_for"] is not None
    request_id = created.data["id"]

    assert _client(plumber).post(f"/api/service-requests/{request_id}/reschedule/", {"scheduled_for": later}).status_code == 403  # not on the job yet
    _client(plumber).post(f"/api/service-requests/{request_id}/accept/")
    assert _client(other).post(f"/api/service-requests/{request_id}/reschedule/", {"scheduled_for": later}).status_code == 403
    assert _client(requester).post(f"/api/service-requests/{request_id}/reschedule/", {"scheduled_for": earlier}).status_code == 400
    assert _client(plumber).post(f"/api/service-requests/{request_id}/reschedule/", {"scheduled_for": later}).status_code == 200
