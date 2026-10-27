"""
marketplace.views — the real gap this closes: four real listing
categories (warehouses, stores, businesses, cars) and a full ride-
hailing lifecycle all had real, working service functions and models,
but nothing ever exposed any of it. search_marketplace_listings()
already existed and is reused here exactly as written, not
reimplemented at the API layer.
"""
from rest_framework import viewsets, permissions, status
from django.db import transaction as db_transaction
from django.http import Http404
from rest_framework.exceptions import ValidationError
from decimal import Decimal, InvalidOperation
import logging
import uuid
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import WarehouseListing, StoreListing, BusinessListing, CarListing, GoodsListing, GoodsCategory, GoodsCondition, RideBooking, RideStatus, ListingCondition, Vehicle, DriverProfile, MarketplaceMedia, MarketplaceOrder, MarketplaceOrderStatus, PriceBasis, RideEmergencyContact
from .serializers import (
    PlaceOrderSerializer, OrderDisputeSerializer, MarketplaceOrderSerializer, EmergencyContactSerializer, EmergencyContactStatusSerializer, AdminSosRideSerializer,
    AddMediaSerializer, SetAvailabilitySerializer,
    WarehouseListingSerializer, StoreListingSerializer, BusinessListingSerializer, CarListingSerializer, GoodsListingSerializer,
    RideBookingSerializer, RideRequestSerializer, CompleteRideSerializer, RideMessageSerializer, RideSosSerializer,
    ListingConditionSerializer, AttachConditionSerializer,
    DriverProfileSerializer, DriverRegistrationSerializer, DriverLocationSerializer, VehicleSerializer,
)
from .services import (
    search_marketplace_listings, LISTING_ORDERINGS, estimate_ride_fare, request_ride, accept_ride, start_ride, complete_ride_with_payment, attach_condition,
    trusted_ride_distance_km, cancel_ride, release_ride, raise_sos, RideStateError,
    moderate_listing_text, moderate_listing_photo,
    category_models, place_order, mark_handed_over, confirm_receipt, cancel_order, decline_order, dispute_order, return_deposit, claim_deposit,
    OrderError, ListingNotAvailableError, NotPartyToOrderError,
    register_as_driver, register_vehicle, NotARegisteredDriverError, DriverNotVerifiedError, VehicleCategoryMismatchError,
    post_ride_message, NotPartyToRideError,
    update_driver_location, open_rides_for_driver, ride_driver_tracking, DEFAULT_NEARBY_RADIUS_KM,
)
from oaziland.permissions import IsAdminRole, IsKycVerified
import notifications.services as notification_services
from trust_safety.services import ContentBlockedError

MAX_MEDIA_PER_LISTING = 20
logger = logging.getLogger(__name__)
LIVE_ORDER_STATUSES = (
    MarketplaceOrderStatus.PAYMENT_PENDING,
    MarketplaceOrderStatus.PAID,
    MarketplaceOrderStatus.HANDED_OVER,
    MarketplaceOrderStatus.DISPUTED,
)


def _moderate_text(listing_id, title, description):
    try:
        moderate_listing_text(listing_id=listing_id, title=title, description=description)
    except ContentBlockedError as e:
        raise ValidationError({"detail": str(e)})


def _moderate_photo(listing_id, url):
    try:
        moderate_listing_photo(listing_id=listing_id, url=url)
    except ContentBlockedError as e:
        raise ValidationError({"detail": str(e)})


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


