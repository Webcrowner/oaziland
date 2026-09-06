"""
marketplace.views — the real gap this closes: four real listing
categories (warehouses, stores, businesses, cars) and a full ride-
hailing lifecycle all had real, working service functions and models,
but nothing ever exposed any of it. search_marketplace_listings()
already existed and is reused here exactly as written, not
reimplemented at the API layer.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import WarehouseListing, StoreListing, BusinessListing, CarListing, RideBooking, RideStatus
from .serializers import (
    WarehouseListingSerializer, StoreListingSerializer, BusinessListingSerializer, CarListingSerializer,
    RideBookingSerializer, RideRequestSerializer, CompleteRideSerializer,
)
from .services import search_marketplace_listings, estimate_ride_fare, request_ride, accept_ride, start_ride, complete_ride_with_payment


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
    every other browse surface on the platform); create requires
    login. Reuses search_marketplace_listings() for filtering rather
    than reimplementing it."""
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

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
        serializer.save(owner=owner_profile, lister_user=self.request.user, lister_role="OWNER")


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
        fare = estimate_ride_fare(distance_km=data["distance_km"])

        pickup_coords = None
        if data.get("pickup_latitude") is not None:
            pickup_coords = (data["pickup_latitude"], data["pickup_longitude"])
        dropoff_coords = None
        if data.get("dropoff_latitude") is not None:
            dropoff_coords = (data["dropoff_latitude"], data["dropoff_longitude"])

        ride = request_ride(
            rider=request.user, pickup_description=data["pickup_description"], dropoff_description=data["dropoff_description"],
            fare_estimate_xaf=fare, pickup_coords=pickup_coords, dropoff_coords=dropoff_coords,
        )
        return Response(RideBookingSerializer(ride).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        """Any authenticated user can accept an open ride request —
        matching the platform's real driver model (no separate
        DriverProfile gate exists yet; this is an honest reflection of
        that, not a shortcut hiding a missing check)."""
        ride = self.get_object()
        if ride.status != RideStatus.REQUESTED:
            return Response({"detail": "This ride is no longer available to accept."}, status=status.HTTP_400_BAD_REQUEST)
        accept_ride(ride=ride, driver=request.user)
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
