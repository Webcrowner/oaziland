"""
Tests for the real referral system with persistent promo codes — a
genuine gap this closes: the Referral model existed, but nothing ever
created a real, shareable code, or actually processed a referral,
qualified it, or paid a real reward.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, KYCProfile, VerificationStatus
from identity.services import get_or_create_referral_code
from social.models import Referral, ReferralStatus
from social.services import process_referral_signup, qualify_referral, award_referral_reward, InvalidReferralCodeError


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_referral_code_is_generated_once_and_stays_stable():
    user = User.objects.create(username="referral_code_user", phone="+237699888801")
    code_first_call = get_or_create_referral_code(user)
    code_second_call = get_or_create_referral_code(user)

    assert code_first_call == code_second_call  # a shared link must not silently stop working
    user.refresh_from_db()
    assert user.referral_code == code_first_call


@pytest.mark.django_db
def test_full_referral_lifecycle_signup_to_paid_reward():
    """The literal journey: referrer shares their code, a new user
    signs up with it, completes KYC (qualifying the referral), and the
    referrer actually gets paid — a real wallet credit, not just a
    status flip."""
    referrer = User.objects.create(username="referral_referrer", phone="+237699888802")
    code = get_or_create_referral_code(referrer)

    new_user = User.objects.create(username="referral_new_user", phone="+237699888803")
    referral = process_referral_signup(new_user=new_user, referral_code=code)
    assert referral.status == ReferralStatus.PENDING

    # Not qualified yet — no KYC submitted.
    assert qualify_referral(new_user) is None

    KYCProfile.objects.create(user=new_user, legal_full_name="Referral New User", date_of_birth="1995-01-01", national_id_number="CM-REFERRAL-001", residential_address="Yaoundé")
    qualified = qualify_referral(new_user)
    assert qualified.status == ReferralStatus.QUALIFIED

    from monetization.services import get_or_create_wallet
    wallet_before = get_or_create_wallet(referrer).balance_xaf

    rewarded = award_referral_reward(qualified)
    assert rewarded.status == ReferralStatus.REWARDED
    assert rewarded.reward_earned_xaf == Decimal("2000")

    referrer_wallet = get_or_create_wallet(referrer)
    assert referrer_wallet.balance_xaf == wallet_before + Decimal("2000")


@pytest.mark.django_db
def test_a_referral_is_never_paid_twice():
    referrer = User.objects.create(username="referral_double_pay_referrer", phone="+237699888804")
    code = get_or_create_referral_code(referrer)
    new_user = User.objects.create(username="referral_double_pay_new_user", phone="+237699888805")
    referral = process_referral_signup(new_user=new_user, referral_code=code)

    from monetization.services import get_or_create_wallet
    award_referral_reward(referral)
    wallet_after_first = get_or_create_wallet(referrer).balance_xaf

    award_referral_reward(referral)  # attempted a second time
    wallet_after_second = get_or_create_wallet(referrer).balance_xaf

    assert wallet_after_first == wallet_after_second  # unchanged — no double payment


@pytest.mark.django_db
def test_unknown_referral_code_is_rejected_not_silently_accepted():
    new_user = User.objects.create(username="referral_bad_code_user", phone="+237699888806")
    with pytest.raises(InvalidReferralCodeError):
        process_referral_signup(new_user=new_user, referral_code="NOTAREALCODE")

    assert Referral.objects.filter(referred_user=new_user).exists() is False


@pytest.mark.django_db
def test_a_user_cannot_refer_themselves():
    user = User.objects.create(username="referral_self_referrer", phone="+237699888807")
    code = get_or_create_referral_code(user)
    with pytest.raises(InvalidReferralCodeError):
        process_referral_signup(new_user=user, referral_code=code)


@pytest.mark.django_db
def test_registration_with_a_referral_code_creates_the_referral():
    """The end-to-end journey through the actual registration API."""
    referrer = User.objects.create(username="referral_api_referrer", phone="+237699888808")
    code = get_or_create_referral_code(referrer)

    client = APIClient()
    response = client.post("/api/auth/register/", {
        "username": "referral_api_new_user", "phone": "+237699888809", "password": "a_real_password_123",
        "referral_code": code,
    })
    assert response.status_code == 201
    new_user = User.objects.get(username="referral_api_new_user")
    assert Referral.objects.filter(referrer=referrer, referred_user=new_user).exists()


@pytest.mark.django_db
def test_registration_with_an_invalid_referral_code_still_succeeds():
    """A typo in a referral code is a real, common thing — it must
    never block someone from creating their account."""
    client = APIClient()
    response = client.post("/api/auth/register/", {
        "username": "referral_typo_user", "phone": "+237699888810", "password": "a_real_password_123",
        "referral_code": "TOTALLYWRONG",
    })
    assert response.status_code == 201
    assert User.objects.filter(username="referral_typo_user").exists()


@pytest.mark.django_db
def test_my_referral_code_api_endpoint():
    user = User.objects.create(username="referral_api_code_user", phone="+237699888811")
    client = _auth_client(user)

    response = client.get("/api/auth/my-referral-code/")
    assert response.status_code == 200
    assert len(response.data["referral_code"]) > 0

    # Stable across repeated calls.
    second_response = client.get("/api/auth/my-referral-code/")
    assert second_response.data["referral_code"] == response.data["referral_code"]
