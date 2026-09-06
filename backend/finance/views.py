"""
finance.views — the real gap this closes: estimate_property_value()
and estimate_affordable_rent_range() had real, working logic and even
a real model to store results in, but NO endpoint anywhere ever
exposed either one. Public: neither tool requires an account to use,
matching how every other browse/search surface on this platform works.
"""
from rest_framework import permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .serializers import ValuationEstimateSerializer, ValuationRequestSerializer, AffordabilityRequestSerializer
from .services import estimate_property_value, estimate_affordable_rent_range


class PropertyValuationView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=ValuationRequestSerializer, responses={201: ValuationEstimateSerializer, 400: dict})
    def post(self, request):
        from geo.models import Quarter

        input_serializer = ValuationRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            quarter = Quarter.objects.get(id=input_serializer.validated_data["quarter"])
        except Quarter.DoesNotExist:
            return Response({"detail": "That neighborhood was not found."}, status=status.HTTP_400_BAD_REQUEST)

        requester = request.user if request.user.is_authenticated else None
        estimate = estimate_property_value(
            quarter=quarter, property_type=input_serializer.validated_data["property_type"], requested_by=requester,
        )
        return Response(ValuationEstimateSerializer(estimate).data, status=status.HTTP_201_CREATED)


class AffordabilityEstimateView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=AffordabilityRequestSerializer, responses={200: dict})
    def post(self, request):
        input_serializer = AffordabilityRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        result = estimate_affordable_rent_range(monthly_income_xaf=input_serializer.validated_data["monthly_income_xaf"])
        return Response(result)
