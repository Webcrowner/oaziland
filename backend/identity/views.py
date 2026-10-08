"""identity.views — registration, 'my profile', and MFA setup/verify
endpoints. JWT login/refresh itself is handled by simplejwt's built-in
views, wired directly in oaziland/urls.py rather than duplicated here.

WHY the MFA endpoints matter: issue_mfa_challenge() and MfaChallenge.
verify() (identity/services.py, identity/models.py) already existed
and were already tested — but NOTHING exposed them over real HTTP. MFA
is now a purely OPTIONAL security feature a user can turn on for
themselves (surfaced as a toggle on their account/dashboard settings),
not a mandatory gate — IsKycVerified (oaziland/permissions.py) is what's
actually enforced on sensitive actions (listing a property, making a
booking) platform-wide, and it checks KYC only.
"""
from rest_framework import generics, permissions, status, viewsets
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView
from drf_spectacular.utils import extend_schema
from .models import User, MfaMethod, KYCProfile, VerificationStatus
from .serializers import (
    RegisterSerializer, UserProfileSerializer, KYCProfileSerializer, AdminKYCProfileSerializer,
    ChangePasswordSerializer, PasswordResetRequestSerializer, PasswordResetConfirmSerializer,
)
from .services import issue_mfa_challenge, user_has_verified_mfa, approve_kyc, reject_kyc
from oaziland.permissions import IsAdminRole


class LoginThrottle(AnonRateThrottle):
    """A real gap this closes: TokenObtainPairView (simplejwt's own
    login view) previously shared the platform's GLOBAL anonymous
    throttle bucket (60/hour, the same budget as browsing listings,
    registering, etc.) — meaning a credential-stuffing attempt against
    one account could also lock out ordinary anonymous browsing from
    the same IP, and login itself had no bucket of its own to actually
    limit password-guessing attempts distinctly. A dedicated scope
    gives login its own, tighter, purpose-built limit."""
    scope = "login"


class LoginView(TokenObtainPairView):
    throttle_classes = [LoginThrottle]


class RegisterView(generics.CreateAPIView):
    """Open registration — deliberately AllowAny (you can't require
    login to... log in for the first time), but rate-limited by IP to
    prevent bulk fake-account creation."""
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AnonRateThrottle]


class MyProfileView(generics.RetrieveUpdateAPIView):
    """A user's own profile — 'me', not a generic user-by-id lookup, so
    there's no risk of accidentally exposing someone else's profile
    through a guessable ID."""
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


