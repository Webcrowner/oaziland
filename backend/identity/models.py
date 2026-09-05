"""
identity — the platform's single source of authentication and identity.

Roles (Landlord, Agent, Agency, Student, Technician, Admin) are modeled as
separate profile tables attached to a User rather than subclasses of User,
because a real person can hold several roles simultaneously (e.g. an Agent
who is also a Student). See Oaziland Architecture doc, §2.1.
"""
import uuid
from django.conf import settings
from django.db import models
from django.contrib.auth.models import AbstractUser


class AccountStatus(models.TextChoices):
    """WHY separate from Django's built-in is_active: is_active is a
    blunt on/off switch with no memory of WHY or UNTIL WHEN. A temporary
    suspension needs an end date; a ban needs to be permanent and
    distinguishable from a suspension in the admin console — this field
    captures both, is_active alone can't."""
    ACTIVE = "ACTIVE", "Active"
    SUSPENDED = "SUSPENDED", "Temporarily Suspended"
    BANNED = "BANNED", "Permanently Banned"


class VerificationStatus(models.TextChoices):
    UNVERIFIED = "UNVERIFIED", "Unverified"
    PENDING = "PENDING", "Pending Review"
    VERIFIED = "VERIFIED", "Verified"
    REJECTED = "REJECTED", "Rejected"


class Language(models.TextChoices):
    EN = "EN", "English"
    FR = "FR", "French"


class User(AbstractUser):
    """Custom user: phone is the primary contact method (MTN/Orange), per
    the Cameroon market. Email is optional."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=20, unique=True)
    email = models.EmailField(blank=True, null=True, unique=True)
    # WHY this lives directly on User, not a separate one-to-one model:
    # every user has exactly one, and the registration flow needs to
    # look up ANY user's code by it — a direct, indexed field is the
    # simplest correct design for something this central. Generated
    # lazily (see identity.services.get_or_create_referral_code) so
    # existing users created before this feature still get one on
    # first use, rather than needing a backfill migration.
    referral_code = models.CharField(max_length=12, unique=True, null=True, blank=True)
    verification_status = models.CharField(
        max_length=20, choices=VerificationStatus.choices,
        default=VerificationStatus.UNVERIFIED,
    )
    preferred_language = models.CharField(
        max_length=2, choices=Language.choices, default=Language.EN,
    )
    country = models.ForeignKey(
        "geo.Country", on_delete=models.PROTECT, null=True, blank=True,
    )
    deleted_at = models.DateTimeField(null=True, blank=True)  # soft delete
    account_status = models.CharField(
        max_length=10, choices=AccountStatus.choices, default=AccountStatus.ACTIVE,
    )
    suspended_until = models.DateTimeField(null=True, blank=True)  # only meaningful when account_status=SUSPENDED

    REQUIRED_FIELDS = ["phone"]

    class Meta:
        db_table = "users"

    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.phone})"

    @property
    def full_name(self):
        """Prompt 2 asks for a `full_name` field. Rather than storing the
        name twice, this reuses Django's built-in first_name/last_name
        (which AbstractUser already gives us) — one source of truth,
        just exposed under the name the spec expects."""
        return self.get_full_name()

    @property
    def created_at(self):
        """Same idea as full_name: Django's AbstractUser already tracks
        this as `date_joined`. This property exposes it under the name
        Prompt 2 specifies, without a second, possibly-inconsistent column."""
        return self.date_joined


class LandlordProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="landlord_profile",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "landlord_profiles"


class AgencyProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="agency_profile",
    )
    registration_number = models.CharField(max_length=100, unique=True)
    agency_commission_percent = models.DecimalField(max_digits=5, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "agency_profiles"

    def __str__(self):
        return f"Agency: {self.user}"


class AgentProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="agent_profile",
    )
    agency = models.ForeignKey(
        AgencyProfile, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="agents",
    )
    agent_commission_percent = models.DecimalField(max_digits=5, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "agent_profiles"

    def __str__(self):
        return f"Agent: {self.user}" + (f" @ {self.agency}" if self.agency_id else " (independent)")


class StudentProfile(models.Model):
    """WHY accessibility/international/programme fields live here rather
    than on RoomAllocation: these are durable attributes of the STUDENT,
    true across every semester they're allocated a room, not something
    re-entered per allocation."""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="student_profile",
    )
    institution_name = models.CharField(max_length=200)
    has_accessibility_needs = models.BooleanField(default=False)
    is_international_student = models.BooleanField(default=False)
    programme_year = models.PositiveSmallIntegerField(null=True, blank=True)
    roommate_preference = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="preferred_as_roommate_by",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_profiles"


class TechnicianProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="technician_profile",
    )
    specialties = models.JSONField(default=list)  # list of ServiceCategory codes
    coverage_quarter = models.ForeignKey(
        "geo.Quarter", on_delete=models.SET_NULL, null=True, blank=True,
    )
    avg_rating = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "technician_profiles"


class AdminProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="admin_profile",
    )
    permissions = models.JSONField(default=list)

    class Meta:
        db_table = "admin_profiles"


class InteractionLog(models.Model):
    """Shared CRM-style interaction log — one contact-history record per
    client conversation, reused across every module rather than a separate
    system per module. Reconciled from GRE-TECH-SPEC-001's `contact` table."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="interactions_as_client",
    )
    staff = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="interactions_as_staff",
    )
    related_listing_id = models.UUIDField(null=True, blank=True)
    related_booking = models.ForeignKey(
        "transactions.Booking", on_delete=models.SET_NULL, null=True, blank=True,
    )
    notes = models.TextField()
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "interaction_log"
        indexes = [models.Index(fields=["client", "occurred_at"])]


