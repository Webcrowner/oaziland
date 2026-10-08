"""Tests for the real /api/my-badges/ endpoint and the badge-award
triggers wired into KYC approval, review creation, and booking
completion — Prompt 15's 'NEW — GamifiedBadge' had a fully built,
unit-tested evaluate_badges_for_user(), but it was ONLY ever called
from tests, never by any real action, and nothing let a user see their
own earned badges."""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, KYCProfile, VerificationStatus, AdminProfile
from engagement.models import BadgeCode


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_my_badges_endpoint_returns_earned_badges():
    user = User.objects.create(username="badges_api_user", phone="+237699998001")
    KYCProfile.objects.create(user=user, legal_full_name="Test User", date_of_birth="1990-01-01", national_id_number="CM-BADGES-API-1", residential_address="Bastos", kyc_status=VerificationStatus.VERIFIED)

    response = _auth_client(user).get("/api/my-badges/")

    assert response.status_code == 200
    codes = [row["badge_code"] for row in response.data["results"]]
    assert BadgeCode.VERIFIED_RENTER in codes


@pytest.mark.django_db
def test_approving_kyc_via_admin_endpoint_awards_verified_renter_badge():
    """Real trigger wiring: approve_kyc() (identity/services.py) now
    calls evaluate_badges_for_user() itself, so a real admin approval
    (not just a direct service call in a test) awards the badge."""
    admin_user = User.objects.create(username="badges_kyc_admin", phone="+237699998002")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    submitter = User.objects.create(username="badges_kyc_submitter", phone="+237699998003")
    kyc_profile = KYCProfile.objects.create(
        user=submitter, legal_full_name="Submit Me", date_of_birth="1990-01-01",
        national_id_number="CM-BADGES-API-2", residential_address="Akwa, Douala",
    )

    approve_response = _auth_client(admin_user).post(f"/api/admin/kyc-reviews/{kyc_profile.id}/approve/")
    assert approve_response.status_code == 200

    assert submitter.badges.filter(badge_code=BadgeCode.VERIFIED_RENTER).exists()
