"""
discovery.views — the wanted-listing board. list/retrieve are public
(anyone should be able to browse open requests to respond to);
creating a request or a response requires login.
"""
from rest_framework import viewsets, permissions, status, views
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import WantedListing, WantedListingStatus, SavedSearch, PropertyComparison
from .serializers import WantedListingSerializer, WantedListingResponseSerializer, SavedSearchSerializer, PropertyComparisonSerializer
from .services import respond_to_wanted_listing, mark_wanted_listing_fulfilled, create_or_update_comparison, ComparisonLimitError


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


class SavedSearchViewSet(viewsets.ModelViewSet):
    """A real gap this closes: check_saved_searches_for_new_listing()
    could MATCH against saved searches, and publish_listing_and_notify()
    (now correctly wired into the real approve() endpoint) actually
    triggers that check — but nothing ever let a user CREATE a saved
    search at all. Scoped to the requester's own searches only."""
    serializer_class = SavedSearchSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return SavedSearch.objects.none()
        return SavedSearch.objects.filter(user=self.request.user).order_by("-id")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class MyComparisonView(views.APIView):
    """WHY this is a singleton view, not a ModelViewSet: create_or_
    update_comparison() uses update_or_create(user=user, ...) — there
    is exactly ONE comparison per user, always updated in place, never
    a list of many. A full CRUD ViewSet here would misrepresent what
    this actually is."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: PropertyComparisonSerializer, 404: dict})
    def get(self, request):
        comparison = PropertyComparison.objects.filter(user=request.user).first()
        if comparison is None:
            return Response({"detail": "No comparison set yet."}, status=status.HTTP_404_NOT_FOUND)
        return Response(PropertyComparisonSerializer(comparison).data)

    @extend_schema(request=dict, responses={200: PropertyComparisonSerializer, 400: dict})
    def post(self, request):
        listing_ids = request.data.get("listing_ids", [])
        try:
            comparison = create_or_update_comparison(user=request.user, listing_ids=listing_ids)
        except ComparisonLimitError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PropertyComparisonSerializer(comparison).data, status=status.HTTP_200_OK)


class ListingWaitlistView(views.APIView):
    """The real gap this closes: join_listing_waitlist()/
    notify_waitlist_on_availability() (Prompt 15's 'NEW — Waitlist')
    were fully built and unit-tested, but nothing ever let a real user
    actually join one."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={201: dict})
    def post(self, request, listing_id):
        from .models import ListingWaitlistEntry
        from .services import join_listing_waitlist
        already_joined = ListingWaitlistEntry.objects.filter(user=request.user, listing_id=listing_id).exists()
        join_listing_waitlist(user=request.user, listing_id=listing_id)
        return Response({"joined": True, "already_joined": already_joined}, status=status.HTTP_201_CREATED)
