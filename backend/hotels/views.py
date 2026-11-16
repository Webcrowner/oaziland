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
from .room_type_views import MineListMixin, RoomTypeActionsMixin, room_type_error

HOTEL_PREFETCH = ("room_types__photos", "room_types__rooms", "asset_photos")


_room_type_error = room_type_error

class HotelViewSet(MineListMixin, RoomTypeActionsMixin, viewsets.ModelViewSet):
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

    def mine_queryset(self, user):
        return Hotel.objects.filter(owner=user).select_related("owner__agent_profile", "quarter").prefetch_related(*HOTEL_PREFETCH).order_by("-created_at")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Hotel.objects.none()
        if self.wants_mine():
            return super().get_queryset()
        if self.action == "list":
            user = self.request.user
            if user.is_authenticated and hasattr(user, "admin_profile"):
                everything = Hotel.objects.all().select_related("owner__agent_profile").prefetch_related(*HOTEL_PREFETCH).order_by("-created_at")
                # The review queue asks for only the hotels still waiting, so they aren't buried past page 1.
                return everything.filter(verified=False) if self.request.query_params.get("verified") == "false" else everything
            from django.db.models import Q
            base = Q(verified=True, deleted_at__isnull=True)
            if user.is_authenticated:
                base |= Q(owner=user)
            return Hotel.objects.filter(base).select_related("owner__agent_profile").prefetch_related(*HOTEL_PREFETCH).order_by("-created_at")
        from trust_safety.report_targets import visible_places
        return visible_places(Hotel.objects.select_related("owner__agent_profile").prefetch_related(*HOTEL_PREFETCH), self.request.user)

    @extend_schema(request=HotelCreateSerializer, responses={201: HotelSerializer})
    def create(self, request, *args, **kwargs):
        from django.db import transaction
        from .room_types import RoomTypeError, save_room_type

        input_serializer = HotelCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        try:
            with transaction.atomic():
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
                    fields = dict(room_type_data)
                    if not fields.get("name"):
                        fields["name"] = dict(RoomType._meta.get_field("category").choices).get(fields.get("category") or "STANDARD", "Room")
                    save_room_type(hotel, fields)
        except RoomTypeError as exc:
            return _room_type_error(exc)
        return Response(HotelSerializer(hotel, context={"for_owner": True}).data, status=status.HTTP_201_CREATED)

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

    def place_data(self, place):
        hotel = Hotel.objects.prefetch_related(*HOTEL_PREFETCH).get(pk=place.pk)
        return HotelSerializer(hotel, context={"for_owner": True}).data


