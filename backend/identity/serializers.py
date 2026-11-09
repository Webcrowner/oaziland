"""identity.serializers — registration and profile serializers."""
from rest_framework import serializers
from .models import User, KYCProfile
from .services import SELF_SERVICE_ROLES, grant_role


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    referral_code = serializers.CharField(write_only=True, required=False, allow_blank=True)
    # What the person wants to do here; "renter" is the normal-user default and adds no extra role.
    role = serializers.ChoiceField(choices=SELF_SERVICE_ROLES, write_only=True, required=False, default="renter")

    class Meta:
        model = User
        fields = ["id", "username", "phone", "email", "password", "preferred_language", "referral_code", "role"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        referral_code = validated_data.pop("referral_code", "").strip()
        role = validated_data.pop("role", "renter")
        user = User(**validated_data)
        user.set_password(password)  # never store a plain-text password — Django's hashing, applied explicitly here
        user.save()
        grant_role(user, role)

        if referral_code:
            # WHY a bad/unknown code never fails registration itself:
            # a typo in someone's referral code is a real, common thing
            # that should still let a person create their account —
            # just without a referral attached. The frontend can
            # separately tell them the code didn't match anything.
            from social.services import process_referral_signup, InvalidReferralCodeError
            try:
                process_referral_signup(new_user=user, referral_code=referral_code)
            except InvalidReferralCodeError:
                pass

        return user


class UserProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    account_status = serializers.CharField(read_only=True)
    is_admin = serializers.SerializerMethodField()
    is_agent = serializers.SerializerMethodField()
    is_landlord = serializers.SerializerMethodField()
    is_student = serializers.SerializerMethodField()
    is_technician = serializers.SerializerMethodField()
    is_driver = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "phone", "email", "full_name",
            "preferred_language", "profile_image_url", "verification_status", "account_status",
            "is_admin", "is_agent", "is_landlord", "is_student",
            "is_technician", "is_driver",
        ]
        read_only_fields = ["verification_status", "account_status"]

    def get_is_admin(self, obj) -> bool:
        return hasattr(obj, "admin_profile") or obj.is_staff or obj.is_superuser

    def get_is_agent(self, obj) -> bool:
        return hasattr(obj, "agent_profile")

    def get_is_landlord(self, obj) -> bool:
        return hasattr(obj, "landlord_profile")

    def get_is_student(self, obj) -> bool:
        return hasattr(obj, "student_profile")

    def get_is_technician(self, obj) -> bool:
        return hasattr(obj, "technician_profile")

    def get_is_driver(self, obj) -> bool:
        return hasattr(obj, "driver_profile")


class KYCProfileSerializer(serializers.ModelSerializer):
    """A user's own KYC submission — a real gap this closed: KYCProfile
    could only ever be created directly in the database (admin/tests),
    with no HTTP endpoint letting a real user actually submit their own
    identity information. kyc_status/submitted_at/reviewed_at stay
    read-only — a user can SUBMIT their KYC, they can't self-approve it.

    WHY the three image fields are required here even though the model
    itself allows blank=True: a KYC submission with no document photos
    or selfie at all isn't actually verifiable by anyone reviewing it —
    matching how every real identity-verification provider (Smile
    Identity, Onfido, Persona) requires document + selfie capture as
    part of the same submission, not an optional afterthought."""
    id_document_front_image_url = serializers.URLField(required=True)
    id_document_back_image_url = serializers.URLField(required=True)
    selfie_image_url = serializers.URLField(required=True)

    class Meta:
        model = KYCProfile
        fields = [
            "legal_full_name", "date_of_birth", "national_id_number",
            "id_document_front_image_url", "id_document_back_image_url", "selfie_image_url", "residential_address",
            "kyc_status", "submitted_at", "reviewed_at",
        ]
        read_only_fields = ["kyc_status", "submitted_at", "reviewed_at"]


def _normalise_id(number: str) -> str:
    """An ID number reduced to its letters and digits, lower-cased, so spacing and punctuation can't hide a reuse."""
    return "".join(c for c in (number or "").lower() if c.isalnum())


class AdminKYCProfileSerializer(serializers.ModelSerializer):
    """The other real half of the same gap: a real user could submit
    KYC (see KYCProfileSerializer above), but nothing ever let an admin
    actually see or act on the submission — kyc_status could only ever
    be flipped away from PENDING directly in the database. Read-only;
    approval/rejection goes through AdminKYCReviewViewSet's own actions,
    not a generic PATCH, so every decision is captured with a real
    reviewed_at timestamp.

    Besides the submitted fields it carries what a reviewer checks them against: the account's contact details and
    name, the applicant's age, and whether the ID number was already used on another submission."""
    username = serializers.CharField(source="user.username", read_only=True)
    full_name = serializers.SerializerMethodField()
    phone = serializers.CharField(source="user.phone", read_only=True)
    email = serializers.CharField(source="user.email", read_only=True)
    date_joined = serializers.DateTimeField(source="user.date_joined", read_only=True)
    age = serializers.SerializerMethodField()
    name_matches_account = serializers.SerializerMethodField()
    duplicate_id_count = serializers.SerializerMethodField()

    class Meta:
        model = KYCProfile
        fields = [
            "id", "username", "full_name", "phone", "email", "date_joined",
            "legal_full_name", "date_of_birth", "age", "national_id_number", "duplicate_id_count", "name_matches_account",
            "id_document_front_image_url", "id_document_back_image_url", "selfie_image_url", "residential_address",
            "kyc_status", "submitted_at", "reviewed_at",
        ]

    def get_full_name(self, profile) -> str:
        return profile.user.full_name

    def get_age(self, profile) -> int | None:
        from django.utils import timezone
        today = timezone.localdate()
        born = profile.date_of_birth
        if born is None or born > today:
            return None
        return today.year - born.year - ((today.month, today.day) < (born.month, born.day))

    def get_name_matches_account(self, profile) -> bool | None:
        """None when the account has no name to compare against; otherwise whether the two names use the same
        words, ignoring case, accents and order."""
        import unicodedata

        def words(text: str) -> set:
            stripped = "".join(c for c in unicodedata.normalize("NFKD", text or "") if not unicodedata.combining(c))
            return {w for w in stripped.lower().replace("-", " ").split() if w}

        account = words(profile.user.full_name)
        if not account:
            return None
        legal = words(profile.legal_full_name)
        return account <= legal or legal <= account

    def get_duplicate_id_count(self, profile) -> int:
        """How many other submissions use the same ID number, ignoring case, spacing and hyphens. The counts for
        every ID are built once per request and shared by all rows."""
        counts = self.context.get("_id_counts")
        if counts is None:
            counts = {}
            for number in KYCProfile.objects.values_list("national_id_number", flat=True):
                key = _normalise_id(number)
                counts[key] = counts.get(key, 0) + 1
            self.context["_id_counts"] = counts
        key = _normalise_id(profile.national_id_number)
        return max(counts.get(key, 1) - 1, 0) if key else 0


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)


class PasswordResetRequestSerializer(serializers.Serializer):
    username = serializers.CharField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField()
    new_password = serializers.CharField(min_length=8)
