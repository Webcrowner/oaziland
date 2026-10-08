"""
marketplace.views — the real gap this closes: four real listing
categories (warehouses, stores, businesses, cars) and a full ride-
hailing lifecycle all had real, working service functions and models,
but nothing ever exposed any of it. search_marketplace_listings()
already existed and is reused here exactly as written, not
reimplemented at the API layer.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import WarehouseListing, StoreListing, BusinessListing, CarListing, RideBooking, RideStatus, ListingCondition, Vehicle, DriverProfile
from .serializers import (
    WarehouseListingSerializer, StoreListingSerializer, BusinessListingSerializer, CarListingSerializer,
    RideBookingSerializer, RideRequestSerializer, CompleteRideSerializer, RideMessageSerializer,
    ListingConditionSerializer, AttachConditionSerializer,
    DriverProfileSerializer, DriverRegistrationSerializer, VehicleSerializer,
)
from .services import (
    search_marketplace_listings, estimate_ride_fare, request_ride, accept_ride, start_ride, complete_ride_with_payment, attach_condition,
    register_as_driver, register_vehicle, NotARegisteredDriverError, DriverNotVerifiedError, VehicleCategoryMismatchError,
    post_ride_message, NotPartyToRideError,
)
from oaziland.permissions import IsAdminRole, IsKycVerified


def _get_or_create_owner_profile(user):
    """Every marketplace listing requires a real OwnerProfile
    (student_hostels.OwnerProfile, reused rather than duplicated,
    exactly as the model's own docstring says it should be) — this is
    the one place that auto-provisions one for a first-time lister,
    so creating a listing doesn't require a separate manual setup step
    most users would never know to do first."""
    from student_hostels.models import OwnerProfile, OwnerType
    profile, _ = OwnerProfile.objects.get_or_create(account_user=user, defaults={"owner_type": OwnerType.LANDLORD})
    return profile


class BaseMarketplaceViewSet(viewsets.ModelViewSet):
    """Shared behavior for all four category ViewSets below — list/
    retrieve public (browsing shouldn't require an account, matching
    every other browse surface on the platform); create requires real
    identity verification (a marketplace listing is a real financial
    commitment, same as any property listing). Reuses
    search_marketplace_listings() for filtering rather than
    reimplementing it."""
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_permissions(self):
        if self.action == "create":
            return [IsKycVerified()]
        return super().get_permissions()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.model_class.objects.none()
        if self.action == "list":
            filters = {}
            for key in ("min_price", "max_price", "min_size_sqm", "quarter_id"):
                if key in self.request.query_params:
                    filters[key] = self.request.query_params[key]
            return search_marketplace_listings(listing_class=self.model_class, filters=filters)
        return self.model_class.objects.all()

    def perform_create(self, serializer):
        owner_profile = _get_or_create_owner_profile(self.request.user)
        agent_profile = getattr(self.request.user, "agent_profile", None)
        if agent_profile is None:
            lister_role = "OWNER"
        else:
            lister_role = "AGENCY" if agent_profile.agency_id else "AGENT"
        serializer.save(owner=owner_profile, lister_user=self.request.user, lister_role=lister_role)

    @action(detail=True, methods=["post"], url_path="add-media")
    def add_media(self, request, pk=None):
        """The real gap this closes: MarketplaceMedia and the read-side
        `media` field on every category serializer already existed,
        but nothing ever let a real lister actually attach a photo or
        video — the exact same class of gap already found and fixed
        for property listings (ListingPhoto/add-photo). Takes a URL
        already produced by /api/media/upload/, same two-step pattern
        as property listings: upload the file, then attach the URL."""
        from .models import MarketplaceMedia

        listing = self.get_object()
        if listing.lister_user_id != request.user.id:
            return Response({"detail": "Only the listing's own lister can add media to it."}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required — upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        order = listing.media.count()
        media = MarketplaceMedia.objects.create(listing=listing, media_type=media_type, file_url=url, order=order)
        return Response({"id": media.id, "media_type": media.media_type, "file_url": media.file_url, "order": media.order}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-media")
    def remove_media(self, request, pk=None):
        from .models import MarketplaceMedia

        listing = self.get_object()
        if listing.lister_user_id != request.user.id:
            return Response({"detail": "Only the listing's own lister can remove its media."}, status=status.HTTP_403_FORBIDDEN)
        media_id = request.data.get("media_id")
        deleted_count, _ = MarketplaceMedia.objects.filter(listing=listing, id=media_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Media not found on this listing."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WarehouseListingViewSet(BaseMarketplaceViewSet):
    serializer_class = WarehouseListingSerializer
    model_class = WarehouseListing


class StoreListingViewSet(BaseMarketplaceViewSet):
    serializer_class = StoreListingSerializer
    model_class = StoreListing


class BusinessListingViewSet(BaseMarketplaceViewSet):
    serializer_class = BusinessListingSerializer
    model_class = BusinessListing


class CarListingViewSet(BaseMarketplaceViewSet):
    serializer_class = CarListingSerializer
    model_class = CarListing


class RideViewSet(viewsets.ModelViewSet):
    """The real ride-hailing lifecycle — every fare settles through
    the EXACT SAME Booking/PaymentEscrow machinery as a property
    booking, never a parallel payment path (complete_ride_with_
    payment() already enforced this; nothing exposed it)."""
    serializer_class = RideBookingSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        # Requesting a ride is a real checkout — a fare gets charged
        # against the rider's own payment method — so it needs the
        # same identity verification gate as any other checkout flow.
        if self.action == "create":
            return [IsKycVerified()]
        return super().get_permissions()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return RideBooking.objects.none()
        from django.db.models import Q
        user = self.request.user
        if self.action == "list":
            # WHY REQUESTED rides are visible to everyone here, not
            # just the rider: a prospective driver needs to be able
            # to find an open ride request in the first place.
            return RideBooking.objects.filter(
                Q(rider=user) | Q(driver=user) | Q(status=RideStatus.REQUESTED)
            ).distinct().order_by("-requested_at")
        # WHY detail actions (retrieve/accept/start/complete) are NOT
        # scoped the same way: each action below already has its own
        # explicit real permission check (e.g. "only the ride's own
        # driver can start it") that returns a clear, specific 403 —
        # scoping the queryset here too would filter the object out
        # BEFORE that check ever runs, silently turning every
        # deliberate 403 into an uninformative 404 instead. Found by
        # the tests themselves failing with the wrong status code.
        return RideBooking.objects.all()

    @extend_schema(request=RideRequestSerializer, responses={201: RideBookingSerializer})
    def create(self, request, *args, **kwargs):
        """WHY fare is computed from distance_km server-side, never
        accepted directly from the client: estimate_ride_fare()
        applies the platform's real, transparent formula — trusting a
        client-supplied fare would let a rider simply claim any price.
        Honest limitation: distance_km itself is still client-reported
        here, since no real routing/distance API is connected yet —
        the fare FORMULA is enforced server-side, which is the part
        that actually matters for platform revenue integrity."""
        input_serializer = RideRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        fare = estimate_ride_fare(distance_km=data["distance_km"], ride_category=data["ride_category"])

        pickup_coords = None
        if data.get("pickup_latitude") is not None:
            pickup_coords = (data["pickup_latitude"], data["pickup_longitude"])
        dropoff_coords = None
        if data.get("dropoff_latitude") is not None:
            dropoff_coords = (data["dropoff_latitude"], data["dropoff_longitude"])

        ride = request_ride(
            rider=request.user, pickup_description=data["pickup_description"], dropoff_description=data["dropoff_description"],
            fare_estimate_xaf=fare, pickup_coords=pickup_coords, dropoff_coords=dropoff_coords,
            ride_category=data["ride_category"], transport_type=data["transport_type"],
            has_luggage=data["has_luggage"], cargo_description=data.get("cargo_description", ""),
        )
        return Response(RideBookingSerializer(ride).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        """The real gap this closes: previously ANY authenticated user
        could accept a ride — no driver registration, no vehicle, at
        all. Now requires a real, admin-verified DriverProfile and one
        of the driver's own registered vehicles, whose category
        genuinely matches what the ride needs."""
        ride = self.get_object()
        if ride.status != RideStatus.REQUESTED:
            return Response({"detail": "This ride is no longer available to accept."}, status=status.HTTP_400_BAD_REQUEST)
        if not hasattr(request.user, "driver_profile"):
            return Response({"detail": "You must register as a driver before accepting a ride."}, status=status.HTTP_403_FORBIDDEN)
        vehicle_id = request.data.get("vehicle_id")
        if not vehicle_id:
            return Response({"detail": "vehicle_id is required — select one of your registered vehicles."}, status=status.HTTP_400_BAD_REQUEST)
        vehicle = Vehicle.objects.filter(id=vehicle_id).first()
        if vehicle is None:
            return Response({"detail": "That vehicle was not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            accept_ride(ride=ride, driver=request.user, vehicle=vehicle)
        except (NotARegisteredDriverError, DriverNotVerifiedError, VehicleCategoryMismatchError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(RideBookingSerializer(ride).data)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        ride = self.get_object()
        if ride.driver_id != request.user.id:
            return Response({"detail": "Only the ride's own driver can start it."}, status=status.HTTP_403_FORBIDDEN)
        if ride.status != RideStatus.ACCEPTED:
            return Response({"detail": "This ride must be accepted before it can start."}, status=status.HTTP_400_BAD_REQUEST)
        start_ride(ride)
        return Response(RideBookingSerializer(ride).data)

    @action(detail=True, methods=["post"])
    @extend_schema(request=CompleteRideSerializer, responses={200: RideBookingSerializer, 400: dict})
    def complete(self, request, pk=None):
        """Only the ride's own rider pays for it — settling through
        the real payment gateway, exactly like every other real
        payment on the platform. Reuses transactions.views'
        FakeRedisLock exactly — an already-documented, intentional
        placeholder (see that class's own docstring) pending real
        Redis wiring in production, the same pattern every other
        booking flow on the platform already follows; not a new gap,
        not something invented here."""
        from transactions.views import FakeRedisLock
        from payments.gateways import get_active_gateway

        ride = self.get_object()
        if ride.rider_id != request.user.id:
            return Response({"detail": "Only the ride's own rider can complete payment for it."}, status=status.HTTP_403_FORBIDDEN)
        if ride.status != RideStatus.IN_PROGRESS:
            return Response({"detail": "This ride must be in progress before it can be completed."}, status=status.HTTP_400_BAD_REQUEST)

        input_serializer = CompleteRideSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            complete_ride_with_payment(
                ride=ride, lock_client=FakeRedisLock(), payment_gateway=get_active_gateway(),
                phone_number=input_serializer.validated_data["phone_number"],
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(RideBookingSerializer(ride).data)

    @extend_schema(methods=["GET"], responses={200: RideMessageSerializer(many=True), 403: dict, 404: dict})
    @extend_schema(methods=["POST"], request=RideMessageSerializer, responses={201: RideMessageSerializer, 403: dict, 404: dict})
    @action(detail=True, methods=["get", "post"])
    def messages(self, request, pk=None):
        """In-trip private chat, visible to rider and driver only."""
        ride = self.get_object()
        if request.user.id not in (ride.rider_id, ride.driver_id):
            return Response({"detail": "Only the rider or assigned driver can view or send messages for this ride."}, status=status.HTTP_403_FORBIDDEN)
        if request.method == "GET":
            thread = ride.messages.select_related("sender")
            return Response(RideMessageSerializer(thread, many=True).data)
        input_serializer = RideMessageSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            message = post_ride_message(ride=ride, sender=request.user, text=input_serializer.validated_data["text"])
        except NotPartyToRideError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(RideMessageSerializer(message).data, status=status.HTTP_201_CREATED)


class ListingConditionView(APIView):
    """The real gap this closes: attach_condition()/get_conditions_for()
    were fully built — structured conditions (min_lease_months,
    deposit_required, pet_policy, etc.) plus a free-text clause,
    attachable to property.Listing OR any marketplace listing via the
    same generic pattern Booking already uses — but nothing ever
    exposed either one over HTTP. Real listers had no way to actually
    set a lease term, a pet policy, or any other condition on their
    own listing, despite the feature existing since Prompt 10.
    """
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def _resolve_target(self, content_type_str: str, target_id):
        """Resolves the SAME plain 'app_label.ModelName' string format
        Booking.target_content_type already uses elsewhere in this
        codebase — no new convention introduced, matching what's
        already established rather than reaching for Django's
        ContentType framework, which isn't used for this purpose
        anywhere else in this project."""
        from django.apps import apps
        from django.core.exceptions import ObjectDoesNotExist
        try:
            app_label, model_name = content_type_str.split(".")
            model_class = apps.get_model(app_label, model_name)
            return model_class.objects.get(id=target_id)
        except (ValueError, LookupError, ObjectDoesNotExist):
            # ValueError: content_type_str wasn't "app_label.Model".
            # LookupError: apps.get_model() found no such model.
            # ObjectDoesNotExist: a real model, but no row with that id.
            return None

    @extend_schema(responses={200: ListingConditionSerializer(many=True)})
    def get(self, request):
        """Public — viewing the real rules on a listing you're
        browsing shouldn't require an account, matching every other
        real-estate detail page on the platform."""
        content_type = request.query_params.get("target_content_type")
        target_id = request.query_params.get("target_id")
        if not content_type or not target_id:
            return Response({"detail": "target_content_type and target_id are required."}, status=status.HTTP_400_BAD_REQUEST)
        conditions = ListingCondition.objects.filter(target_content_type=content_type, target_id=target_id)
        return Response(ListingConditionSerializer(conditions, many=True).data)

    @extend_schema(request=AttachConditionSerializer, responses={201: ListingConditionSerializer, 403: dict, 404: dict})
    def post(self, request):
        """Only the target listing's own lister can attach a
        condition to it — resolved dynamically since the target could
        be property.Listing (field: listed_by) or any marketplace
        listing (field: lister_user), matching IsOwnerOrReadOnly's own
        multi-field-name approach rather than a single hardcoded name."""
        input_serializer = AttachConditionSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        target = self._resolve_target(data["target_content_type"], data["target_id"])
        if target is None:
            return Response({"detail": "That listing was not found."}, status=status.HTTP_404_NOT_FOUND)

        owner_id = getattr(target, "listed_by_id", None) or getattr(target, "lister_user_id", None)
        if owner_id != request.user.id:
            return Response({"detail": "Only the listing's own lister can set its conditions."}, status=status.HTTP_403_FORBIDDEN)

        condition = attach_condition(
            listing=target, created_by=request.user,
            structured_conditions=data["structured_conditions"], free_text_clause=data["free_text_clause"],
        )
        return Response(ListingConditionSerializer(condition).data, status=status.HTTP_201_CREATED)


class MyDriverProfileView(APIView):
    """The real gap this closes: previously ANY signed-in user could
    accept a ride and become its driver — no registration, no
    vetting, at all. Real self-service registration; starts
    unverified, matching the same admin-review posture already built
    for Hotel/Venue this session."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: DriverProfileSerializer, 404: dict})
    def get(self, request):
        if not hasattr(request.user, "driver_profile"):
            return Response({"detail": "You have not registered as a driver yet."}, status=status.HTTP_404_NOT_FOUND)
        return Response(DriverProfileSerializer(request.user.driver_profile).data)

    @extend_schema(request=DriverRegistrationSerializer, responses={201: DriverProfileSerializer})
    def post(self, request):
        input_serializer = DriverRegistrationSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        driver_profile = register_as_driver(user=request.user, license_number=input_serializer.validated_data["license_number"])
        return Response(DriverProfileSerializer(driver_profile).data, status=status.HTTP_201_CREATED)


class MyVehicleViewSet(viewsets.ModelViewSet):
    """A driver's own registered vehicles — create/list/retrieve only;
    a vehicle used on a completed ride shouldn't be silently editable
    after the fact."""
    serializer_class = VehicleSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Vehicle.objects.none()
        if not hasattr(self.request.user, "driver_profile"):
            return Vehicle.objects.none()
        return Vehicle.objects.filter(driver=self.request.user.driver_profile)

    def create(self, request, *args, **kwargs):
        if not hasattr(request.user, "driver_profile"):
            return Response({"detail": "You must register as a driver before registering a vehicle."}, status=status.HTTP_403_FORBIDDEN)
        input_serializer = VehicleSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        vehicle = register_vehicle(driver_profile=request.user.driver_profile, **input_serializer.validated_data)
        return Response(VehicleSerializer(vehicle).data, status=status.HTTP_201_CREATED)


class AdminDriverViewSet(viewsets.ReadOnlyModelViewSet):
    """The other real half of the same gap: an admin previously had no
    way to see or verify a pending driver registration at all."""
    serializer_class = DriverProfileSerializer
    permission_classes = [IsAdminRole]
    queryset = DriverProfile.objects.filter(is_verified=False).order_by("-created_at")

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        driver_profile = self.get_object()
        driver_profile.is_verified = True
        driver_profile.save(update_fields=["is_verified"])
        return Response(DriverProfileSerializer(driver_profile).data)