class IsListerOrAdmin(permissions.BasePermission):
    """Edit, delete and status changes belong to the user who posted the listing (or an admin moderating it)."""
    def has_object_permission(self, request, view, obj):
        user = request.user
        return bool(user and user.is_authenticated and (obj.lister_user_id == user.id or hasattr(user, "admin_profile")))


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
        if self.action in ("update", "partial_update", "destroy", "set_status"):
            return [permissions.IsAuthenticated(), IsListerOrAdmin()]
        if self.action == "mine":
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.model_class.objects.none()
        if self.action == "list":
            filters = {}
            for key in ("min_price", "max_price", "min_size_sqm"):
                if key in self.request.query_params:
                    try:
                        filters[key] = Decimal(self.request.query_params[key])
                    except InvalidOperation:
                        raise ValidationError({key: "Enter a number."})
            if "quarter_id" in self.request.query_params:
                try:
                    filters["quarter_id"] = uuid.UUID(self.request.query_params["quarter_id"])
                except ValueError:
                    raise ValidationError({"quarter_id": "Enter a valid id."})
            params = self.request.query_params
            ordering = params.get("ordering", "newest")
            if ordering not in LISTING_ORDERINGS:
                raise ValidationError({"ordering": f"Choose one of: {', '.join(LISTING_ORDERINGS)}."})
            filters["ordering"] = ordering
            if params.get("price_basis"):
                if params["price_basis"] not in PriceBasis.values:
                    raise ValidationError({"price_basis": "Enter a valid price basis."})
                filters["price_basis"] = params["price_basis"]
            if params.get("item_category"):
                if params["item_category"] not in GoodsCategory.values:
                    raise ValidationError({"item_category": "Enter a valid item category."})
                filters["item_category"] = params["item_category"]
            if params.get("condition"):
                if params["condition"] not in GoodsCondition.values:
                    raise ValidationError({"condition": "Enter a valid condition."})
                filters["condition"] = params["condition"]
            if params.get("q", "").strip():
                filters["q"] = params["q"].strip()
            return search_marketplace_listings(listing_class=self.model_class, filters=filters)
        return self.model_class.objects.all()

    def retrieve(self, request, *args, **kwargs):
        listing = self.get_object()
        user = request.user
        if listing.removed_by_moderation and not (user.is_authenticated and (listing.lister_user_id == user.id or hasattr(user, "admin_profile"))):
            raise Http404
        return Response(self.get_serializer(listing).data)

    def perform_create(self, serializer):
        owner_profile = _get_or_create_owner_profile(self.request.user)
        agent_profile = getattr(self.request.user, "agent_profile", None)
        if agent_profile is None:
            lister_role = "OWNER"
        else:
            lister_role = "AGENCY" if agent_profile.agency_id else "AGENT"
        listing_id = uuid.uuid4()
        data = serializer.validated_data
        _moderate_text(listing_id, data.get("title", ""), data.get("description", ""))
        serializer.save(id=listing_id, owner=owner_profile, lister_user=self.request.user, lister_role=lister_role)

    def perform_update(self, serializer):
        data = serializer.validated_data
        instance = serializer.instance
        has_live_order = MarketplaceOrder.objects.filter(listing_id=instance.id, status__in=LIVE_ORDER_STATUSES).exists()
        if has_live_order:
            for field in ("price_xaf", "price_basis", "security_deposit_xaf"):
                if field in data and data[field] != getattr(instance, field):
                    raise ValidationError({field: "The price and deposit cannot be changed while an order is active."})
        _moderate_text(instance.id, data.get("title", instance.title), data.get("description", instance.description))
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        listing = self.get_object()
        if MarketplaceOrder.objects.filter(listing_id=listing.id).exists():
            return Response(
                {"detail": "A listing with order history cannot be deleted. Mark it unavailable instead."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """Everything the caller has posted, including sold, paused and unavailable listings the public list hides."""
        queryset = self.model_class.objects.filter(lister_user=request.user).order_by("-created_at")
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["post"], url_path="set-status")
    @extend_schema(request=SetAvailabilitySerializer, responses={200: dict})
    def set_status(self, request, pk=None):
        """Mark a listing available, under offer or unavailable (sold, rented, paused)."""
        listing = self.get_object()
        input_serializer = SetAvailabilitySerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        is_admin = hasattr(request.user, "admin_profile")
        if listing.removed_by_moderation and not is_admin:
            return Response({"detail": "This listing was removed by moderation. Contact support to appeal."}, status=status.HTTP_403_FORBIDDEN)
        requested_status = input_serializer.validated_data["status"]
        if (
            requested_status != listing.availability_status
            and MarketplaceOrder.objects.filter(listing_id=listing.id, status__in=LIVE_ORDER_STATUSES).exists()
        ):
            return Response(
                {"detail": "The listing status is managed by its active order."},
                status=status.HTTP_409_CONFLICT,
            )
        listing.availability_status = requested_status
        if is_admin and listing.removed_by_moderation and listing.availability_status == "AVAILABLE":
            listing.removed_by_moderation = False
        listing.save(update_fields=["availability_status", "removed_by_moderation"])
        return Response({"id": str(listing.id), "availability_status": listing.availability_status})

    @action(detail=True, methods=["post"], url_path="add-media")
    @extend_schema(request=AddMediaSerializer, responses={201: dict, 400: dict, 403: dict})
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
        input_serializer = AddMediaSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        if listing.media.count() >= MAX_MEDIA_PER_LISTING:
            return Response({"detail": f"A listing can have at most {MAX_MEDIA_PER_LISTING} photos and videos."}, status=status.HTTP_400_BAD_REQUEST)
        if input_serializer.validated_data["media_type"] == MarketplaceMedia.MediaType.PHOTO:
            _moderate_photo(listing.id, input_serializer.validated_data["url"])
        media = MarketplaceMedia.objects.create(
            listing=listing, media_type=input_serializer.validated_data["media_type"],
            file_url=input_serializer.validated_data["url"], order=listing.media.count(),
        )
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


class GoodsListingViewSet(BaseMarketplaceViewSet):
    serializer_class = GoodsListingSerializer
    model_class = GoodsListing


def _is_verified_driver(user) -> bool:
    profile = getattr(user, "driver_profile", None)
    return profile is not None and profile.is_verified


def _mask_open_ride(data: dict) -> dict:
    """What a driver browsing open requests sees: the route in words and map points rounded to about 1 km,
    but not the rider's identity. Exact details are shared once the driver accepts."""
    masked = dict(data)
    masked["rider"] = None
    masked["rider_name"] = (masked.get("rider_name") or "").split(" ")[0]
    for key in ("pickup_latitude", "pickup_longitude", "dropoff_latitude", "dropoff_longitude"):
        if masked.get(key) is not None:
            masked[key] = str(round(float(masked[key]), 2))
    return masked


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
            # Open requests are only shown to verified drivers, who are the only people who can take them.
            visible = Q(rider=user) | Q(driver=user)
            if _is_verified_driver(user):
                visible |= Q(status=RideStatus.REQUESTED)
            return RideBooking.objects.filter(visible).distinct().order_by("-requested_at")
        # WHY detail actions (retrieve/accept/start/complete) are NOT
        # scoped the same way: each action below already has its own
        # explicit real permission check (e.g. "only the ride's own
        # driver can start it") that returns a clear, specific 403 —
        # scoping the queryset here too would filter the object out
        # BEFORE that check ever runs, silently turning every
        # deliberate 403 into an uninformative 404 instead. Found by
        # the tests themselves failing with the wrong status code.
        return RideBooking.objects.all()

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        for index, row in enumerate(rows):
            if request.user.id not in (row["rider"], row["driver"]):
                rows[index] = _mask_open_ride(row)
        return response

    def retrieve(self, request, *args, **kwargs):
        # Detail GET stays hidden from outsiders (404), except open requests a verified driver may take.
        ride = self.get_object()
        data = self.get_serializer(ride).data
        if request.user.id in (ride.rider_id, ride.driver_id):
            return Response(data)
        if ride.status == RideStatus.REQUESTED and _is_verified_driver(request.user):
            return Response(_mask_open_ride(data))
        raise Http404

    @extend_schema(responses={200: dict, 403: dict})
    @action(detail=False, methods=["get"], url_path="open")
    def open_requests(self, request):
        """Open requests a verified driver can take, nearest pickup first, limited to their vehicle types
        and, when they have shared a recent position, to ?radius_km (default 10) around it."""
        if not _is_verified_driver(request.user):
            return Response({"detail": "Only verified drivers can browse open requests."}, status=status.HTTP_403_FORBIDDEN)
        try:
            radius_km = min(max(float(request.query_params.get("radius_km", DEFAULT_NEARBY_RADIUS_KM)), 1), 100)
        except ValueError:
            radius_km = DEFAULT_NEARBY_RADIUS_KM
        pairs, located = open_rides_for_driver(driver_profile=request.user.driver_profile, radius_km=radius_km)
        results = []
        for ride, distance in pairs:
            row = _mask_open_ride(RideBookingSerializer(ride).data)
            row["pickup_distance_km"] = str(distance) if distance is not None else None
            results.append(row)
        return Response({"count": len(results), "driver_located": located, "radius_km": radius_km, "results": results})

    @extend_schema(responses={200: dict, 400: dict, 403: dict})
    @action(detail=True, methods=["get"], url_path="driver-location")
    def driver_location(self, request, pk=None):
        """The rider follows their driver: last known position, distance and arrival estimate."""
        ride = self.get_object()
        try:
            return Response(ride_driver_tracking(ride=ride, user=request.user))
        except NotPartyToRideError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except RideStateError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

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

        pickup_coords = None
        if data.get("pickup_latitude") is not None and data.get("pickup_longitude") is not None:
            pickup_coords = (data["pickup_latitude"], data["pickup_longitude"])
        dropoff_coords = None
        if data.get("dropoff_latitude") is not None and data.get("dropoff_longitude") is not None:
            dropoff_coords = (data["dropoff_latitude"], data["dropoff_longitude"])
        distance_km = trusted_ride_distance_km(client_distance_km=data["distance_km"], pickup_coords=pickup_coords, dropoff_coords=dropoff_coords)
        fare = estimate_ride_fare(distance_km=distance_km, ride_category=data["ride_category"])

        ride = request_ride(
            rider=request.user, pickup_description=data["pickup_description"], dropoff_description=data["dropoff_description"],
            fare_estimate_xaf=fare, distance_km=round(Decimal(distance_km), 2), pickup_coords=pickup_coords, dropoff_coords=dropoff_coords,
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
    @extend_schema(request=None, responses={200: RideBookingSerializer, 400: dict, 403: dict})
    def cancel(self, request, pk=None):
        """The rider cancels before the trip starts."""
        ride = self.get_object()
        try:
            cancel_ride(ride=ride, rider=request.user)
        except NotPartyToRideError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except RideStateError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(RideBookingSerializer(ride).data)

    @action(detail=True, methods=["post"])
    @extend_schema(request=None, responses={200: RideBookingSerializer, 400: dict, 403: dict})
    def release(self, request, pk=None):
        """The assigned driver pulls out before the trip starts; the request reopens."""
        ride = self.get_object()
        try:
            release_ride(ride=ride, driver=request.user)
        except NotPartyToRideError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except RideStateError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(RideBookingSerializer(ride).data)

    @action(detail=True, methods=["post"])
    @extend_schema(request=RideSosSerializer, responses={200: dict, 400: dict, 403: dict})
    def sos(self, request, pk=None):
        """The rider or the driver asks for help during a trip. Admins are alerted with the route, the people and
        the vehicle involved, and the sender's location when the app can share it."""
        ride = self.get_object()
        input_serializer = RideSosSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        try:
            admins_alerted, contact_result = raise_sos(ride=ride, user=request.user, latitude=data.get("latitude"), longitude=data.get("longitude"), note=data.get("note", ""))
        except NotPartyToRideError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except RideStateError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        ride.refresh_from_db()
        return Response({
            "sos_raised_at": ride.sos_raised_at,
            "admins_alerted": admins_alerted,
            # None, or {name, phone, status}; status is "sent", "not_delivered" (no SMS provider connected) or "failed".
            "emergency_contact": contact_result,
        })

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
        payment on the platform, using the shared production lock."""
        from transactions.locks import get_booking_lock_client
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
                ride=ride, lock_client=get_booking_lock_client(), payment_gateway=get_active_gateway(),
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

    @extend_schema(request=AttachConditionSerializer, responses={201: ListingConditionSerializer, 204: None, 403: dict, 404: dict, 409: dict})
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

        # A buyer who has paid agreed to the terms as they were; they cannot change underneath an active order.
        if (
            data["target_content_type"].startswith("marketplace.")
            and MarketplaceOrder.objects.filter(listing_id=target.id, status__in=LIVE_ORDER_STATUSES).exists()
        ):
            return Response({"detail": "Conditions cannot be changed while an order is active."}, status=status.HTTP_409_CONFLICT)

        clause = data["free_text_clause"].strip()
        _moderate_text(target.id, "", clause)

        # Posting again replaces the lister's earlier conditions instead of stacking duplicates; empty input clears them.
        with db_transaction.atomic():
            ListingCondition.objects.filter(target_content_type=data["target_content_type"], target_id=target.id).delete()
            if not data["structured_conditions"] and not clause:
                return Response(status=status.HTTP_204_NO_CONTENT)
            condition = attach_condition(
                listing=target, created_by=request.user,
                structured_conditions=data["structured_conditions"], free_text_clause=clause,
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


class MyDriverLocationView(APIView):
    """A verified driver reports their position and/or goes online or offline."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=DriverLocationSerializer, responses={200: DriverProfileSerializer, 403: dict})
    def post(self, request):
        if not _is_verified_driver(request.user):
            return Response({"detail": "Only verified drivers can share their location."}, status=status.HTTP_403_FORBIDDEN)
        serializer = DriverLocationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        profile = update_driver_location(
            driver_profile=request.user.driver_profile,
            latitude=data.get("latitude"), longitude=data.get("longitude"), is_online=data.get("is_online"),
        )
        return Response(DriverProfileSerializer(profile).data)


class MyEmergencyContactView(APIView):
    """The person a user wants told when they press SOS on a ride. One per user; they set, change and remove it."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: EmergencyContactStatusSerializer, 404: dict})
    def get(self, request):
        contact = getattr(request.user, "ride_emergency_contact", None)
        sms_live = notification_services.is_delivery_live("SMS")
        if contact is None:
            return Response({"detail": "You have not set an emergency contact.", "sms_delivery_live": sms_live}, status=status.HTTP_404_NOT_FOUND)
        return Response({**EmergencyContactSerializer(contact).data, "sms_delivery_live": sms_live})

    @extend_schema(request=EmergencyContactSerializer, responses={200: EmergencyContactStatusSerializer})
    def put(self, request):
        serializer = EmergencyContactSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        contact, _ = RideEmergencyContact.objects.update_or_create(user=request.user, defaults=serializer.validated_data)
        return Response({**EmergencyContactSerializer(contact).data, "sms_delivery_live": notification_services.is_delivery_live("SMS")})

    @extend_schema(responses={204: None})
    def delete(self, request):
        RideEmergencyContact.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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


class AdminSosRideViewSet(viewsets.ReadOnlyModelViewSet):
    """Rides where someone pressed SOS, newest first. Open ones by default; ?status=resolved or ?status=all for the rest."""
    serializer_class = AdminSosRideSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return RideBooking.objects.none()
        queryset = (
            RideBooking.objects.filter(sos_raised_at__isnull=False)
            .select_related("rider", "driver", "vehicle", "sos_raised_by", "sos_raised_by__ride_emergency_contact")
            .order_by("-sos_raised_at")
        )
        wanted = self.request.query_params.get("status", "open")
        if wanted == "open":
            return queryset.filter(sos_resolved_at__isnull=True)
        if wanted == "resolved":
            return queryset.filter(sos_resolved_at__isnull=False)
        return queryset

    @action(detail=True, methods=["post"])
    @extend_schema(request=None, responses={200: AdminSosRideSerializer})
    def resolve(self, request, pk=None):
        from django.utils import timezone
        ride = self.get_object()
        if ride.sos_resolved_at is None:
            RideBooking.objects.filter(pk=ride.pk).update(sos_resolved_at=timezone.now(), sos_resolved_by=request.user)
            ride.refresh_from_db()
        return Response(AdminSosRideSerializer(ride).data)


class MarketplaceOrderViewSet(viewsets.ReadOnlyModelViewSet):
    """Buying or renting a marketplace listing through escrow: pay, seller hands over, buyer confirms.
    Only list is scoped to the caller; detail actions use an unscoped queryset with explicit checks so a
    deliberate 403 is not turned into a 404 (retrieve is overridden to still hide orders from outsiders)."""
    serializer_class = MarketplaceOrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = MarketplaceOrder.objects.select_related(
        "listing__lister_user",
        "listing__warehouselisting",
        "listing__storelisting",
        "listing__businesslisting",
        "listing__carlisting",
        "listing__goodslisting",
        "buyer",
        "booking",
    )

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self, "swagger_fake_view", False):
            return queryset.none()
        if self.action != "list":
            return queryset
        from django.db.models import Q
        role = self.request.query_params.get("role")
        user = self.request.user
        if role == "buying":
            return queryset.filter(buyer=user)
        if role == "selling":
            return queryset.filter(listing__lister_user=user)
        return queryset.filter(Q(buyer=user) | Q(listing__lister_user=user))

    def retrieve(self, request, *args, **kwargs):
        order = self.get_object()
        if request.user.id not in (order.buyer_id, order.listing.lister_user_id):
            raise Http404
        return Response(self.get_serializer(order).data)

    @extend_schema(request=PlaceOrderSerializer, responses={202: MarketplaceOrderSerializer, 400: dict, 404: dict, 409: dict, 503: dict})
    def create(self, request, *args, **kwargs):
        from transactions.locks import get_booking_lock_client
        from payments.gateways import get_active_gateway
        input_serializer = PlaceOrderSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        listing = category_models()[data["category"]].objects.filter(pk=data["listing_id"]).first()
        if listing is None:
            return Response({"detail": "That listing was not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            order = place_order(
                listing=listing, buyer=request.user, lock_client=get_booking_lock_client(),
                payment_gateway=get_active_gateway(), phone_number=data["phone_number"],
            )
        except ListingNotAvailableError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        except OrderError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except (RuntimeError, NotImplementedError, ValueError):
            logger.exception("Marketplace payment infrastructure is unavailable.")
            return Response(
                {"detail": "Payments are temporarily unavailable. Please try again later."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(self.get_serializer(order).data, status=status.HTTP_202_ACCEPTED)

    def get_permissions(self):
        if self.action == "create":
            return [IsKycVerified()]
        return super().get_permissions()

    def _run(self, request, func, **kwargs):
        order = self.get_object()
        try:
            func(order=order, **kwargs)
        except NotPartyToOrderError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except OrderError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"], url_path="hand-over")
    @extend_schema(request=None, responses={200: MarketplaceOrderSerializer, 400: dict, 403: dict})
    def hand_over(self, request, pk=None):
        return self._run(request, mark_handed_over, seller=request.user)

    @action(detail=True, methods=["post"])
    @extend_schema(request=None, responses={200: MarketplaceOrderSerializer, 400: dict, 403: dict})
    def confirm(self, request, pk=None):
        return self._run(request, confirm_receipt, buyer=request.user)

    @action(detail=True, methods=["post"])
    @extend_schema(request=None, responses={200: MarketplaceOrderSerializer, 400: dict, 403: dict})
    def cancel(self, request, pk=None):
        return self._run(request, cancel_order, buyer=request.user)

    @action(detail=True, methods=["post"])
    @extend_schema(request=None, responses={200: MarketplaceOrderSerializer, 400: dict, 403: dict})
    def decline(self, request, pk=None):
        return self._run(request, decline_order, seller=request.user)

    @action(detail=True, methods=["post"])
    @extend_schema(request=OrderDisputeSerializer, responses={200: MarketplaceOrderSerializer, 400: dict, 403: dict})
    def dispute(self, request, pk=None):
        input_serializer = OrderDisputeSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        return self._run(request, dispute_order, user=request.user, reason=input_serializer.validated_data["reason"])

    @action(detail=True, methods=["post"], url_path="return-deposit")
    @extend_schema(request=None, responses={200: MarketplaceOrderSerializer, 400: dict, 403: dict})
    def return_deposit(self, request, pk=None):
        """The seller confirms the rental came back in good order, so the deposit goes back to the renter."""
        return self._run(request, return_deposit, seller=request.user)

    @action(detail=True, methods=["post"], url_path="claim-deposit")
    @extend_schema(request=OrderDisputeSerializer, responses={200: MarketplaceOrderSerializer, 400: dict, 403: dict})
    def claim_deposit(self, request, pk=None):
        """The seller reports a problem with the returned item; an admin then decides who gets the deposit."""
        input_serializer = OrderDisputeSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        return self._run(request, claim_deposit, seller=request.user, reason=input_serializer.validated_data["reason"])
