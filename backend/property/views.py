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

from .models import Listing, ListingStatus, ListingType
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
        if self.action == "contact":
            # WHY just IsAuthenticated, not IsOwnerOrReadOnly: ANY
            # logged-in user should be able to contact a lister about
            # THEIR listing — IsOwnerOrReadOnly would backwards-restrict
            # this to only the listing's own owner contacting themselves.
            # build_whatsapp_action() writes a real ActionLog row, and
            # ActionLog.triggered_by is a required field — there is no
            # anonymous identity to attribute the action to, so this
            # can't be AllowAny either.
            return [permissions.IsAuthenticated()]
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
        property_type = self.request.query_params.get("property_type")
        finish_level = self.request.query_params.get("finish_level")
        listing_type = self.request.query_params.get("listing_type")

        if quarter_id:
            from geo.models import Quarter
            from .services import search_listings_by_quarter
            try:
                quarter = Quarter.objects.get(id=quarter_id)
            except Quarter.DoesNotExist:
                return Listing.objects.none()
            results = search_listings_by_quarter(
                quarter, property_type=property_type, finish_level=finish_level, listing_type=listing_type,
            )
            result_ids = [listing.id for listing in results]
            # Preserve the search's own ranking (boosted listings first)
            # rather than letting the queryset's default ordering win.
            preserved_order = {pk: i for i, pk in enumerate(result_ids)}
            queryset = Listing.objects.filter(id__in=result_ids).select_related("property_asset", "property_asset__quarter")
            return sorted(queryset, key=lambda listing: preserved_order[listing.id])

        # WHY this branch exists now, and didn't fully work before: with
        # no quarter given, every other filter (property_type,
        # finish_level, listing_type) was previously silently IGNORED —
        # self.queryset was returned completely unfiltered. A search for
        # 'houses for sale, any neighborhood' would have returned every
        # published listing of every type. Fixed to actually apply the
        # filters that were given, quarter or not.
        queryset = self.queryset
        if property_type:
            queryset = queryset.filter(property_asset__type=property_type)
        if finish_level:
            queryset = queryset.filter(property_asset__finish_level=finish_level)
        if listing_type:
            queryset = queryset.filter(listing_type=listing_type)
        return queryset

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """Admin-only, per the RBAC matrix's explicit rule: 'only Admin
        can approve a listing.'"""
        listing = self.get_object()
        listing.publish()
        return Response(ListingSerializer(listing).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def renew(self, request, pk=None):
        """Self-service renewal — only the listing's own agent/landlord
        can renew it (IsOwnerOrReadOnly, applied via get_permissions
        for every non-list/retrieve/approve action)."""
        listing = self.get_object()
        listing.renew()
        return Response(ListingSerializer(listing).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def contact(self, request, pk=None):
        """Generates a real WhatsApp deep link to the listing's own
        agent/landlord — reuses the EXISTING build_whatsapp_action()
        (with its own audit-logged ActionLog) rather than exposing raw
        phone numbers in the public search response."""
        from engagement.services import build_whatsapp_action
        from engagement.models import WhatsAppContext

        listing = self.get_object()
        if listing.lister_role != "OWNER":
            context = WhatsAppContext.CONTACT_AGENT
        elif listing.listing_type == ListingType.RENT:
            # A direct owner renting out their property IS a landlord.
            context = WhatsAppContext.CONTACT_LANDLORD
        else:
            # A direct owner selling outright is a seller, not a
            # landlord — see WhatsAppContext's own docstring for why
            # this distinction is real, not just wording preference.
            context = WhatsAppContext.CONTACT_SELLER
        action_result = build_whatsapp_action(
            context=context, triggered_by=request.user,
            target_object=listing, recipient_phone=listing.listed_by.phone,
            template_vars={"listing_id": str(listing.id)},
        )
        return Response({"deep_link": action_result["deep_link"], "message": action_result["message"]})
