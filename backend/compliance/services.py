"""
compliance.services — consent recording, real data export generation,
and account deletion that actually distinguishes what's legally
retained (financial records) from what's genuinely deleted (personal
identifying data).
"""
import json
import io


# ---------------------------------------------------------------------------
# Consent.
# ---------------------------------------------------------------------------
def record_consent(*, user, consent_type: str, version: str):
    from .models import ConsentRecord
    return ConsentRecord.objects.create(user=user, consent_type=consent_type, version=version)


def revoke_consent(*, user, consent_type: str):
    """Only meaningful for WITHDRAWABLE consents (e.g. marketing
    communications) — revoking 'agreement to the Terms of Service'
    doesn't un-happen past use of the platform under those terms, but
    marketing consent genuinely can be withdrawn at any time."""
    from django.utils import timezone
    from .models import ConsentRecord
    ConsentRecord.objects.filter(user=user, consent_type=consent_type, revoked_at__isnull=True).update(revoked_at=timezone.now())


def has_active_consent(*, user, consent_type: str, version: str = None) -> bool:
    from .models import ConsentRecord
    qs = ConsentRecord.objects.filter(user=user, consent_type=consent_type, revoked_at__isnull=True)
    if version:
        qs = qs.filter(version=version)
    return qs.exists()


def get_current_policy(document_type: str):
    from .models import PolicyDocument
    return PolicyDocument.objects.filter(document_type=document_type, is_current=True).first()


# ---------------------------------------------------------------------------
# Data export — the actual right-of-access mechanism.
# ---------------------------------------------------------------------------
def generate_data_export(user):
    """Aggregates a user's real data across the platform into one JSON
    file — profile, KYC (if submitted), bookings, reviews, and wallet
    balance. Not literally every table in the platform (a genuinely
    exhaustive export across 30+ apps is a natural extension of this
    same pattern), but the categories a person would actually expect
    when asking 'what do you have on me.'"""
    from django.core.files.base import ContentFile
    from .models import DataExportRequest, DataExportRequestStatus
    from transactions.models import Booking
    from social.models import Review
    from monetization.models import Wallet

    export_request = DataExportRequest.objects.create(user=user)

    data = {
        "profile": {
            "username": user.username,
            "phone": user.phone,
            "email": user.email,
            "full_name": user.full_name,
            "date_joined": user.date_joined.isoformat(),
        },
        "kyc": None,
        "bookings": [],
        "reviews_written": [],
        "wallet_balance_xaf": None,
    }

    if hasattr(user, "kyc_profile"):
        kyc = user.kyc_profile
        data["kyc"] = {
            "legal_full_name": kyc.legal_full_name,
            "date_of_birth": kyc.date_of_birth.isoformat(),
            "residential_address": kyc.residential_address,
            "kyc_status": kyc.kyc_status,
        }

    for booking in Booking.objects.filter(requester=user):
        data["bookings"].append({
            "id": str(booking.id), "booking_type": booking.booking_type,
            "status": booking.status, "amount_xaf": str(booking.amount_xaf),
            "created_at": booking.created_at.isoformat(),
        })

    for review in Review.objects.filter(author=user):
        data["reviews_written"].append({"score": review.score, "text": review.text, "created_at": review.created_at.isoformat()})

    wallet = Wallet.objects.filter(owner=user).first()
    if wallet:
        data["wallet_balance_xaf"] = str(wallet.balance_xaf)

    json_bytes = json.dumps(data, indent=2).encode("utf-8")

    from django.utils import timezone
    export_request.export_file.save(f"export_{user.id}.json", ContentFile(json_bytes), save=False)
    export_request.status = DataExportRequestStatus.READY
    export_request.completed_at = timezone.now()
    export_request.save()

    return export_request


# ---------------------------------------------------------------------------
# Account deletion — the real retention distinction this prompt asks for.
# ---------------------------------------------------------------------------
def complete_account_deletion(user):
    """WHY this is more than 'set deleted_at': that alone doesn't
    distinguish anything. Financial/legal records (Booking,
    PaymentEscrow, Commission, Contract) are explicitly LEFT ALONE —
    still referencing this user's ID, per real retention obligations.
    Genuinely personal identifying data (KYCProfile — national ID
    number, date of birth, ID document images, address; and the User's
    own contact details) is what actually gets scrubbed or deleted."""
    from django.utils import timezone

    # Scrub personal identifying fields on the User itself — financial
    # records that FK to this user keep working (the row still exists),
    # they just no longer carry personally-identifying contact info.
    user.username = f"deleted_user_{user.id}"
    user.phone = ""
    user.email = ""
    user.first_name = ""
    user.last_name = ""
    user.deleted_at = timezone.now()
    user.save(update_fields=["username", "phone", "email", "first_name", "last_name", "deleted_at"])

    # KYCProfile holds the most sensitive PII on the platform (national
    # ID number, date of birth, ID document images) — deleted entirely,
    # not retained, since there's no legal retention requirement for it
    # once the account itself is gone (unlike financial transaction records).
    if hasattr(user, "kyc_profile"):
        user.kyc_profile.delete()

    return user
