"""
identity.services — the enforcement rules that make MFA and KYC actually
mean something.

WHY this file exists: having MfaMethod and KYCProfile as database models
does nothing on its own — nothing stops a user without either from
listing a property or paying for a booking unless something actively
checks for them at the right moment. This file is that check, written
ONCE here so every part of the app (web, mobile, admin) enforces the
same rule the same way, instead of each feature re-implementing (and
possibly getting wrong) its own version of "is this user allowed to do
sensitive things yet."
"""


class MfaRequiredError(Exception):
    """Raised when a user tries to do something sensitive (list a
    property, make a payment) without having set up MFA yet."""


class KycNotSubmittedError(Exception):
    """Raised when a user tries to complete registration without having
    at least submitted their KYC information (it doesn't need to be
    APPROVED yet — just submitted)."""


def approve_kyc(kyc_profile):
    """The real gap this closes: a submitted KYCProfile could sit at
    kyc_status=PENDING forever — nothing anywhere (not even Django
    admin) could ever move it to VERIFIED, so IsVerifiedAndMfaEnabled
    could never actually be satisfied by a real user in production."""
    from django.utils import timezone
    from .models import VerificationStatus
    from notifications.services import notify

    kyc_profile.kyc_status = VerificationStatus.VERIFIED
    kyc_profile.reviewed_at = timezone.now()
    kyc_profile.save(update_fields=["kyc_status", "reviewed_at"])

    notify(
        recipient=kyc_profile.user, notification_type="KYC_APPROVED", channel="WHATSAPP",
        title="Identity Verified", message="Your identity verification (KYC) has been approved.",
        related_reference=str(kyc_profile.id),
    )
    from engagement.services import evaluate_badges_for_user
    evaluate_badges_for_user(kyc_profile.user)

    # Qualify any referral and award the referral reward to the referrer
    from social.services import qualify_referral, award_referral_reward
    referral = qualify_referral(kyc_profile.user)
    if referral:
        award_referral_reward(referral)

    return kyc_profile


def reject_kyc(kyc_profile, reason: str = ""):
    from django.utils import timezone
    from .models import VerificationStatus
    from notifications.services import notify

    kyc_profile.kyc_status = VerificationStatus.REJECTED
    kyc_profile.reviewed_at = timezone.now()
    kyc_profile.save(update_fields=["kyc_status", "reviewed_at"])

    notify(
        recipient=kyc_profile.user, notification_type="KYC_REJECTED", channel="WHATSAPP",
        title="Identity Verification Not Approved",
        message=f"Your KYC submission was not approved.{' Reason: ' + reason if reason else ''}",
        related_reference=str(kyc_profile.id),
    )
    return kyc_profile


def user_has_verified_mfa(user) -> bool:
    """True if this user has at least one MFA method that has been set
    up and confirmed working (not just added, but actually verified with
    a real code at setup time)."""
    return user.mfa_methods.filter(verified=True).exists()


def require_mfa_for_sensitive_action(user, action_description: str = "perform this action"):
    """Call this at the START of any sensitive action (listing a
    property, making a payment) before doing anything else. Read-only
    browsing should NEVER call this — only actions that create or move
    something of value."""
    if not user_has_verified_mfa(user):
        raise MfaRequiredError(
            f"You must set up multi-factor authentication before you can "
            f"{action_description}. Please add and verify an MFA method first."
        )


def user_has_submitted_kyc(user) -> bool:
    """True the moment KYC has been SUBMITTED, regardless of whether an
    admin has approved it yet — registration only requires submission,
    not approval, per Prompt 2's acceptance criteria."""
    return hasattr(user, "kyc_profile")


def require_kyc_submitted_for_registration(user):
    """Call this at the point registration is considered 'complete' —
    e.g. right before granting full account access."""
    if not user_has_submitted_kyc(user):
        raise KycNotSubmittedError(
            "Registration cannot complete until KYC information has been "
            "submitted (national ID, date of birth, and address)."
        )


# ---------------------------------------------------------------------------
# OTP issuance — a real gap this closes: MfaChallenge could always be
# CREATED, but nothing ever actually sent the code anywhere.
# ---------------------------------------------------------------------------
OTP_LENGTH = 6
OTP_VALIDITY_MINUTES = 10