class DevRoleSwitchView(APIView):
    """TEMPORARY dev tool behind the sidebar role switcher. Grants the
    caller an additional role profile (never removes one, so no data is
    cascade-deleted). Hard-gated on settings.DEBUG — answers 404 in
    production, so it can never be used for real privilege escalation."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=dict, responses={200: UserProfileSerializer, 400: dict, 404: dict})
    def post(self, request):
        from decimal import Decimal
        from django.conf import settings
        from django.http import Http404
        from marketplace.models import DriverProfile
        from .models import LandlordProfile, AgentProfile, StudentProfile, TechnicianProfile

        if not settings.DEBUG:
            raise Http404

        user = request.user
        role = request.data.get("role")
        if role == "renter":
            pass
        elif role == "landlord":
            LandlordProfile.objects.get_or_create(user=user)
        elif role == "agent":
            AgentProfile.objects.get_or_create(user=user, defaults={"agent_commission_percent": Decimal("5.00")})
        elif role == "student":
            StudentProfile.objects.get_or_create(user=user, defaults={"institution_name": "Dev Test University"})
        elif role == "driver":
            profile, _ = DriverProfile.objects.get_or_create(user=user, defaults={"license_number": "DEV-LICENSE"})
            if not profile.is_verified:
                profile.is_verified = True
                profile.save(update_fields=["is_verified"])
        elif role == "technician":
            profile, _ = TechnicianProfile.objects.get_or_create(user=user, defaults={"specialties": []})
            if not profile.is_verified:
                profile.is_verified = True
                profile.save(update_fields=["is_verified"])
        else:
            return Response({"detail": f"Unknown role '{role}'."}, status=status.HTTP_400_BAD_REQUEST)

        user.refresh_from_db()
        return Response(UserProfileSerializer(user).data)


class MfaSetupView(APIView):
    """Step 1: register a new MFA method (SMS or Email) for the
    logged-in user and immediately send the first real code — the
    method starts UNVERIFIED until the matching code is confirmed via
    MfaVerifyView, so it can never silently satisfy user_has_verified_mfa
    just by being created."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=dict, responses={201: dict, 400: dict})
    def post(self, request):
        mfa_type = request.data.get("mfa_type")
        destination = request.data.get("destination")
        if mfa_type not in ("SMS_OTP", "EMAIL_OTP"):
            return Response({"detail": "mfa_type must be SMS_OTP or EMAIL_OTP."}, status=status.HTTP_400_BAD_REQUEST)
        if not destination:
            return Response({"detail": "destination (phone number or email) is required."}, status=status.HTTP_400_BAD_REQUEST)

        method, _ = MfaMethod.objects.get_or_create(
            user=request.user, mfa_type=mfa_type, destination=destination, defaults={"verified": False},
        )
        challenge = issue_mfa_challenge(method)
        return Response({"mfa_method_id": str(method.id), "challenge_id": str(challenge.id)}, status=status.HTTP_201_CREATED)


class MfaVerifyView(APIView):
    """Step 2: submit the code that was actually sent. On success, the
    MfaMethod itself is marked verified — THIS is the exact moment
    user_has_verified_mfa(user) starts returning True, which is what
    IsVerifiedAndMfaEnabled checks everywhere else in the platform."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=dict, responses={200: dict, 400: dict, 404: dict})
    def post(self, request):
        from .models import MfaChallenge

        challenge_id = request.data.get("challenge_id")
        code = request.data.get("code")
        try:
            challenge = MfaChallenge.objects.get(id=challenge_id, mfa_method__user=request.user)
        except MfaChallenge.DoesNotExist:
            return Response({"detail": "Unknown challenge."}, status=status.HTTP_404_NOT_FOUND)

        if not challenge.verify(code):
            return Response({"detail": "Incorrect or expired code."}, status=status.HTTP_400_BAD_REQUEST)

        method = challenge.mfa_method
        method.verified = True
        method.save(update_fields=["verified"])
        return Response({"detail": "MFA verified.", "mfa_enabled": user_has_verified_mfa(request.user)})


class MyMfaStatusView(APIView):
    """Lets the frontend check, at any point, whether the logged-in
    user has already completed MFA — so a 'list a property' page can
    show the real current state instead of guessing."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response({"mfa_enabled": user_has_verified_mfa(request.user)})