# ---------------------------------------------------------------------------
# Social login (Google / Facebook) — Prompt 2 / UML Section 10.
#
# WHY a separate table instead of a field on User: a person might sign up
# normally with a phone number, then later link a Google account. Keeping
# this as its own table means "log in with Google" always finds the SAME
# underlying User, instead of silently creating a duplicate account.
# ---------------------------------------------------------------------------
class OAuthProvider(models.TextChoices):
    GOOGLE = "GOOGLE", "Google"
    FACEBOOK = "FACEBOOK", "Facebook"


class OAuthAccount(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="oauth_accounts",
    )
    provider = models.CharField(max_length=20, choices=OAuthProvider.choices)
    provider_user_id = models.CharField(max_length=255)
    linked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "oauth_accounts"
        # The same Google account can only ever be linked to ONE Oaziland user.
        unique_together = [("provider", "provider_user_id")]


# ---------------------------------------------------------------------------
# Multi-factor authentication — Prompt 2 / UML Section 10.
#
# WHY two classes instead of one: MfaMethod is the *setup* (which phone
# number, which method) — it's permanent until the user changes it.
# MfaChallenge is a single, short-lived *attempt* to prove identity right
# now. Separating them means we can enforce "a code can only be used once"
# without that logic leaking into the method configuration itself.
# ---------------------------------------------------------------------------
class MfaType(models.TextChoices):
    SMS_OTP = "SMS_OTP", "SMS Code"
    AUTHENTICATOR_APP = "AUTHENTICATOR_APP", "Authenticator App"
    EMAIL_OTP = "EMAIL_OTP", "Email Code"


class MfaMethod(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mfa_methods",
    )
    mfa_type = models.CharField(max_length=20, choices=MfaType.choices)
    destination = models.CharField(max_length=255)  # phone number or email
    is_primary = models.BooleanField(default=False)
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "mfa_methods"


class MfaChallenge(models.Model):
    mfa_method = models.ForeignKey(
        MfaMethod, on_delete=models.CASCADE, related_name="challenges",
    )
    code = models.CharField(max_length=10)
    expires_at = models.DateTimeField()
    consumed = models.BooleanField(default=False)  # prevents replaying an old code
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "mfa_challenges"

    def verify(self, submitted_code: str) -> bool:
        """Checks a code the user typed in against this challenge.
        Returns False (never True) once the code is expired or already used,
        even if the digits happen to match — a used code is a dead code."""
        from django.utils import timezone
        if self.consumed or timezone.now() > self.expires_at:
            return False
        is_match = submitted_code == self.code
        if is_match:
            self.consumed = True
            self.save(update_fields=["consumed"])
        return is_match


# ---------------------------------------------------------------------------
# KYC — Prompt 2 / UML Section 10.
#
# WHY mandatory and one-to-one rather than optional fields on User: this
# keeps identity-verification data (national ID, date of birth) separate
# from login credentials, and makes "has this person completed KYC at all"
# a single, simple check (does a KYCProfile row exist) rather than a
# scattered set of nullable fields on the main User table.
# ---------------------------------------------------------------------------
class KYCProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="kyc_profile",
    )
    legal_full_name = models.CharField(max_length=200)
    date_of_birth = models.DateField()
    national_id_number = models.CharField(max_length=100)
    id_document_image_url = models.URLField(blank=True)
    selfie_image_url = models.URLField(blank=True)
    residential_address = models.TextField()
    kyc_status = models.CharField(
        max_length=20, choices=VerificationStatus.choices,
        default=VerificationStatus.PENDING,
    )
    submitted_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "kyc_profiles"


class PasswordResetToken(models.Model):
    """A single-use, expiring token sent by EMAIL — 'password resets'
    was one of the three email use-cases this prompt explicitly names,
    and no reset flow existed at all before this. WHY consumed_at
    (not a simple boolean) mirrors MfaChallenge.consumed's reasoning:
    an explicit timestamp is more useful for audit than a bare flag,
    and prevents a used token from ever being replayed."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="password_reset_tokens")
    token = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "password_reset_tokens"

    def is_valid(self) -> bool:
        from django.utils import timezone
        return self.consumed_at is None and timezone.now() < self.expires_at
