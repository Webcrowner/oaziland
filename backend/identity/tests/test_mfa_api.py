"""
Tests for the real MFA setup/verify HTTP endpoints — closing a
previously critical gap where issue_mfa_challenge() and MfaChallenge.
verify() existed and were tested at the service layer, but NO API
endpoint ever exposed them, meaning no real user could ever actually
satisfy IsVerifiedAndMfaEnabled, enforced everywhere sensitive.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, MfaMethod, MfaChallenge
from notifications.models import Notification


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_full_mfa_setup_and_verify_flow():
    """The literal end-to-end journey: a user with no MFA at all sets
    one up, receives a real code, submits it, and is genuinely marked
    verified — the exact state IsVerifiedAndMfaEnabled checks."""
    user = User.objects.create(username="mfa_flow_user", phone="+237699666601")
    client = _auth_client(user)

    status_before = client.get("/api/auth/mfa/status/")
    assert status_before.data["mfa_enabled"] is False

    setup_response = client.post("/api/auth/mfa/setup/", {"mfa_type": "SMS_OTP", "destination": "+237699666601"})
    assert setup_response.status_code == 201
    challenge_id = setup_response.data["challenge_id"]

    # The real code was actually sent via the notification system.
    notification = Notification.objects.get(recipient=user, notification_type="MFA_CODE")
    real_code = MfaChallenge.objects.get(id=challenge_id).code
    assert real_code in notification.message

    verify_response = client.post("/api/auth/mfa/verify/", {"challenge_id": challenge_id, "code": real_code})
    assert verify_response.status_code == 200
    assert verify_response.data["mfa_enabled"] is True

    status_after = client.get("/api/auth/mfa/status/")
    assert status_after.data["mfa_enabled"] is True


@pytest.mark.django_db
def test_wrong_code_is_rejected_and_does_not_verify():
    user = User.objects.create(username="mfa_wrong_code_user", phone="+237699666602")
    client = _auth_client(user)

    setup_response = client.post("/api/auth/mfa/setup/", {"mfa_type": "SMS_OTP", "destination": "+237699666602"})
    challenge_id = setup_response.data["challenge_id"]

    wrong_response = client.post("/api/auth/mfa/verify/", {"challenge_id": challenge_id, "code": "000000"})
    assert wrong_response.status_code == 400

    method_id = setup_response.data["mfa_method_id"]
    assert MfaMethod.objects.get(id=method_id).verified is False


@pytest.mark.django_db
def test_a_used_code_cannot_be_replayed():
    user = User.objects.create(username="mfa_replay_user", phone="+237699666603")
    client = _auth_client(user)

    setup_response = client.post("/api/auth/mfa/setup/", {"mfa_type": "EMAIL_OTP", "destination": "replay@example.com"})
    challenge_id = setup_response.data["challenge_id"]
    real_code = MfaChallenge.objects.get(id=challenge_id).code

    first_attempt = client.post("/api/auth/mfa/verify/", {"challenge_id": challenge_id, "code": real_code})
    assert first_attempt.status_code == 200

    second_attempt = client.post("/api/auth/mfa/verify/", {"challenge_id": challenge_id, "code": real_code})
    assert second_attempt.status_code == 400


@pytest.mark.django_db
def test_completing_mfa_actually_unblocks_the_sensitive_action():
    """The real proof this closes the gap: before MFA, listing a
    property is genuinely blocked; after completing the real flow
    above, it genuinely isn't."""
    from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
    from identity.models import KYCProfile, VerificationStatus
    from property.models import House

    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Bastos District")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos")
    quarter = Quarter.objects.create(village_or_district=village, name="Bastos")

    user = User.objects.create(username="mfa_unblock_user", phone="+237699666604")
    KYCProfile.objects.create(user=user, legal_full_name="MFA Test User", date_of_birth="1990-01-01", national_id_number="CM-MFA-001", residential_address="Yaoundé", kyc_status=VerificationStatus.VERIFIED)
    house = House.objects.create(owner=user, quarter=quarter, type="HOUSE")
    client = _auth_client(user)

    before_response = client.post("/api/listings/", {"property_asset_id": str(house.id), "listing_type": "RENT", "price_xaf": "50000"})
    assert before_response.status_code == 403

    setup_response = client.post("/api/auth/mfa/setup/", {"mfa_type": "SMS_OTP", "destination": "+237699666604"})
    real_code = MfaChallenge.objects.get(id=setup_response.data["challenge_id"]).code
    client.post("/api/auth/mfa/verify/", {"challenge_id": setup_response.data["challenge_id"], "code": real_code})

    after_response = client.post("/api/listings/", {"property_asset_id": str(house.id), "listing_type": "RENT", "price_xaf": "50000"})
    assert after_response.status_code == 201
    assert after_response.data["lister_display_name"] == "MFA Test User" or after_response.data["lister_role"] == "OWNER"


@pytest.mark.django_db
def test_mfa_setup_requires_authentication():
    client = APIClient()
    response = client.post("/api/auth/mfa/setup/", {"mfa_type": "SMS_OTP", "destination": "+237699666605"})
    assert response.status_code == 401


@pytest.mark.django_db
def test_cannot_verify_another_users_challenge():
    """A challenge belongs to whoever set it up — someone else guessing
    or obtaining a challenge_id must not be able to verify it."""
    user_a = User.objects.create(username="mfa_owner_user", phone="+237699666606")
    user_b = User.objects.create(username="mfa_intruder_user", phone="+237699666607")

    setup_response = _auth_client(user_a).post("/api/auth/mfa/setup/", {"mfa_type": "SMS_OTP", "destination": "+237699666606"})
    challenge_id = setup_response.data["challenge_id"]
    real_code = MfaChallenge.objects.get(id=challenge_id).code

    intruder_response = _auth_client(user_b).post("/api/auth/mfa/verify/", {"challenge_id": challenge_id, "code": real_code})
    assert intruder_response.status_code == 404
