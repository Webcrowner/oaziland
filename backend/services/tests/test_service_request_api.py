"""
Tests for the real Service Request API — closing a genuine gap: the
full technician dispatch lifecycle (find, accept, start, complete
with real payment) had real, working logic, but nothing ever exposed
any of it over HTTP.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, TechnicianProfile, KYCProfile, VerificationStatus, MfaMethod
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from services.models import ServiceCategory, ServiceRequest
from services.services import set_technician_specialties
from monetization.models import PlatformFeePolicy, TransactionCategory

LOC = {"latitude": "3.848", "longitude": "11.502"}


def _approved_quote(request_id, requester, technician, amount):
    _auth_client(technician).post(f"/api/service-requests/{request_id}/quote/", {"amount_xaf": amount})
    _auth_client(requester).post(f"/api/service-requests/{request_id}/approve-quote/")
    _auth_client(requester).post(f"/api/service-requests/{request_id}/fund/", {"phone_number": requester.phone})


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _verify(user):
    """Requesting a paid technician job is a real checkout, gated by
    real KYC + MFA same as any other booking."""
    KYCProfile.objects.create(user=user, legal_full_name=user.username, date_of_birth="1990-01-01", national_id_number=f"CM-{user.id}", residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED)
    MfaMethod.objects.create(user=user, mfa_type="SMS_OTP", destination=user.phone, verified=True)
    return user


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_creating_a_service_request(quarter):
    requester = _verify(User.objects.create(username="svc_requester", phone="+237699888801"))
    client = _auth_client(requester)

    response = client.post("/api/service-requests/", {
        "category": ServiceCategory.PLUMBING, "description": "Leaking kitchen pipe.", "quarter": str(quarter.id), "priority": "URGENT",
    })

    assert response.status_code == 201
    assert response.data["status"] == "REQUESTED"
    assert response.data["priority"] == "URGENT"


@pytest.mark.django_db
def test_a_technician_can_discover_and_accept_an_open_request(quarter):
    """The exact same real bug already found in marketplace's ride-
    hailing ViewSet, deliberately avoided here from the start: a
    technician must be able to SEE an open request before they've
    accepted it, or they could never discover work to accept."""
    requester = _verify(User.objects.create(username="svc_accept_requester", phone="+237699888802"))
    technician = User.objects.create(username="svc_accept_technician", phone="+237699888803")
    TechnicianProfile.objects.create(user=technician, is_verified=True, specialties=[ServiceCategory.ELECTRICAL])
    create_response = _auth_client(requester).post("/api/service-requests/", {"category": ServiceCategory.ELECTRICAL, "description": "Rewiring needed.", **LOC})
    request_id = create_response.data["id"]

    technician_view = _auth_client(technician).get("/api/service-requests/")
    assert any(r["id"] == request_id for r in technician_view.data["results"])

    accept_response = _auth_client(technician).post(f"/api/service-requests/{request_id}/accept/")
    assert accept_response.status_code == 200
    assert accept_response.data["status"] == "ACCEPTED"


@pytest.mark.django_db
def test_cannot_accept_a_request_thats_already_accepted():
    requester = _verify(User.objects.create(username="svc_double_requester", phone="+237699888804"))
    tech_a = User.objects.create(username="svc_double_tech_a", phone="+237699888805")
    tech_b = User.objects.create(username="svc_double_tech_b", phone="+237699888806")
    TechnicianProfile.objects.create(user=tech_a, is_verified=True, specialties=[ServiceCategory.PAINTING])
    TechnicianProfile.objects.create(user=tech_b, is_verified=True, specialties=[ServiceCategory.PAINTING])
    create_response = _auth_client(requester).post("/api/service-requests/", {"category": ServiceCategory.PAINTING, "description": "Paint the fence.", **LOC})
    request_id = create_response.data["id"]
    _auth_client(tech_a).post(f"/api/service-requests/{request_id}/accept/")

    second_accept = _auth_client(tech_b).post(f"/api/service-requests/{request_id}/accept/")

    assert second_accept.status_code == 400


@pytest.mark.django_db
def test_only_the_assigned_technician_can_start_the_job():
    requester = _verify(User.objects.create(username="svc_start_requester", phone="+237699888807"))
    technician = User.objects.create(username="svc_start_technician", phone="+237699888808")
    stranger = User.objects.create(username="svc_start_stranger", phone="+237699888809")
    TechnicianProfile.objects.create(user=technician, is_verified=True, specialties=[ServiceCategory.CLEANING])
    create_response = _auth_client(requester).post("/api/service-requests/", {"category": ServiceCategory.CLEANING, "description": "Deep clean.", **LOC})
    request_id = create_response.data["id"]
    _auth_client(technician).post(f"/api/service-requests/{request_id}/accept/")
    _approved_quote(request_id, requester, technician, "8000")

    stranger_response = _auth_client(stranger).post(f"/api/service-requests/{request_id}/start/")
    assert stranger_response.status_code == 403

    real_response = _auth_client(technician).post(f"/api/service-requests/{request_id}/start/")
    assert real_response.status_code == 200
    assert real_response.data["status"] == "IN_PROGRESS"


@pytest.mark.django_db
def test_the_full_real_service_lifecycle_settles_through_the_real_payment_gateway():
    PlatformFeePolicy.objects.get_or_create(category=TransactionCategory.SERVICE_PAYMENT, defaults={"fee_percent": Decimal("4.0")})
    requester = _verify(User.objects.create(username="svc_full_requester", phone="+237699888810"))
    technician = User.objects.create(username="svc_full_technician", phone="+237699888811")
    TechnicianProfile.objects.create(user=technician, is_verified=True, specialties=[ServiceCategory.MOVING])
    create_response = _auth_client(requester).post("/api/service-requests/", {"category": ServiceCategory.MOVING, "description": "Move furniture.", **LOC})
    request_id = create_response.data["id"]
    _auth_client(technician).post(f"/api/service-requests/{request_id}/accept/")
    _approved_quote(request_id, requester, technician, "25000")
    _auth_client(technician).post(f"/api/service-requests/{request_id}/start/")

    complete_response = _auth_client(requester).post(f"/api/service-requests/{request_id}/complete/", {"phone_number": requester.phone})

    assert complete_response.status_code == 200
    assert complete_response.data["status"] == "COMPLETED"
    booking = ServiceRequest.objects.get(id=request_id).booking
    assert booking.amount_xaf == Decimal("25000")  # the approved quote, not a figure typed at payment time


@pytest.mark.django_db
def test_only_the_requester_can_complete_and_pay():
    requester = _verify(User.objects.create(username="svc_pay_requester", phone="+237699888812"))
    technician = User.objects.create(username="svc_pay_technician", phone="+237699888813")
    stranger = User.objects.create(username="svc_pay_stranger", phone="+237699888814")
    TechnicianProfile.objects.create(user=technician, is_verified=True, specialties=[ServiceCategory.SECURITY_INSTALLATION])
    create_response = _auth_client(requester).post("/api/service-requests/", {"category": ServiceCategory.SECURITY_INSTALLATION, "description": "Install cameras.", **LOC})
    request_id = create_response.data["id"]
    _auth_client(technician).post(f"/api/service-requests/{request_id}/accept/")
    _approved_quote(request_id, requester, technician, "10000")
    _auth_client(technician).post(f"/api/service-requests/{request_id}/start/")

    response = _auth_client(stranger).post(f"/api/service-requests/{request_id}/complete/", {"phone_number": stranger.phone})

    assert response.status_code == 403


@pytest.mark.django_db
def test_finding_technicians_by_real_proximity_and_specialty(quarter):
    from services.models import TechnicianLocationPing
    technician = User.objects.create(username="svc_find_technician", phone="+237699888815")
    profile = TechnicianProfile.objects.create(user=technician)
    set_technician_specialties(profile, [ServiceCategory.PLUMBING])
    TechnicianLocationPing.objects.create(technician=technician, latitude=Decimal("3.8480"), longitude=Decimal("11.5021"))

    response = APIClient().post("/api/technicians/find/", {
        "category": ServiceCategory.PLUMBING, "latitude": "3.8480", "longitude": "11.5021", "radius_km": "10",
    })

    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["technician_id"] == str(technician.id)


@pytest.mark.django_db
def test_technician_dashboard_returns_real_data():
    technician = User.objects.create(username="svc_dashboard_technician", phone="+237699888816")
    client = _auth_client(technician)

    response = client.get("/api/my-technician-dashboard/")

    assert response.status_code == 200
    assert "active_job_count" in response.data
    assert "wallet_balance_xaf" in response.data


@pytest.mark.django_db
def test_creating_a_service_request_requires_authentication():
    response = APIClient().post("/api/service-requests/", {"category": ServiceCategory.PLUMBING, "description": "Test"})
    assert response.status_code == 401
