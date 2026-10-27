"""
events.views — venue search/browse (public) and event booking creation
(reuses create_event_booking's real availability-conflict checking).

VenueViewSet is no longer ReadOnlyModelViewSet — the real gap this
closes: no real venue owner could ever list their own property. New
venues start unverified (matching the field's own default).
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import Venue, VenueSpace, EventBooking
from .serializers import VenueSerializer, VenueCreateSerializer, EventBookingSerializer
from .services import create_event_booking, VenueUnavailableError, get_venue_financial_dashboard
from oaziland.permissions import IsKycVerified, IsAdminRole


class VenueViewSet(viewsets.ModelViewSet):
    """Same real visibility pattern as HotelViewSet: list is public
    and verified-only PLUS the requester's own not-yet-verified
    venues, PLUS — for an admin — every venue regardless of verified
    status. Detail actions (photos, verify) use an unscoped queryset
    with their own explicit checks, the same lesson already applied
    repeatedly this session."""
    serializer_class = VenueSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Venue.objects.none()
        if self.action == "list":
            user = self.request.user
            if user.is_authenticated and hasattr(user, "admin_profile"):
                return Venue.objects.all().select_related("owner__agent_profile").prefetch_related("spaces", "asset_photos").order_by("-created_at")
            from django.db.models import Q
            base = Q(verified=True)
            if user.is_authenticated:
                base |= Q(owner=user)
            return Venue.objects.filter(base).select_related("owner__agent_profile").prefetch_related("spaces", "asset_photos").order_by("-created_at")
        return Venue.objects.select_related("owner__agent_profile").prefetch_related("spaces", "asset_photos")

    @extend_schema(request=VenueCreateSerializer, responses={201: VenueSerializer})
    def create(self, request, *args, **kwargs):
        input_serializer = VenueCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        venue = Venue.objects.create(
            owner=request.user,
            quarter_id=data["quarter"],
            type="EVENT_CENTER",
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
        )
        for space_data in data["spaces"]:
            VenueSpace.objects.create(
                venue=venue, space_name=space_data.get("space_name", "Main Hall"),
                capacity_theatre=space_data.get("capacity_theatre"), capacity_banquet=space_data.get("capacity_banquet"),
                base_price_per_hour_xaf=space_data.get("base_price_per_hour_xaf", 0),
            )
        return Response(VenueSerializer(venue).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="set-location")
    def set_location(self, request, pk=None):
        venue = self.get_object()
        if venue.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the venue owner can set its location."}, status=status.HTTP_403_FORBIDDEN)
        lat = request.data.get("latitude")
        lng = request.data.get("longitude")
        if lat is None or lng is None:
            return Response({"detail": "latitude and longitude are required."}, status=status.HTTP_400_BAD_REQUEST)
        venue.latitude = lat
        venue.longitude = lng
        venue.save(update_fields=["latitude", "longitude"])
        return Response({"id": str(venue.id), "latitude": str(venue.latitude), "longitude": str(venue.longitude)})

    @action(detail=True, methods=["post"], url_path="add-photo")
    def add_photo(self, request, pk=None):
        from property.models import PropertyAssetPhoto

        venue = self.get_object()
        if venue.owner_id != request.user.id:
            return Response({"detail": "Only the venue's own owner can add photos to it."}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required — upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        is_first = not venue.asset_photos.exists()
        photo = PropertyAssetPhoto.objects.create(property_asset=venue, url=url, media_type=media_type, is_primary=is_first)
        return Response({"id": photo.id, "url": photo.url, "media_type": photo.media_type, "is_primary": photo.is_primary}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-photo")
    def remove_photo(self, request, pk=None):
        from property.models import PropertyAssetPhoto

        venue = self.get_object()
        if venue.owner_id != request.user.id:
            return Response({"detail": "Only the venue's own owner can remove its photos."}, status=status.HTTP_403_FORBIDDEN)
        photo_id = request.data.get("photo_id")
        deleted_count, _ = PropertyAssetPhoto.objects.filter(property_asset=venue, id=photo_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Photo not found on this venue."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="verify", permission_classes=[IsAdminRole])
    def verify(self, request, pk=None):
        """The real gap this closes: Venue.verified defaults to False
        on real creation (added this session), and nothing anywhere
        could ever flip it back to True. Admin-only, matching the
        same moderation posture already used for approving a property
        listing."""
        venue = self.get_object()
        venue.verified = True
        venue.save(update_fields=["verified"])
        return Response(VenueSerializer(venue).data)

    @action(detail=True, methods=["get"], url_path="financial-dashboard")
    def financial_dashboard(self, request, pk=None):
        """A real gap this closes: get_venue_financial_dashboard()
        already computed real revenue/bookings trends, outstanding
        balances, and escrow status, but nothing ever exposed it."""
        venue = self.get_object()
        if venue.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the venue's own owner can view its financial dashboard."}, status=status.HTTP_403_FORBIDDEN)
        return Response(get_venue_financial_dashboard(venue))


class EventBookingViewSet(viewsets.ModelViewSet):
    serializer_class = EventBookingSerializer

    def get_permissions(self):
        if self.action == "create":
            return [IsKycVerified()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return EventBooking.objects.none()
        # The venue's own owner can also reach their bookings (needed for
        # the "complete" action below) — not just the organiser who made them.
        from django.db.models import Q
        user = self.request.user
        return EventBooking.objects.filter(
            Q(organiser=user) | Q(venue_space__venue__owner=user)
        ).order_by("-created_at")

    def create(self, request, *args, **kwargs):
        try:
            venue_space = VenueSpace.objects.get(id=request.data.get("venue_space"))
            booking = create_event_booking(
                organiser=request.user, venue_space=venue_space, event_type=request.data.get("event_type"),
                event_date=request.data.get("event_date"), start_time=request.data.get("start_time"),
                end_time=request.data.get("end_time"), guest_count=request.data.get("guest_count"),
            )
        except VenueSpace.DoesNotExist:
            return Response({"detail": "Unknown venue space."}, status=status.HTTP_404_NOT_FOUND)
        except VenueUnavailableError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(EventBookingSerializer(booking).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="pay-deposit")
    def pay_deposit(self, request, pk=None):
        """The real payment step this booking previously never had —
        pays the 30% deposit through the shared Booking/PaymentEscrow flow."""
        from .services import confirm_event_booking_deposit
        from transactions.locks import get_booking_lock_client
        from payments.gateways import get_active_gateway

        event_booking = self.get_object()
        phone_number = request.data.get("phone_number")
        if not phone_number:
            return Response({"detail": "phone_number is required."}, status=status.HTTP_400_BAD_REQUEST)

        event_booking, _escrow = confirm_event_booking_deposit(
            event_booking=event_booking, lock_client=get_booking_lock_client(),
            payment_gateway=get_active_gateway(), phone_number=phone_number,
        )
        return Response(EventBookingSerializer(event_booking).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="pay-balance")
    def pay_balance(self, request, pk=None):
        """Collects the remaining balance — the real gap this closes:
        the balance amount was computed but had no reachable payment step."""
        from .services import confirm_event_booking_balance
        from transactions.locks import get_booking_lock_client
        from payments.gateways import get_active_gateway

        event_booking = self.get_object()
        phone_number = request.data.get("phone_number")
        if not phone_number:
            return Response({"detail": "phone_number is required."}, status=status.HTTP_400_BAD_REQUEST)

        event_booking, _escrow = confirm_event_booking_balance(
            event_booking=event_booking, lock_client=get_booking_lock_client(),
            payment_gateway=get_active_gateway(), phone_number=phone_number,
        )
        return Response(EventBookingSerializer(event_booking).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Venue-owner-only — settles the event AND releases both real
        escrows so the venue actually gets paid."""
        from .services import complete_event_booking, EventNotFullyPaidError

        event_booking = self.get_object()
        if event_booking.venue_space.venue.owner_id != request.user.id:
            return Response({"detail": "Only this venue's own owner can mark an event complete."}, status=status.HTTP_403_FORBIDDEN)

        try:
            event_booking, _escrows = complete_event_booking(event_booking=event_booking)
        except EventNotFullyPaidError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(EventBookingSerializer(event_booking).data, status=status.HTTP_200_OK)