class MyReferralCodeView(APIView):
    """A user's own, real, persistent referral code — generated on
    first request if they don't have one yet, per get_or_create_
    referral_code()'s own lazy-generation design."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .services import get_or_create_referral_code
        return Response({"referral_code": get_or_create_referral_code(request.user)})


class MyKycView(APIView):
    """A real gap this closed: KYCProfile could only ever be created
    directly in the database — no real user had any way to actually
    submit their own identity information. GET reports whatever the
    user has submitted so far (or 404 if nothing yet); POST creates it
    on first submission, or updates it on resubmission — but ONLY while
    still PENDING/REJECTED. A VERIFIED profile can't be casually
    overwritten by the same endpoint that submitted it."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: KYCProfileSerializer, 404: dict})
    def get(self, request):
        if not hasattr(request.user, "kyc_profile"):
            return Response({"detail": "No KYC information submitted yet."}, status=status.HTTP_404_NOT_FOUND)
        return Response(KYCProfileSerializer(request.user.kyc_profile).data)

    @extend_schema(request=KYCProfileSerializer, responses={200: KYCProfileSerializer, 201: KYCProfileSerializer, 403: dict})
    def post(self, request):
        existing = getattr(request.user, "kyc_profile", None)
        if existing is not None and existing.kyc_status == VerificationStatus.VERIFIED:
            return Response({"detail": "Your KYC is already verified and cannot be resubmitted."}, status=status.HTTP_403_FORBIDDEN)

        serializer = KYCProfileSerializer(instance=existing, data=request.data)
        serializer.is_valid(raise_exception=True)
        if existing is not None:
            serializer.save(kyc_status=VerificationStatus.PENDING)
            return Response(serializer.data, status=status.HTTP_200_OK)
        serializer.save(user=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AdminKYCReviewViewSet(viewsets.ReadOnlyModelViewSet):
    """The other real half of the same gap: a real user could submit
    KYC via MyKycView above, but nothing ever let an admin actually
    approve or reject it — kyc_status could only ever move away from
    PENDING through direct database/shell access, meaning
    IsVerifiedAndMfaEnabled could never really be satisfied by a real
    user in production. Read-only list (queue of PENDING submissions)
    plus explicit approve/reject actions, same shape as
    trust_safety.AdminVerificationRequestViewSet."""
    serializer_class = AdminKYCProfileSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return KYCProfile.objects.none()
        return KYCProfile.objects.filter(kyc_status=VerificationStatus.PENDING).select_related("user").order_by("submitted_at")

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        kyc_profile = self.get_object()
        approve_kyc(kyc_profile)
        return Response(AdminKYCProfileSerializer(kyc_profile).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        kyc_profile = self.get_object()
        reject_kyc(kyc_profile, reason=request.data.get("reason", ""))
        return Response(AdminKYCProfileSerializer(kyc_profile).data)


class ChangePasswordView(APIView):
    """The logged-in 'change my password' flow — distinct from the
    forgot-password reset flow below, which doesn't require knowing the
    current password. Requires proving the CURRENT password first."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=ChangePasswordSerializer, responses={200: dict, 400: dict})
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["current_password"]):
            return Response({"detail": "Current password is incorrect."}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Password changed successfully."})


class PasswordResetRequestView(APIView):
    """Step 1 of the forgot-password flow — request_password_reset()
    and confirm_password_reset() already existed, fully implemented and
    tested at the service layer, but neither was ever reachable over
    real HTTP; a real user who forgot their password had no way to
    actually start a reset. Deliberately returns the SAME generic
    response whether or not the username exists, so this endpoint can
    never be used to enumerate real accounts."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AnonRateThrottle]

    @extend_schema(request=PasswordResetRequestSerializer, responses={200: dict})
    def post(self, request):
        from .services import request_password_reset

        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = User.objects.get(username=serializer.validated_data["username"])
            request_password_reset(user)
        except User.DoesNotExist:
            pass
        return Response({"detail": "If that account exists, password reset instructions have been sent."})


class PasswordResetConfirmView(APIView):
    """Step 2 — submits the real token from request_password_reset()
    plus a new password."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AnonRateThrottle]

    @extend_schema(request=PasswordResetConfirmSerializer, responses={200: dict, 400: dict})
    def post(self, request):
        from .services import confirm_password_reset, InvalidResetTokenError

        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            confirm_password_reset(
                token_value=serializer.validated_data["token"],
                new_password=serializer.validated_data["new_password"],
            )
        except InvalidResetTokenError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Password reset successfully. You can now log in with your new password."})


class UserPublicIndexView(APIView):
    """Public User Index Page / Profile Hub.
    Surfaces the user's role-specific owned portfolio (hotels, hostels,
    guest houses, event venues, apartments, houses, land, listings)
    and public credibility metrics. Anyone can browse or scan via QR code."""
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict, 404: dict})
    def get(self, request, user_id):
        from .services import get_user_public_index

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(get_user_public_index(user))

