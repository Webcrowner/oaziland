"""
monetization.views — the real Creator Premium subscription endpoint.
"""
from rest_framework import permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .services import subscribe_to_creator_premium, cancel_creator_premium, is_premium_creator


class MyCreatorPremiumView(APIView):
    """A small, low-cost subscription — reuses the SAME PaymentGateway
    interface as every other payment on the platform, no separate
    checkout pathway."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response({"is_premium": is_premium_creator(request.user)})

    @extend_schema(request=dict, responses={200: dict, 400: dict})
    def post(self, request):
        from payments.gateways import get_active_gateway
        phone_number = request.data.get("phone_number")
        if not phone_number:
            return Response({"detail": "phone_number is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            subscribe_to_creator_premium(user=request.user, payment_gateway=get_active_gateway(), phone_number=phone_number)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"is_premium": True})

    @extend_schema(responses={200: dict})
    def delete(self, request):
        cancel_creator_premium(request.user)
        return Response({"detail": "Subscription cancelled — perks remain active until the current period ends."})