def issue_mfa_challenge(mfa_method):
    """Generates a real random code, creates the MfaChallenge record,
    and actually sends it — via SMS or Email depending on the method's
    type — through the shared notify() function. AUTHENTICATOR_APP
    methods generate their code locally (TOTP) and never reach this
    function at all; only SMS_OTP/EMAIL_OTP need a code dispatched."""
    import random
    from django.utils import timezone
    from datetime import timedelta
    from .models import MfaChallenge, MfaType
    from notifications.services import notify

    code = "".join(random.choices("0123456789", k=OTP_LENGTH))
    challenge = MfaChallenge.objects.create(
        mfa_method=mfa_method, code=code,
        expires_at=timezone.now() + timedelta(minutes=OTP_VALIDITY_MINUTES),
    )

    channel = "SMS" if mfa_method.mfa_type == MfaType.SMS_OTP else "EMAIL"
    notify(
        recipient=mfa_method.user, notification_type="MFA_CODE",
        title="Your Oaziland verification code",
        message=f"Your verification code is {code}. It expires in {OTP_VALIDITY_MINUTES} minutes.",
        channel=channel, related_reference=str(challenge.id),
    )

    return challenge


# ---------------------------------------------------------------------------
# Password reset — a real gap this closes: no reset flow existed at all.
# ---------------------------------------------------------------------------
PASSWORD_RESET_VALIDITY_MINUTES = 30


class InvalidResetTokenError(Exception):
    pass


def request_password_reset(user):
    """Generates a real, single-use token and emails it — never reveals
    whether a given username/email actually exists to the caller of
    this function (that check belongs at the view/API layer, which
    should return the same generic response either way to avoid
    leaking which accounts exist)."""
    import secrets
    from django.utils import timezone
    from datetime import timedelta
    from .models import PasswordResetToken
    from notifications.services import notify

    token_value = secrets.token_urlsafe(32)
    reset_token = PasswordResetToken.objects.create(
        user=user, token=token_value,
        expires_at=timezone.now() + timedelta(minutes=PASSWORD_RESET_VALIDITY_MINUTES),
    )

    notify(
        recipient=user, notification_type="PASSWORD_RESET",
        title="Reset your Oaziland password",
        message=f"Use this code to reset your password: {token_value}. It expires in {PASSWORD_RESET_VALIDITY_MINUTES} minutes.",
        channel="EMAIL", related_reference=str(reset_token.id),
    )
    return reset_token


def confirm_password_reset(*, token_value: str, new_password: str):
    from django.utils import timezone
    from .models import PasswordResetToken

    try:
        reset_token = PasswordResetToken.objects.get(token=token_value)
    except PasswordResetToken.DoesNotExist:
        raise InvalidResetTokenError("This reset link is invalid.")

    if not reset_token.is_valid():
        raise InvalidResetTokenError("This reset link has expired or was already used.")

    user = reset_token.user
    user.set_password(new_password)
    user.save(update_fields=["password"])

    reset_token.consumed_at = timezone.now()
    reset_token.save(update_fields=["consumed_at"])
    return user


# ---------------------------------------------------------------------------
# Referral codes — a real, persistent, shareable code per user, not
# just an implicit referrer/referred_user pairing with nothing a
# person can actually hand out.
# ---------------------------------------------------------------------------
def get_or_create_referral_code(user) -> str:
    """Generates a real, unique, human-shareable code the FIRST time
    it's needed, and returns the SAME code every time after — a user's
    referral code must be stable, or a link they already shared would
    silently stop working."""
    if user.referral_code:
        return user.referral_code

    import random
    import string
    from .models import User

    while True:
        candidate = (user.username[:4].upper().ljust(4, "X") if user.username else "USER") + \
            "".join(random.choices(string.digits, k=4))
        if not User.objects.filter(referral_code=candidate).exists():
            user.referral_code = candidate
            user.save(update_fields=["referral_code"])
            return candidate


