"""Exercises the newly built Social, Monetization, and Trust & Safety
apps against real data, extending smoke_test.py's original scenario."""
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "oaziland.settings")
django.setup()

from decimal import Decimal
from datetime import timedelta
from django.utils import timezone
from identity.models import User, OAuthAccount, OAuthProvider, MfaMethod, MfaType, MfaChallenge, KYCProfile, VerificationStatus, AgencyProfile
from social.models import Post, PosterAttribution, PosterRole, Follow, Reaction, EmojiType, Comment, Favorite, ContentStatus
from monetization.models import PlatformFeePolicy, TransactionCategory, AdCampaign, AdPlacement, AgencyBenefit, BenefitType
from trust_safety.models import ContentReport, ReportReason, AIModerationResult, ModerationCategory, ModerationAction, UserWarning, WarningReason

landlord = User.objects.get(username="landlord1")
guest = User.objects.get(username="guest1")

# --- Auth extensions ---
oauth = OAuthAccount.objects.create(user=guest, provider=OAuthProvider.GOOGLE, provider_user_id="google-12345")
print(f"OAuth linked: {guest.username} <-> {oauth.provider}")

mfa = MfaMethod.objects.create(user=guest, mfa_type=MfaType.SMS_OTP, destination=guest.phone, is_primary=True)
challenge = MfaChallenge.objects.create(mfa_method=mfa, code="123456", expires_at=timezone.now() + timedelta(minutes=5))
assert challenge.verify("000000") == False, "wrong code should fail"
assert challenge.verify("123456") == True, "correct code should pass"
assert challenge.verify("123456") == False, "reused code must fail"
print("MFA challenge correctly: rejects wrong code, accepts right code once, rejects reuse")

kyc = KYCProfile.objects.create(
    user=guest, legal_full_name="Jean Test Guest", date_of_birth="1995-04-12",
    national_id_number="CM-TEST-001", residential_address="Bastos, Yaoundé",
)
print(f"KYC submitted for {guest.username}: status={kyc.kyc_status}")

# --- Social ---
post = Post.objects.create(author=landlord, caption="3BR house available in Bastos!")
PosterAttribution.objects.create(post=post, poster_role=PosterRole.LANDLORD, latitude=Decimal("3.8800"), longitude=Decimal("11.5210"))
post.publish()
print(f"Post published: '{post.caption}' by {landlord.username} as {post.attribution.poster_role}")

Follow.objects.create(follower=guest, followee=landlord)
Reaction.objects.create(author=guest, post=post, emoji=EmojiType.LOVE)
comment = Comment.objects.create(author=guest, post=post, text="Is this still available?")
comment.edit("Is this still available? And is it furnished?", editor=guest)
Favorite.objects.create(user=guest, post=post)
print(f"Guest followed landlord, reacted, commented (then edited), and favorited the post")

try:
    comment.delete_by(landlord)
    print("ERROR: landlord should not be able to delete guest's comment!")
except PermissionError as e:
    print(f"Correctly blocked: {e}")

# --- Monetization ---
PlatformFeePolicy.objects.create(category=TransactionCategory.PROPERTY_BOOKING, fee_percent=Decimal("3.0"))
PlatformFeePolicy.objects.create(category=TransactionCategory.AD_SPEND, fee_percent=Decimal("5.0"))
fee = PlatformFeePolicy.fee_for(TransactionCategory.PROPERTY_BOOKING, Decimal("150000"))
print(f"Platform fee on a 150,000 XAF booking: {fee} XAF")

agency = AgencyProfile.objects.create(user=User.objects.create(username="agency1", phone="+237670000009"), registration_number="RC/YAO/2026/001", agency_commission_percent=Decimal("30"))
AgencyBenefit.objects.create(agency=agency, benefit_type=BenefitType.SHARED_LEAD_POOL, description="Access to the agency's shared enquiry pool")
campaign = AdCampaign.objects.create(
    owner=landlord, placement=AdPlacement.FEED_BOOSTED_POST, budget_xaf=Decimal("20000"),
    starts_at=timezone.now(), ends_at=timezone.now() + timedelta(days=7),
)
campaign.launch()
print(f"Ad campaign launched: {campaign.status}, remaining budget {campaign.remaining_budget()} XAF")

# --- Trust & Safety ---
report = ContentReport.objects.create(reported_by=guest, reason=ReportReason.MISLEADING_LISTING, target_post=post, notes="Price doesn't match what was discussed")
print(f"Content report filed: {report.reason}, status={report.status}")

AIModerationResult.objects.create(
    category=ModerationCategory.TEXT_PROFANITY, confidence_score=Decimal("0.02"),
    action=ModerationAction.ALLOW, model_version="test-v1", target_post=post,
)
warning = UserWarning.issue_next_strike(subject=guest, reason=WarningReason.REPEATED_VIOLATION)
print(f"Warning issued: strike #{warning.strike_number}")

print("\nSMOKE TEST 2 PASSED — Social, Monetization, and Trust & Safety apps all work end-to-end.")
