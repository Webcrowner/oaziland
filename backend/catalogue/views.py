"""
catalogue.views — the real, public 'Services' browse API. Public
because knowing what services a marketplace offers (before ever
signing up) is exactly the kind of thing that should be visible
without an account, same as browsing a listing.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import PartnerServiceCategory, PartnerServiceOffering
from .serializers import PartnerServiceCategorySerializer, RequestPartnerServiceSerializer, PartnerServiceRequestSerializer
from .services import request_partner_service


class PartnerServiceCategoryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PartnerServiceCategorySerializer
    queryset = PartnerServiceCategory.objects.prefetch_related("offerings").order_by("name")
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PartnerServiceCategory.objects.none()
        return self.queryset


class RequestPartnerServiceView(APIView):
    """The real gap this closes: request_partner_service() was fully
    built and tested, but the Partner Services directory was
    browse-only — nothing ever let a real user actually request one
    of these services (notary, moving, photography, etc.)."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=RequestPartnerServiceSerializer, responses={201: PartnerServiceRequestSerializer, 404: dict})
    def post(self, request):
        input_serializer = RequestPartnerServiceSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        offering = PartnerServiceOffering.objects.filter(id=input_serializer.validated_data["offering"], is_active=True).first()
        if offering is None:
            return Response({"detail": "That service offering was not found."}, status=status.HTTP_404_NOT_FOUND)
        service_request = request_partner_service(
            offering=offering, requester=request.user, notes=input_serializer.validated_data["notes"],
        )
        return Response(PartnerServiceRequestSerializer(service_request).data, status=status.HTTP_201_CREATED)


class MyPartnerServiceRequestsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        requests = request.user.partner_service_requests.select_related("offering").order_by("-requested_at")
        return Response({"count": requests.count(), "results": PartnerServiceRequestSerializer(requests, many=True).data})
