"""engagement.views — the public Contact Us endpoint."""
from rest_framework import permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from drf_spectacular.utils import extend_schema
from .services import submit_contact_message


class ContactMessageView(APIView):
    """Deliberately AllowAny — a prospective user should be able to
    reach out before ever creating an account, same reasoning as
    registration itself. Rate-limited to prevent spam submission."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AnonRateThrottle]

    @extend_schema(request=dict, responses={201: dict, 400: dict})
    def post(self, request):
        name = request.data.get("name")
        email = request.data.get("email")
        message = request.data.get("message")
        if not all([name, email, message]):
            return Response({"detail": "name, email, and message are all required."}, status=status.HTTP_400_BAD_REQUEST)

        submit_contact_message(name=name, email=email, message=message)
        return Response({"detail": "Message sent."}, status=status.HTTP_201_CREATED)