# ---------------------------------------------------------------------------
# Public User Role Index / Profile Hub:
# Surfaces a user's role-specific owned assets (hotels, hostels, apartments,
# houses, lands, shops, guest houses, venues, listings) and public professional
# stats for public sharing and QR code discovery.
# ---------------------------------------------------------------------------
def get_user_public_index(user):
    from django.db.models import Avg
    from social.models import Rating
    from property.models import Listing, ListingStatus, House, Shop, GuestHouseLodge
    from hotels.models import Hotel
    from student_hostels.models import StudentHostel
    from events.models import Venue
    from land.models import Land

    # 1. Base User identity & role flags
    roles = []
    if hasattr(user, "hotel_set") or Hotel.objects.filter(owner=user).exists():
        roles.append("hotel_owner")
    if hasattr(user, "student_hostels") or StudentHostel.objects.filter(owner=user).exists():
        roles.append("hostel_owner")
    if hasattr(user, "landlord_profile") or Listing.objects.filter(listed_by=user).exists() or House.objects.filter(owner=user).exists():
        roles.append("landlord")
    if hasattr(user, "agent_profile"):
        roles.append("agent")
    if hasattr(user, "agency_profile"):
        roles.append("agency")
    if hasattr(user, "technician_profile"):
        roles.append("technician")
    if hasattr(user, "driver_profile"):
        roles.append("driver")
    if hasattr(user, "student_profile"):
        roles.append("student")
    if not roles:
        roles.append("user")

    # Ratings
    ratings = Rating.objects.filter(subject_user=user)
    avg_rating = ratings.aggregate(avg=Avg("score"))["avg"]
    is_kyc = hasattr(user, "kyc_profile") and user.kyc_profile.kyc_status == "VERIFIED"

    # 2. Owned Hotels
    owned_hotels = []
    for h in Hotel.objects.filter(owner=user).prefetch_related("room_types", "asset_photos"):
        primary_photo = h.asset_photos.filter(is_primary=True).first() or h.asset_photos.first()
        cheapest_rate = min([rt.base_rate_xaf for rt in h.room_types.all()], default=None)
        owned_hotels.append({
            "id": str(h.id),
            "quarter_name": h.quarter.name if h.quarter else "",
            "star_rating": h.star_rating,
            "total_rooms": h.total_rooms,
            "verified": h.verified,
            "latitude": float(h.latitude) if h.latitude is not None else None,
            "longitude": float(h.longitude) if h.longitude is not None else None,
            "cheapest_rate_xaf": float(cheapest_rate) if cheapest_rate is not None else None,
            "photo_url": primary_photo.url if primary_photo else None,
            "room_categories": list({rt.category for rt in h.room_types.all()}),
        })

    # 3. Owned Student Hostels
    owned_hostels = []
    for sh in StudentHostel.objects.filter(owner=user).prefetch_related("asset_photos", "units"):
        primary_photo = sh.asset_photos.filter(is_primary=True).first() or sh.asset_photos.first()
        from student_hostels.models import HostelUnit
        units = HostelUnit.objects.filter(building=sh.building_ptr)
        owned_hostels.append({
            "id": str(sh.id),
            "quarter_name": sh.quarter.name if sh.quarter else "",
            "property_type": sh.property_type,
            "total_units": units.count(),
            "latitude": float(sh.latitude) if sh.latitude is not None else None,
            "longitude": float(sh.longitude) if sh.longitude is not None else None,
            "photo_url": primary_photo.url if primary_photo else None,
            "unit_types": list({u.unit_type for u in units}),
        })

    # 4. Owned Guest Houses & Lodges
    owned_guest_houses = []
    for gh in GuestHouseLodge.objects.filter(owner=user).prefetch_related("asset_photos"):
        primary_photo = gh.asset_photos.filter(is_primary=True).first() or gh.asset_photos.first()
        owned_guest_houses.append({
            "id": str(gh.id),
            "quarter_name": gh.quarter.name if gh.quarter else "",
            "is_coastal_leisure": gh.is_coastal_leisure,
            "finish_level": gh.finish_level,
            "latitude": float(gh.latitude) if gh.latitude is not None else None,
            "longitude": float(gh.longitude) if gh.longitude is not None else None,
            "photo_url": primary_photo.url if primary_photo else None,
        })

    # 5. Owned Event Venues
    owned_venues = []
    for v in Venue.objects.filter(owner=user).prefetch_related("asset_photos", "venue_spaces"):
        primary_photo = v.asset_photos.filter(is_primary=True).first() or v.asset_photos.first()
        owned_venues.append({
            "id": str(v.id),
            "quarter_name": v.quarter.name if v.quarter else "",
            "verified": v.verified,
            "total_spaces": v.venue_spaces.count(),
            "latitude": float(v.latitude) if v.latitude is not None else None,
            "longitude": float(v.longitude) if v.longitude is not None else None,
            "photo_url": primary_photo.url if primary_photo else None,
        })

    # 6. Published Listings (Houses, Apartments, Studios, Lands, Commercials)
    published_listings = []
    listings_qs = Listing.objects.filter(
        listed_by=user,
        status=ListingStatus.PUBLISHED,
    ).select_related("property_asset", "property_asset__quarter").prefetch_related("photos").order_by("-published_at")

    apartments_count = 0
    houses_count = 0
    lands_count = 0

    for l in listings_qs:
        asset = l.property_asset
        primary_photo = l.photos.filter(is_primary=True).first() or l.photos.first()
        asset_type = asset.type if asset else ""
        
        # Check if house is apartment style
        house_style = ""
        if hasattr(asset, "house"):
            house_style = asset.house.house_style

        if asset_type == "HOUSE" and house_style in ("APARTMENT", "STUDIO", "ROOM", "SELF_CONTAIN"):
            apartments_count += 1
        elif asset_type == "HOUSE":
            houses_count += 1
        elif asset_type == "LAND":
            lands_count += 1

        published_listings.append({
            "id": str(l.id),
            "title": f"{asset.get_type_display()} in {asset.quarter.name}" if asset and asset.quarter else "Property Listing",
            "property_type": asset_type,
            "house_style": house_style,
            "listing_type": l.listing_type,
            "price_xaf": float(l.price_xaf),
            "quarter_name": asset.quarter.name if (asset and asset.quarter) else "",
            "latitude": float(asset.latitude) if (asset and asset.latitude is not None) else None,
            "longitude": float(asset.longitude) if (asset and asset.longitude is not None) else None,
            "photo_url": primary_photo.url if primary_photo else None,
            "published_at": l.published_at.isoformat() if l.published_at else None,
        })

    agency_name = None
    if hasattr(user, "agent_profile") and user.agent_profile.agency:
        agency_name = user.agent_profile.agency.user.full_name or user.agent_profile.agency.user.username

    # 7. Role Profiles: Technician
    technician_info = None
    if hasattr(user, "technician_profile"):
        tp = user.technician_profile
        from services.models import ServiceRequest, ServiceRequestStatus
        completed_jobs = ServiceRequest.objects.filter(
            technician=user,
            status=ServiceRequestStatus.COMPLETED,
        ).count()
        technician_info = {
            "specialties": tp.specialties,
            "coverage_quarter_name": tp.coverage_quarter.name if tp.coverage_quarter else None,
            "is_verified": tp.is_verified,
            "completed_jobs": completed_jobs,
        }

    # 8. Role Profiles: Driver (OaziGo)
    driver_info = None
    if hasattr(user, "driver_profile"):
        dp = user.driver_profile
        from marketplace.models import RideBooking, RideStatus
        completed_rides = RideBooking.objects.filter(
            driver=user,
            status=RideStatus.COMPLETED,
        ).count()
        vehicles_data = [
            {
                "id": str(v.id),
                "make": v.make,
                "model": v.model,
                "plate_number": v.plate_number,
                "vehicle_category": v.vehicle_category,
            }
            for v in dp.vehicles.all()
        ]
        driver_info = {
            "license_number": dp.license_number,
            "is_verified": dp.is_verified,
            "completed_rides": completed_rides,
            "vehicles": vehicles_data,
        }

    # 9. Role Profiles: Student Resident
    student_info = None
    if hasattr(user, "student_profile"):
        sp = user.student_profile
        student_info = {
            "institution_name": sp.institution_name,
            "programme_year": sp.programme_year,
            "is_international_student": sp.is_international_student,
        }

    return {
        "user_id": str(user.id),
        "username": user.username,
        "full_name": user.full_name or user.username,
        "profile_image_url": user.profile_image_url,
        "phone": user.phone,
        "roles": roles,
        "is_kyc_verified": is_kyc,
        "average_rating": round(avg_rating, 2) if avg_rating else None,
        "rating_count": ratings.count(),
        "agency_name": agency_name,
        "technician": technician_info,
        "driver": driver_info,
        "student": student_info,
        "stats": {
            "hotels_count": len(owned_hotels),
            "hostels_count": len(owned_hostels),
            "guest_houses_count": len(owned_guest_houses),
            "venues_count": len(owned_venues),
            "listings_count": len(published_listings),
            "apartments_count": apartments_count,
            "houses_count": houses_count,
            "lands_count": lands_count,
        },
        "hotels": owned_hotels,
        "hostels": owned_hostels,
        "guest_houses": owned_guest_houses,
        "venues": owned_venues,
        "listings": published_listings,
    }

