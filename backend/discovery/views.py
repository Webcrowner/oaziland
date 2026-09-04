"""
discovery.views — the wanted-listing board. list/retrieve are public
(anyone should be able to browse open requests to respond to);
creating a request or a response requires login.
"""
from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import WantedListing, WantedListingStatus
from .serializers import WantedListingSerializer, WantedListingResponseSerializer
from .services import respond_to_wanted_listing, mark_wanted_listing_fulfilled


class WantedListingViewSet(viewsets.ModelViewSet):
    serializer_class = WantedListingSerializer
    queryset = WantedListing.objects.filter(status=WantedListingStatus.OPEN).order_by("-created_at")

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WantedListing.objects.none()
        if self.action == "list":
            return self.queryset
        return WantedListing.objects.all()

    def perform_create(self, serializer):
        serializer.save(seeker=self.request.user)

    @action(detail=True, methods=["post"])
    def respond(self, request, pk=None):
        wanted_listing = self.get_object()
        response = respond_to_wanted_listing(wanted_listing=wanted_listing, responder=request.user, message=request.data.get("message", ""))
        return Response(WantedListingResponseSerializer(response).data, status=201)

    @action(detail=True, methods=["post"])
    def mark_fulfilled(self, request, pk=None):
        wanted_listing = self.get_object()
        if wanted_listing.seeker_id != request.user.id:
            return Response({"detail": "Only the original seeker can mark this fulfilled."}, status=403)
        mark_wanted_listing_fulfilled(wanted_listing)
        return Response(WantedListingSerializer(wanted_listing).data)
