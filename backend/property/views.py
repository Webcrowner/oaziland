"""
property.views — the Listing search/browse API. Reuses the EXISTING
search_listings_by_quarter/search_listings_with_filters service
functions (Prompts 8/12) rather than reimplementing filtering logic at
the API layer — the API is a thin wrapper around already-tested
business logic, not a second copy of it.
"""
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError

from rest_framework import viewsets, permissions, status, views, generics
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from drf_spectacular.utils import extend_schema

from .models import Listing, ListingStatus, ListingType, House, Shop
from .serializers import ListingSerializer, ListingEditSerializer, HouseCreateSerializer, ShopCreateSerializer
from .services import get_landlord_portfolio_summary
from oaziland.permissions import IsAdminRole, IsOwnerOrReadOnly, IsKycVerified


class ListingViewSet(viewsets.ModelViewSet):
    """list/retrieve are public (AllowAny) — browsing listings should
    never require an account, matching how the actual platform works.
    create is the platform's real 'publish' moment — this is where KYC
    is actually enforced (IsKycVerified) — MFA is no longer required
    anywhere on the platform, just an optional feature a user can turn
    on for themselves from account/dashboard settings; only the
    listing's own agent/landlord can update/delete it."""
    serializer_class = ListingSerializer
    # prefetch_related("photos") — the serializer's get_photos() calls
    # listing.photos.all() for every row; without this it's a real N+1
    # (one extra query per listing in a paginated list of 20).
    queryset = Listing.objects.filter(status=ListingStatus.PUBLISHED).select_related("property_asset", "property_asset__quarter", "property_asset__house").prefetch_related("photos").order_by("-published_at")
    throttle_scope = "search"
    throttle_classes = [ScopedRateThrottle]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.AllowAny()]
        if self.action == "create":
            return [IsKycVerified()]
        if self.action in ["approve", "reject", "pending"]:
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
            return Listing.objects.select_related("property_asset", "property_asset__quarter", "property_asset__house")

        quarter_id = self.request.query_params.get("quarter")
        property_type = self.request.query_params.get("property_type")
        finish_level = self.request.query_params.get("finish_level")
        listing_type = self.request.query_params.get("listing_type")
        ordering = self.request.query_params.get("ordering")  # "price_asc" | "price_desc" | "newest"
        max_price = None
        try:
            raw_max_price = self.request.query_params.get("max_price")
            max_price = Decimal(raw_max_price) if raw_max_price else None
        except InvalidOperation:
            max_price = None  # a malformed budget is ignored rather than failing the whole search

        if quarter_id:
            from geo.models import Quarter
            from .services import search_listings_by_quarter
            try:
                quarter = Quarter.objects.get(id=quarter_id)
            except (Quarter.DoesNotExist, ValidationError, ValueError):
                return Listing.objects.none()
            results = search_listings_by_quarter(
                quarter, property_type=property_type, finish_level=finish_level, listing_type=listing_type,
            )
            result_ids = [listing.id for listing in results]
            queryset = Listing.objects.filter(id__in=result_ids).select_related("property_asset", "property_asset__quarter", "property_asset__house")
            if max_price is not None:
                queryset = queryset.filter(price_xaf__lte=max_price)
            if ordering == "price_asc":
                return queryset.order_by("price_xaf")
            if ordering == "price_desc":
                return queryset.order_by("-price_xaf")
            if ordering == "newest":
                return queryset.order_by("-published_at")
            # Default: preserve the search's own ranking (boosted listings first)
            # rather than letting the queryset's default ordering win.
            preserved_order = {pk: i for i, pk in enumerate(result_ids)}
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
        if max_price is not None:
            queryset = queryset.filter(price_xaf__lte=max_price)
        if ordering == "price_asc":
            queryset = queryset.order_by("price_xaf")
        elif ordering == "price_desc":
            queryset = queryset.order_by("-price_xaf")
        return queryset

    def perform_create(self, serializer):
        """WHY listed_by must be set HERE, never accepted from the
        request body: it must always be the actual authenticated
        requester — accepting it as client input would let anyone
        create a listing attributed to someone else's account."""
        serializer.save(listed_by=self.request.user)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """Admin-only, per the RBAC matrix's explicit rule: 'only Admin
        can approve a listing.'

        WHY publish_listing_and_notify(), not a bare listing.publish():
        this endpoint previously called publish() directly, which
        SKIPPED check_saved_searches_for_new_listing() entirely —
        meaning saved-search alerts had never actually fired for any
        real, admin-approved listing through the real API, despite
        the notification-triggering function existing and being tested.

        WHY ContentBlockedError is caught explicitly here: without
        this, a moderation-blocked listing crashed with an uncaught
        500 instead of a clean, expected 400 — found by this
        endpoint's own test on the first run, the same class of gap as
        AlreadyEnrolledError needing to be caught in the training
        enrollment endpoint."""
        from discovery.services import publish_listing_and_notify
        from trust_safety.services import ContentBlockedError
        listing = self.get_object()
        try:
            publish_listing_and_notify(listing)
        except ContentBlockedError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ListingSerializer(listing).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """Admin-only rejection of a pending listing."""
        listing = self.get_object()
        listing.status = ListingStatus.REJECTED
        listing.save(update_fields=["status"])
        return Response(ListingSerializer(listing).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="pending")
    def pending(self, request):
        """Admin queue for all listings awaiting moderation review."""
        queryset = Listing.objects.filter(status=ListingStatus.PENDING_REVIEW).select_related(
            "property_asset", "property_asset__quarter"
        ).order_by("-created_at")
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = ListingSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = ListingSerializer(queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        # Plain PUT/PATCH share the edit path so a lister can never re-point a listing at someone else's property.
        return self.edit_details(request, pk=kwargs.get("pk"))

    @extend_schema(request=ListingEditSerializer, responses={200: ListingSerializer, 400: dict})
    @action(detail=True, methods=["patch"], url_path="edit-details")
    def edit_details(self, request, pk=None):
        """The lister (landlord or agent) edits price, type and the property's own details. Only the
        lister passes IsOwnerOrReadOnly; a changed price never sends a live listing back to review."""
        from .services import update_listing_details, ListingEditError, InvalidAmenityError

        listing = self.get_object()
        serializer = ListingEditSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            update_listing_details(listing, serializer.validated_data)
        except (ListingEditError, InvalidAmenityError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        listing.refresh_from_db()
        return Response(ListingSerializer(listing).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def renew(self, request, pk=None):
        """Self-service renewal — only the listing's own agent/landlord
        can renew it (IsOwnerOrReadOnly, applied via get_permissions
        for every non-list/retrieve/approve action)."""
        listing = self.get_object()
        listing.renew()
        return Response(ListingSerializer(listing).data, status=status.HTTP_200_OK)

    # What the lister may do without admin review: a listing that was already approved can be
    # paused, marked rented/sold, or reopened. Never into DRAFT/PENDING/REJECTED/EXPIRED.
    OWNER_STATUS_TRANSITIONS = {
        ListingStatus.PUBLISHED: {ListingStatus.UNDER_OFFER, ListingStatus.CLOSED},
        ListingStatus.UNDER_OFFER: {ListingStatus.PUBLISHED, ListingStatus.CLOSED},
        ListingStatus.CLOSED: {ListingStatus.PUBLISHED},
    }

    @extend_schema(request=dict, responses={200: ListingSerializer, 400: dict})
    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, pk=None):
        listing = self.get_object()
        new_status = request.data.get("status")
        allowed = self.OWNER_STATUS_TRANSITIONS.get(listing.status, set())
        if new_status not in allowed:
            return Response(
                {"detail": f"A {listing.get_status_display().lower()} listing can't be changed to '{new_status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if new_status == ListingStatus.PUBLISHED and listing.published_at is None:
            return Response({"detail": "This listing was never approved, so it can't be reopened."}, status=status.HTTP_400_BAD_REQUEST)
        listing.status = new_status
        listing.save(update_fields=["status"])
        return Response(ListingSerializer(listing).data, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        listing = self.get_object()
        if listing.status in (ListingStatus.PUBLISHED, ListingStatus.UNDER_OFFER):
            return Response(
                {"detail": "A live listing can't be deleted — mark it as closed first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

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

    @action(detail=True, methods=["post"], url_path="add-photo")
    def add_photo(self, request, pk=None):
        """The real gap this closes: Listing had no photo field at
        all. Takes a URL already produced by /api/media/upload/ —
        two separate steps (upload the file, then attach the
        resulting URL) rather than one combined endpoint, so the same
        upload endpoint serves listings, posts, and anything else
        that needs a real file uploaded, without this view needing to
        know anything about file handling itself."""
        from .models import ListingPhoto

        listing = self.get_object()
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required — upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        is_first_photo = not listing.photos.exists()
        photo = ListingPhoto.objects.create(listing=listing, url=url, media_type=media_type, is_primary=is_first_photo)
        return Response({"id": photo.id, "url": photo.url, "media_type": photo.media_type, "is_primary": photo.is_primary}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-photo")
    def remove_photo(self, request, pk=None):
        from .models import ListingPhoto

        listing = self.get_object()
        photo_id = request.data.get("photo_id")
        deleted_count, _ = ListingPhoto.objects.filter(listing=listing, id=photo_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Photo not found on this listing."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PropertyAmenitiesMixin:
    """Shared real actions for setting amenities, house rules, and
    nearby facilities — lives once here rather than duplicated across
    House/Shop/Land's three separate ViewSets, since all three inherit
    the same PropertyAsset fields these actions operate on. Only the
    property's own owner can set these (IsOwnerOrReadOnly, already
    the fallback permission on every one of these ViewSets)."""

    @action(detail=True, methods=["post"], url_path="set-amenities")
    def set_amenities(self, request, pk=None):
        from .services import set_property_amenities, InvalidAmenityError
        property_asset = self.get_object()
        try:
            set_property_amenities(property_asset, request.data.get("amenities", []))
        except InvalidAmenityError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"amenities": property_asset.amenities})

    @action(detail=True, methods=["post"], url_path="set-house-rules")
    def set_house_rules_action(self, request, pk=None):
        from .services import set_house_rules, InvalidHouseRuleError
        property_asset = self.get_object()
        try:
            set_house_rules(property_asset, request.data.get("house_rules", []))
        except InvalidHouseRuleError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"house_rules": property_asset.house_rules})

    @action(detail=True, methods=["post"], url_path="set-nearby-facilities")
    def set_nearby_facilities_action(self, request, pk=None):
        from .services import set_nearby_facilities
        property_asset = self.get_object()
        set_nearby_facilities(property_asset, request.data.get("point_of_interest_ids", []))
        return Response({"nearby_facilities": list(property_asset.nearby_facilities.values_list("id", flat=True))})

    @action(detail=True, methods=["post"], url_path="set-location")
    def set_location_action(self, request, pk=None):
        property_asset = self.get_object()
        if property_asset.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the property owner can set its location."}, status=status.HTTP_403_FORBIDDEN)
        lat = request.data.get("latitude")
        lng = request.data.get("longitude")
        if lat is None or lng is None:
            return Response({"detail": "latitude and longitude are required."}, status=status.HTTP_400_BAD_REQUEST)
        property_asset.latitude = lat
        property_asset.longitude = lng
        property_asset.save(update_fields=["latitude", "longitude"])
        return Response({"id": str(property_asset.id), "latitude": str(property_asset.latitude), "longitude": str(property_asset.longitude)})


class HouseViewSet(PropertyAmenitiesMixin, viewsets.ModelViewSet):
    """Real property-creation, closing a genuine gap: Listing.create()
    could only ATTACH to an already-existing PropertyAsset — nothing
    ever let a user create the House itself. list/retrieve are public
    (browsing someone's property details isn't sensitive); create only
    requires being signed in — KYC is enforced at the point the
    property actually goes public (ListingViewSet.create, the
    'publish' step), not at this earlier, lower-stakes asset-creation
    step, per the platform's KYC-at-publish policy."""
    serializer_class = HouseCreateSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.AllowAny()]
        if self.action == "create":
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsOwnerOrReadOnly()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return House.objects.none()
        return House.objects.all()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user, type="HOUSE")


class ShopViewSet(PropertyAmenitiesMixin, viewsets.ModelViewSet):
    """Same deferred-KYC policy as HouseViewSet — see its docstring."""
    serializer_class = ShopCreateSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [permissions.AllowAny()]
        if self.action == "create":
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsOwnerOrReadOnly()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Shop.objects.none()
        return Shop.objects.all()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user, type="SHOP")


class MyListingsView(generics.ListAPIView):
    """Everything the caller has listed, in every status (drafts, pending review, rejected,
    expired...) — the public listings endpoint only ever shows PUBLISHED ones."""
    serializer_class = ListingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Listing.objects.none()
        queryset = (
            Listing.objects.filter(listed_by=self.request.user)
            .select_related("property_asset", "property_asset__quarter", "property_asset__house")
            .prefetch_related("photos")
            .order_by("-created_at")
        )
        status_filter = self.request.query_params.get("status")
        if status_filter in ListingStatus.values:
            queryset = queryset.filter(status=status_filter)
        return queryset


class MyLandlordPortfolioView(views.APIView):
    """A real gap this closes: get_landlord_portfolio_summary() already
    aggregated across every property type a landlord owns (house, land,
    shop, warehouse...) with a real bookings trend, but nothing ever
    exposed it — same class of gap as the technician/agent dashboards."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(get_landlord_portfolio_summary(request.user))
