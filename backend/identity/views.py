"""identity.views — registration, 'my profile', and MFA setup/verify
endpoints. JWT login/refresh itself is handled by simplejwt's built-in
views, wired directly in oaziland/urls.py rather than duplicated here.

WHY the MFA endpoints matter: issue_mfa_challenge() and MfaChallenge.
verify() (identity/services.py, identity/models.py) already existed
and were already tested — but NOTHING exposed them over real HTTP.
IsVerifiedAndMfaEnabled is enforced everywhere sensitive (listing a
property, making a booking), yet there was no way for a real user to
ever actually SATISFY that requirement — a genuinely blocking gap,
not a cosmetic one.
"""
from rest_framework import generics, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from drf_spectacular.utils import extend_schema
from .models import User, MfaMethod
from .serializers import RegisterSerializer, UserProfileSerializer
from .services import issue_mfa_challenge, user_has_verified_mfa


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