class ReservationViewSet(viewsets.ModelViewSet):
    serializer_class = ReservationSerializer
    # A reservation's dates and room type are priced when it's made; letting a guest edit or delete it afterwards
    # would bypass that pricing and the availability check, and lose the record behind a payment.
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action == "create":
            return [IsKycVerified()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        """A guest sees their own reservations; `?role=hosting` lists those made at the places the user owns (add
        `&place=hotel` or `&place=guest_house` to narrow it). The owner of a place can also open and act on its
        reservations one by one."""
        if getattr(self, "swagger_fake_view", False):
            return Reservation.objects.none()
        from django.db.models import Q
        user = self.request.user
        base = Reservation.objects.select_related("guest", "hotel", "guest_house", "room_type", "booking")
        if self.action == "list":
            if self.request.query_params.get("role") == "hosting":
                place = self.request.query_params.get("place")
                owned = Q(hotel__owner=user) if place == "hotel" else Q(guest_house__owner=user) if place == "guest_house" else Q(hotel__owner=user) | Q(guest_house__owner=user)
                return base.filter(owned).order_by("check_in", "-created_at")
            return base.filter(guest=user).order_by("-created_at")
        return base.filter(Q(guest=user) | Q(hotel__owner=user) | Q(guest_house__owner=user)).order_by("-created_at")

    def _stay_action(self, request, pk, work):
        """Runs a stay action (cancel, confirm...) on a reservation the user may see, mapping its errors to 400."""
        from .stays import StayError
        try:
            reservation = self.get_queryset().get(pk=pk)
        except (Reservation.DoesNotExist, ValueError):
            return Response({"detail": "Reservation not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            reservation = work(reservation)
        except StayError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        reservation = self.get_queryset().get(pk=reservation.pk)
        return Response(ReservationSerializer(reservation).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """The guest cancels (free until 48 hours before check-in, then the first night is kept) or the owner cancels
        (the guest is refunded in full). The refund goes to the guest's Oaziland wallet."""
        from .stays import cancel_reservation
        return self._stay_action(request, pk, lambda r: cancel_reservation(r, by=request.user))

    @action(detail=True, methods=["post"], url_path="no-show")
    def no_show(self, request, pk=None):
        """The owner records that the guest never arrived: the first night is kept, the rest is refunded."""
        from .stays import mark_no_show
        return self._stay_action(request, pk, lambda r: mark_no_show(r, owner=request.user))

    @action(detail=True, methods=["post"], url_path="confirm-stay")
    def confirm_stay(self, request, pk=None):
        """The guest confirms the stay went well, which pays the owner now rather than after the automatic delay."""
        from .stays import confirm_stay
        return self._stay_action(request, pk, lambda r: confirm_stay(r, guest=request.user))

    @action(detail=True, methods=["post"])
    def dispute(self, request, pk=None):
        """The guest reports a problem with the stay; the held payment is frozen until an admin decides."""
        from .stays import dispute_stay
        return self._stay_action(request, pk, lambda r: dispute_stay(r, guest=request.user, reason=str(request.data.get("reason") or "")))

    def create(self, request, *args, **kwargs):
        """The guest picks a room type and dates; the server checks it's on offer, sleeps the party and has a
        room free on every night, and prices the stay itself — nothing the browser sends sets the price."""
        import uuid as _uuid
        from .room_types import RoomTypeError, ensure_listed, parse_stay

        try:
            room_type = RoomType.objects.select_related("hotel", "guest_house").get(id=_uuid.UUID(str(request.data.get("room_type"))))
        except (RoomType.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Unknown room type."}, status=status.HTTP_404_NOT_FOUND)
        if room_type.place.owner_id == request.user.id:
            return Response({"detail": "You can't book a room in your own property."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            adults = int(request.data.get("adults") or 1)
            children = int(request.data.get("children") or 0)
        except (TypeError, ValueError):
            return Response({"detail": "Enter how many adults and children are staying."}, status=status.HTTP_400_BAD_REQUEST)
        if adults < 1 or children < 0:
            return Response({"detail": "At least one adult must stay in the room."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            check_in, check_out = parse_stay(request.data.get("check_in"), request.data.get("check_out"))
            ensure_listed(room_type, guests=adults + children)
            reservation = create_reservation(
                hotel=room_type.place, guest=request.user, room_type=room_type,
                check_in=check_in, check_out=check_out, adults=adults, children=children,
                special_requests=str(request.data.get("special_requests") or "")[:1000],
            )
        except RoomTypeError as exc:
            return _room_type_error(exc)
        return Response(ReservationSerializer(reservation).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        """Pays the full room rate through the shared Booking/PaymentEscrow flow, like every other transaction type.
        200 when the payment is already confirmed (the sandbox gateway); 202 while the guest approves it on their
        phone: the reservation is confirmed by the provider's webhook, so clients poll GET /api/reservations/<id>/."""
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

        from .room_types import RoomTypeError
        try:
            reservation, escrow = confirm_reservation_payment(
                reservation=reservation, lock_client=get_booking_lock_client(),
                payment_gateway=get_active_gateway(), phone_number=phone_number,
            )
        except RoomTypeError as exc:
            return _room_type_error(exc)
        return Response(ReservationSerializer(reservation).data, status=status.HTTP_200_OK if escrow is not None else status.HTTP_202_ACCEPTED)

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
        if reservation.place.owner_id != request.user.id:
            return Response({"detail": "Only the owner can check in a guest."}, status=status.HTTP_403_FORBIDDEN)

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
        if reservation.place.owner_id != request.user.id:
            return Response({"detail": "Only the owner can check out a guest."}, status=status.HTTP_403_FORBIDDEN)

        from .stays import StayError
        try:
            balance = checkout_guest(reservation)
        except StayError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Checked out.", "final_balance_xaf": str(balance)}, status=status.HTTP_200_OK)
