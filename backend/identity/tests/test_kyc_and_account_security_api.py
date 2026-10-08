"""
Tests for real gaps this closes: KYCProfile could only ever be created
directly in the database (admin/tests) — no real user had any HTTP way
to submit their own identity information, meaning IsVerifiedAndMfaEnabled
(which checks user_has_submitted_kyc) could never actually be satisfied
by a real user going through the app. Also closes the same gap for the
logged-in change-password flow and the forgot-password reset flow,
which existed fully at the service layer (identity.services) but were
never wired to any reachable URL.
"""
import pytest
from django.conf import settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, KYCProfile, VerificationStatus


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_a_user_can_submit_their_own_kyc_for_the_first_time():
    user = User.objects.create(username="kyc_submit_user", phone="+237699111201")
    client = _auth_client(user)

    assert client.get("/api/auth/kyc/").status_code == 404

    response = client.post("/api/auth/kyc/", {
        "legal_full_name": "Ndi Blaise Fomekong",
        "date_of_birth": "1992-03-14",
        "national_id_number": "CM-KYC-001",
        "residential_address": "Bonapriso, Douala",
        "id_document_front_image_url": "https://example.com/id-front.jpg",
        "id_document_back_image_url": "https://example.com/id-back.jpg",
        "selfie_image_url": "https://example.com/selfie.jpg",
    })

    assert response.status_code == 201
    assert response.data["kyc_status"] == VerificationStatus.PENDING
    assert KYCProfile.objects.filter(user=user, legal_full_name="Ndi Blaise Fomekong").exists()

    fetched = client.get("/api/auth/kyc/")
    assert fetched.status_code == 200
    assert fetched.data["national_id_number"] == "CM-KYC-001"


@pytest.mark.django_db
def test_a_user_can_resubmit_kyc_while_pending_but_not_once_verified():
    user = User.objects.create(username="kyc_resubmit_user", phone="+237699111202")
    KYCProfile.objects.create(
        user=user, legal_full_name="Original Name", date_of_birth="1990-01-01",
        national_id_number="CM-KYC-002", residential_address="Bastos", kyc_status=VerificationStatus.REJECTED,
    )
    client = _auth_client(user)

    resubmit = client.post("/api/auth/kyc/", {
        "legal_full_name": "Corrected Name", "date_of_birth": "1990-01-01",
        "national_id_number": "CM-KYC-002-FIXED", "residential_address": "Bastos, Yaoundé",
        "id_document_front_image_url": "https://example.com/id-front.jpg",
        "id_document_back_image_url": "https://example.com/id-back.jpg",
        "selfie_image_url": "https://example.com/selfie.jpg",
    })
    assert resubmit.status_code == 200
    assert resubmit.data["kyc_status"] == VerificationStatus.PENDING
    assert resubmit.data["legal_full_name"] == "Corrected Name"

    KYCProfile.objects.filter(user=user).update(kyc_status=VerificationStatus.VERIFIED)
    blocked = client.post("/api/auth/kyc/", {
        "legal_full_name": "Should Not Apply", "date_of_birth": "1990-01-01",
        "national_id_number": "CM-KYC-002-FIXED", "residential_address": "Bastos, Yaoundé",
        "id_document_front_image_url": "https://example.com/id-front.jpg",
        "id_document_back_image_url": "https://example.com/id-back.jpg",
        "selfie_image_url": "https://example.com/selfie.jpg",
    })
    assert blocked.status_code == 403


@pytest.mark.django_db
def test_kyc_endpoint_requires_authentication():
    assert APIClient().get("/api/auth/kyc/").status_code == 401


@pytest.mark.django_db
def test_kyc_submission_requires_document_and_selfie_images():
    """A submission with no document photos or selfie at all isn't
    actually verifiable by anyone reviewing it — matching every real
    identity-verification provider's requirement."""
    user = User.objects.create(username="kyc_missing_images_user", phone="+237699111299")
    client = _auth_client(user)

    response = client.post("/api/auth/kyc/", {
        "legal_full_name": "No Images User", "date_of_birth": "1992-03-14",
        "national_id_number": "CM-KYC-099", "residential_address": "Bonapriso, Douala",
    })

    assert response.status_code == 400
    assert "id_document_front_image_url" in response.data
    assert "id_document_back_image_url" in response.data
    assert "selfie_image_url" in response.data


@pytest.mark.django_db
def test_change_password_requires_the_real_current_password():
    user = User.objects.create(username="change_pw_user", phone="+237699111203")
    user.set_password("original_password_123")
    user.save()
    client = _auth_client(user)

    wrong_current = client.post("/api/auth/change-password/", {"current_password": "not_it", "new_password": "brand_new_password_456"})
    assert wrong_current.status_code == 400
    user.refresh_from_db()
    assert user.check_password("original_password_123")

    success = client.post("/api/auth/change-password/", {"current_password": "original_password_123", "new_password": "brand_new_password_456"})
    assert success.status_code == 200
    user.refresh_from_db()
    assert user.check_password("brand_new_password_456")


