"""
property.views — the Listing search/browse API. Reuses the EXISTING
search_listings_by_quarter/search_listings_with_filters service
functions (Prompts 8/12) rather than reimplementing filtering logic at
the API layer — the API is a thin wrapper around already-tested
business logic, not a second copy of it.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .models import Listing, ListingStatus
from .serializers import ListingSerializer
from oaziland.permissions import IsAdminRole, IsOwnerOrReadOnly, IsVerifiedAndMfaEnabled


class ListingViewSet(viewsets.ModelViewSet):
    """list/retrieve are public (AllowAny) — browsing listings should
    never require an account, matching how the actual platform works.
    create requires MFA+KYC (per the platform-wide enforcement rule);
    only the listing's own agent/landlord can update/delete it."""
    serializer_class = ListingSerializer
    queryset = Listing.objects.filter(status=ListingStatus.PUBLISHED).select_related("property_asset", "property_asset__quarter").order_by("-published_at")
    throttle_scope = "search"
    throttle_classes = [ScopedRateThrottle]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.AllowAny()]
        if self.action == "create":
            return [IsVerifiedAndMfaEnabled()]
        if self.action == "approve":
            return [IsAdminRole()]
        return [permissions.IsAuthenticated(), IsOwnerOrReadOnly()]

    def get_queryset(self):
        """WHY 'list' is scoped to PUBLISHED but other actions aren't:
        public search should only ever surface published listings, but
        an admin approving a PENDING_REVIEW listing, or an owner editing
        their own DRAFT, needs to actually be able to FIND that listing
        first — filtering everything to PUBLISHED-only would make
        approval permanently impossible, which is exactly the bug this
        fix corrects."""
        if self.action != "list":
            return Listing.objects.select_related("property_asset", "property_asset__quarter")

        quarter_id = self.request.query_params.get("quarter")
        if quarter_id:
            from geo.models import Quarter
            from .services import search_listings_by_quarter
            try:
                quarter = Quarter.objects.get(id=quarter_id)
            except Quarter.DoesNotExist:
                return Listing.objects.none()
            results = search_listings_by_quarter(
                quarter,
                property_type=self.request.query_params.get("property_type"),
                finish_level=self.request.query_params.get("finish_level"),
            )
            result_ids = [listing.id for listing in results]
            # Preserve the search's own ranking (boosted listings first)
            # rather than letting the queryset's default ordering win.
            preserved_order = {pk: i for i, pk in enumerate(result_ids)}
            queryset = Listing.objects.filter(id__in=result_ids).select_related("property_asset", "property_asset__quarter")
            return sorted(queryset, key=lambda listing: preserved_order[listing.id])
        return self.queryset

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """Admin-only, per the RBAC matrix's explicit rule: 'only Admin
        can approve a listing.'"""
        listing = self.get_object()
        listing.publish()
        return Response(ListingSerializer(listing).data, status=status.HTTP_200_OK)
