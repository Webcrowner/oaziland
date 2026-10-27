"""
hotels.views — search/browse (public) and reservation creation
(reuses create_reservation's real dynamic-pricing + validation), same
pattern as property.views.ListingViewSet from Prompt 16.

HotelViewSet is no longer ReadOnlyModelViewSet — the real gap this
closes: no real hotel owner could ever list their own property before
this. New hotels start unverified (matching the field's own default),
same real moderation posture as a property listing going through
PENDING_REVIEW before it's publicly visible.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import Hotel, RoomType, Reservation
from .serializers import HotelSerializer, HotelCreateSerializer, ReservationSerializer
from .services import create_reservation, get_hotel_financial_dashboard
from oaziland.permissions import IsKycVerified, IsAdminRole


class HotelViewSet(viewsets.ModelViewSet):
    """list is public and verified-only (matching how property listing
    search already works) PLUS the requester's own not-yet-verified
    hotels, PLUS — for an admin — every hotel regardless of verified
    status, so the admin console's own queue can reuse this same
    endpoint rather than needing a separate one. Detail actions
    (photos, verify) use an unscoped queryset with their own explicit
    checks, the same lesson already applied to marketplace/services
    this session — scoping them the same way as list would silently
    turn a deliberate 403 into an uninformative 404."""
    serializer_class = HotelSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Hotel.objects.none()
        if self.action == "list":
            user = self.request.user
            if user.is_authenticated and hasattr(user, "admin_profile"):
                return Hotel.objects.all().select_related("owner__agent_profile").prefetch_related("room_types", "asset_photos").order_by("-created_at")
            from django.db.models import Q
            base = Q(verified=True)
            if user.is_authenticated:
                base |= Q(owner=user)
            return Hotel.objects.filter(base).select_related("owner__agent_profile").prefetch_related("room_types", "asset_photos").order_by("-created_at")
        return Hotel.objects.select_related("owner__agent_profile").prefetch_related("room_types", "asset_photos")

    @extend_schema(request=HotelCreateSerializer, responses={201: HotelSerializer})
    def create(self, request, *args, **kwargs):
        input_serializer = HotelCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        hotel = Hotel.objects.create(
            owner=request.user,
            quarter_id=data["quarter"],
            type="HOTEL",
            name=data.get("name", "").strip(),
            star_rating=data.get("star_rating"),
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
        )
        for room_type_data in data["room_types"]:
            RoomType.objects.create(
                hotel=hotel, category=room_type_data.get("category", "STANDARD"),
                capacity=room_type_data.get("capacity", 2), base_rate_xaf=room_type_data.get("base_rate_xaf", 0),
                amenities=room_type_data.get("amenities", []),
            )
        return Response(HotelSerializer(hotel).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        hotel = self.get_object()
        if hotel.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the hotel's own owner can update it."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        extra = {}
        if "name" in serializer.validated_data:
            extra["name"] = serializer.validated_data["name"].strip()
        serializer.save(**extra)

    @action(detail=True, methods=["post"], url_path="set-name")
    def set_name(self, request, pk=None):
        hotel = self.get_object()
        if hotel.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the hotel's own owner can name it."}, status=status.HTTP_403_FORBIDDEN)
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"detail": "Enter a name for the hotel."}, status=status.HTTP_400_BAD_REQUEST)
        hotel.name = name[:200]
        hotel.save(update_fields=["name"])
        return Response(HotelSerializer(hotel).data)

    @action(detail=True, methods=["post"], url_path="set-location")
    def set_location(self, request, pk=None):
        hotel = self.get_object()
        if hotel.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the hotel's owner can set its location."}, status=status.HTTP_403_FORBIDDEN)
        lat = request.data.get("latitude")
        lng = request.data.get("longitude")
        if lat is None or lng is None:
            return Response({"detail": "latitude and longitude are required."}, status=status.HTTP_400_BAD_REQUEST)
        hotel.latitude = lat
        hotel.longitude = lng
        hotel.save(update_fields=["latitude", "longitude"])
        return Response({"id": str(hotel.id), "latitude": str(hotel.latitude), "longitude": str(hotel.longitude)})

    @action(detail=True, methods=["post"], url_path="add-photo")
    def add_photo(self, request, pk=None):
        from property.models import PropertyAssetPhoto

        hotel = self.get_object()
        if hotel.owner_id != request.user.id:
            return Response({"detail": "Only the hotel's own owner can add photos to it."}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required — upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        is_first = not hotel.asset_photos.exists()
        photo = PropertyAssetPhoto.objects.create(property_asset=hotel, url=url, media_type=media_type, is_primary=is_first)
        return Response({"id": photo.id, "url": photo.url, "media_type": photo.media_type, "is_primary": photo.is_primary}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-photo")
    def remove_photo(self, request, pk=None):
        from property.models import PropertyAssetPhoto

        hotel = self.get_object()
        if hotel.owner_id != request.user.id:
            return Response({"detail": "Only the hotel's own owner can remove its photos."}, status=status.HTTP_403_FORBIDDEN)
        photo_id = request.data.get("photo_id")
        deleted_count, _ = PropertyAssetPhoto.objects.filter(property_asset=hotel, id=photo_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Photo not found on this hotel."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="verify", permission_classes=[IsAdminRole])
    def verify(self, request, pk=None):
        """The real gap this closes: Hotel.verified defaults to False
        on real creation (added this session), and nothing anywhere
        could ever flip it back to True — a real hotel owner's
        listing would have stayed permanently invisible to the public.
        Admin-only, matching the same moderation posture already used
        for approving a property listing."""
        hotel = self.get_object()
        hotel.verified = True
        hotel.save(update_fields=["verified"])
        return Response(HotelSerializer(hotel).data)

    @action(detail=True, methods=["get"], url_path="financial-dashboard")
    def financial_dashboard(self, request, pk=None):
        """A real gap this closes: get_hotel_financial_dashboard()
        already computed real revenue/bookings trends, outstanding
        balances, and escrow status, but nothing ever exposed it."""
        hotel = self.get_object()
        if hotel.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the hotel's own owner can view its financial dashboard."}, status=status.HTTP_403_FORBIDDEN)
        return Response(get_hotel_financial_dashboard(hotel))


class ReservationViewSet(viewsets.ModelViewSet):
    serializer_class = ReservationSerializer

    def get_permissions(self):
        if self.action == "create":
            return [IsKycVerified()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Reservation.objects.none()
        return Reservation.objects.filter(guest=self.request.user).order_by("-created_at")

    def create(self, request, *args, **kwargs):
        try:
            room_type = RoomType.objects.get(id=request.data.get("room_type"))
            reservation = create_reservation(
                hotel=room_type.hotel, guest=request.user, room_type=room_type,
                check_in=request.data.get("check_in"), check_out=request.data.get("check_out"),
                adults=request.data.get("adults", 1), children=request.data.get("children", 0),
                special_requests=request.data.get("special_requests", ""),
            )
        except RoomType.DoesNotExist:
            return Response({"detail": "Unknown room type."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ReservationSerializer(reservation).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        """The real payment step this reservation previously never had:
        pays the full room rate through the shared Booking/PaymentEscrow
        flow, exactly like every other transaction type."""
        from .services import confirm_reservation_payment
        from transactions.locks import get_booking_lock_client
        from payments.gateways import get_active_gateway

        try:
            reservation = Reservation.objects.get(pk=pk, guest=request.user)
        except Reservation.DoesNotExist:
            return Response({"detail": "Reservation not found."}, status=status.HTTP_404_NOT_FOUND)

        phone_number = request.data.get("phone_number")
        if not phone_number:
            return Response({"detail": "phone_number is required."}, status=status.HTTP_400_BAD_REQUEST)

        reservation, _escrow = confirm_reservation_payment(
            reservation=reservation, lock_client=get_booking_lock_client(),
            payment_gateway=get_active_gateway(), phone_number=phone_number,
        )
        return Response(ReservationSerializer(reservation).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, pk=None):
        """Hotel-staff-only — only the hotel's own owner can hand over a
        room key, matching the same ownership check already used for
        add-photo/remove-photo on HotelViewSet."""
        from .services import check_in_guest, NoAvailableRoomError
        from .services import ReservationNotPaidError

        try:
            reservation = Reservation.objects.get(pk=pk)
        except Reservation.DoesNotExist:
            return Response({"detail": "Reservation not found."}, status=status.HTTP_404_NOT_FOUND)
        if reservation.hotel.owner_id != request.user.id:
            return Response({"detail": "Only this hotel's own owner can check in a guest."}, status=status.HTTP_403_FORBIDDEN)

        try:
            check_in_guest(reservation=reservation, assigned_by=request.user)
        except ReservationNotPaidError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except NoAvailableRoomError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(ReservationSerializer(reservation).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def checkout(self, request, pk=None):
        """Hotel-staff-only — settles the stay AND releases the real
        escrow held for it, so the hotel actually gets paid."""
        from .services import checkout_guest

        try:
            reservation = Reservation.objects.get(pk=pk)
        except Reservation.DoesNotExist:
            return Response({"detail": "Reservation not found."}, status=status.HTTP_404_NOT_FOUND)
        if reservation.hotel.owner_id != request.user.id:
            return Response({"detail": "Only this hotel's own owner can check out a guest."}, status=status.HTTP_403_FORBIDDEN)

        balance = checkout_guest(reservation)
        return Response({"detail": "Checked out.", "final_balance_xaf": str(balance)}, status=status.HTTP_200_OK)