@pytest.mark.django_db
def test_password_reset_request_and_confirm_are_reachable_over_real_http():
    """The actual gap: request_password_reset()/confirm_password_reset()
    were fully implemented and unit-tested at the service layer, but
    were never wired to any URL — a real person who forgot their
    password had no reachable way to start a reset at all."""
    user = User.objects.create(username="reset_http_user", phone="+237699111204", email="reset_http@example.com")
    user.set_password("old_password_123")
    user.save()

    request_response = APIClient().post("/api/auth/password-reset/request/", {"username": "reset_http_user"})
    assert request_response.status_code == 200

    # Doesn't leak whether the account exists.
    unknown_response = APIClient().post("/api/auth/password-reset/request/", {"username": "no_such_user_at_all"})
    assert unknown_response.status_code == 200
    assert unknown_response.data == request_response.data

    from identity.models import PasswordResetToken
    reset_token = PasswordResetToken.objects.get(user=user)

    confirm_response = APIClient().post("/api/auth/password-reset/confirm/", {
        "token": reset_token.token, "new_password": "brand_new_reset_password_789",
    })
    assert confirm_response.status_code == 200
    user.refresh_from_db()
    assert user.check_password("brand_new_reset_password_789")

    bad_token_response = APIClient().post("/api/auth/password-reset/confirm/", {
        "token": "not-a-real-token", "new_password": "whatever_123456",
    })
    assert bad_token_response.status_code == 400


@pytest.mark.django_db
def test_admin_can_approve_a_pending_kyc_submission():
    """The other real half of the KYC gap: a real user could submit
    KYC (see above), but nothing ever let an admin actually approve or
    reject it — kyc_status could only ever move away from PENDING
    directly in the database."""
    from identity.models import AdminProfile

    admin_user = User.objects.create(username="kyc_review_admin", phone="+237699111210")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    submitter = User.objects.create(username="kyc_review_submitter", phone="+237699111211")
    kyc_profile = KYCProfile.objects.create(
        user=submitter, legal_full_name="Review Me", date_of_birth="1990-01-01",
        national_id_number="CM-KYC-REVIEW-001", residential_address="Akwa, Douala",
    )
    admin_client = _auth_client(admin_user)

    queue = admin_client.get("/api/admin/kyc-reviews/")
    assert queue.status_code == 200
    assert any(row["id"] == kyc_profile.id for row in queue.data["results"])

    approve_response = admin_client.post(f"/api/admin/kyc-reviews/{kyc_profile.id}/approve/")
    assert approve_response.status_code == 200
    assert approve_response.data["kyc_status"] == VerificationStatus.VERIFIED

    kyc_profile.refresh_from_db()
    assert kyc_profile.kyc_status == VerificationStatus.VERIFIED
    assert kyc_profile.reviewed_at is not None

    # Approved submissions drop out of the pending queue.
    queue_after = admin_client.get("/api/admin/kyc-reviews/")
    assert not any(row["id"] == kyc_profile.id for row in queue_after.data["results"])


@pytest.mark.django_db
def test_admin_can_reject_a_pending_kyc_submission():
    from identity.models import AdminProfile

    admin_user = User.objects.create(username="kyc_reject_admin", phone="+237699111212")
    AdminProfile.objects.create(user=admin_user, permissions=[])
    submitter = User.objects.create(username="kyc_reject_submitter", phone="+237699111213")
    kyc_profile = KYCProfile.objects.create(
        user=submitter, legal_full_name="Reject Me", date_of_birth="1990-01-01",
        national_id_number="CM-KYC-REVIEW-002", residential_address="Bonanjo, Douala",
    )
    admin_client = _auth_client(admin_user)

    reject_response = admin_client.post(f"/api/admin/kyc-reviews/{kyc_profile.id}/reject/", {"reason": "Blurry ID photo"})
    assert reject_response.status_code == 200
    assert reject_response.data["kyc_status"] == VerificationStatus.REJECTED

    kyc_profile.refresh_from_db()
    assert kyc_profile.kyc_status == VerificationStatus.REJECTED


@pytest.mark.django_db
def test_non_admin_cannot_review_kyc_submissions():
    stranger = User.objects.create(username="kyc_review_stranger", phone="+237699111214")
    submitter = User.objects.create(username="kyc_review_victim", phone="+237699111215")
    kyc_profile = KYCProfile.objects.create(
        user=submitter, legal_full_name="Not Yours To Approve", date_of_birth="1990-01-01",
        national_id_number="CM-KYC-REVIEW-003", residential_address="Bepanda, Douala",
    )
    response = _auth_client(stranger).post(f"/api/admin/kyc-reviews/{kyc_profile.id}/approve/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_login_endpoint_uses_its_own_dedicated_throttle_scope_not_the_shared_anon_bucket():
    """The real gap this closes: /api/auth/login/ previously used
    simplejwt's bare TokenObtainPairView with no throttle bucket of its
    own — brute-forcing a password shared the SAME global anon budget
    as every other anonymous request on the platform. Verifies the
    actual wiring (view class + throttle scope) rather than fighting
    DRF's settings-caching quirks around DEFAULT_THROTTLE_RATES in
    tests, which don't reliably reflect override_settings mid-test."""
    from django.urls import resolve
    from identity.views import LoginView, LoginThrottle

    resolved = resolve("/api/auth/login/")
    assert resolved.func.view_class is LoginView
    assert LoginView.throttle_classes == [LoginThrottle]
    assert LoginThrottle.scope == "login"
    assert "login" in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]

    # And the endpoint is still genuinely usable for a real login.
    user = User.objects.create(username="login_throttle_wiring_user", phone="+237699111206")
    user.set_password("real_password_123")
    user.save()
    response = APIClient().post("/api/auth/login/", {"username": "login_throttle_wiring_user", "password": "real_password_123"})
    assert response.status_code == 200
    assert "access" in response.data
