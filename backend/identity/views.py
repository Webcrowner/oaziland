"""identity.views — registration and 'my profile' endpoints. JWT
login/refresh itself is handled by simplejwt's built-in views, wired
directly in oaziland/urls.py rather than duplicated here."""
from rest_framework import generics, permissions
from rest_framework.throttling import AnonRateThrottle
from .models import User
from .serializers import RegisterSerializer, UserProfileSerializer


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
