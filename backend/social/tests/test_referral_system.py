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
def test_my_referrals_list_api_endpoint():
    referrer = User.objects.create(username="referral_list_api_referrer", phone="+237699888812")
    code = get_or_create_referral_code(referrer)
    new_user1 = User.objects.create(username="ref_user_1", phone="+237699888813", first_name="User One")
    new_user2 = User.objects.create(username="ref_user_2", phone="+237699888814", first_name="User Two")

    ref1 = process_referral_signup(new_user=new_user1, referral_code=code)
    ref2 = process_referral_signup(new_user=new_user2, referral_code=code)

    client = _auth_client(referrer)
    resp = client.get("/api/my-referrals/")
    assert resp.status_code == 200
    assert resp.data["total_count"] == 2
    assert resp.data["qualified_count"] == 0
    assert resp.data["rewarded_count"] == 0
    assert resp.data["total_reward_xaf"] == 0
    assert len(resp.data["results"]) == 2
    assert resp.data["results"][0]["referred_username"] in ("ref_user_1", "ref_user_2")

    # Now verify KYC approval flow triggers automatic qualification and reward
    from identity.services import approve_kyc
    kyc1 = KYCProfile.objects.create(
        user=new_user1, legal_full_name="User One", date_of_birth="1995-01-01",
        national_id_number="CM-REF-001", residential_address="Bastos",
    )
    approve_kyc(kyc1)

    resp_after = client.get("/api/my-referrals/")
    assert resp_after.data["qualified_count"] == 1
    assert resp_after.data["rewarded_count"] == 1
    assert resp_after.data["total_reward_xaf"] == Decimal("2000")
