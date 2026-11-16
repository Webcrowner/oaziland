"""
guest_houses.views â€” browse AND real creation. Booking a guest house
goes through the EXISTING generic /api/bookings/ endpoint
(transactions.BookingViewSet, Prompt 16) â€” guest houses don't need a
second booking endpoint, since they settle through the same Booking/
PaymentEscrow flow as everything else, with the guest_houses app only
adding the operational layer (channel sync, verification, splits) on
top.

GuestHouseLodgeViewSet is no longer ReadOnlyModelViewSet â€” the real
gap this closes: no real owner could ever list their own property.
No verification gate (unlike Hotel/Venue) â€” matches the model's own
real fields.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from oaziland.permissions import IsKycVerified
from property.models import GuestHouseLodge, PropertyAssetPhoto
from .serializers import GuestHouseLodgeSerializer, GuestHouseLodgeCreateSerializer
from .services import get_host_dashboard_summary
from hotels.room_type_views import MineListMixin, RoomTypeActionsMixin, room_type_error

GUEST_HOUSE_PREFETCH = ("asset_photos", "room_types__photos", "room_types__rooms", "rooms")


class GuestHouseLodgeViewSet(MineListMixin, RoomTypeActionsMixin, viewsets.ModelViewSet):
    """Rooms are booked through the hotel room-type engine (see hotels.room_type_views): the owner sets up room
    types here, guests check availability here and reserve through /api/reservations/."""
    serializer_class = GuestHouseLodgeSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    # No edit/delete through the generic endpoints: they had no owner check, so anyone signed in could change or
    # delete someone else's guest house. Owners change things through the actions below.
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        # Listing a property (a real financial/legal commitment) needs
        # real identity verification, same as property/hotel/venue
        # listings â€” browsing stays completely open to anyone.
        if self.action == "create":
            return [IsKycVerified()]
        if self.action == "my_dashboard":
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def mine_queryset(self, user):
        return GuestHouseLodge.objects.filter(owner=user).select_related("owner__agent_profile", "quarter").prefetch_related(*GUEST_HOUSE_PREFETCH).order_by("-created_at")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return GuestHouseLodge.objects.none()
        if self.wants_mine():
            return super().get_queryset()
        from trust_safety.report_targets import visible_places
        return visible_places(
            GuestHouseLodge.objects.select_related("owner__agent_profile", "quarter").prefetch_related(*GUEST_HOUSE_PREFETCH).order_by("-created_at"),
            self.request.user,
        )

    @extend_schema(request=GuestHouseLodgeCreateSerializer, responses={201: GuestHouseLodgeSerializer})
    def create(self, request, *args, **kwargs):
        input_serializer = GuestHouseLodgeCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        from django.db import transaction
        from hotels.room_types import RoomTypeError, save_room_type

        try:
            with transaction.atomic():
                guest_house = GuestHouseLodge.objects.create(
                    owner=request.user,
                    quarter_id=data["quarter"],
                    type="HOUSE",
                    name=" ".join(data.get("name", "").split()),
                    is_coastal_leisure=data["is_coastal_leisure"],
                    finish_level=data["finish_level"],
                    latitude=data.get("latitude"),
                    longitude=data.get("longitude"),
                )
                for room_type_data in data["room_types"]:
                    save_room_type(guest_house, room_type_data)
        except RoomTypeError as exc:
            return room_type_error(exc)
        return Response(self.place_data(guest_house), status=status.HTTP_201_CREATED)

    def place_data(self, place):
        guest_house = GuestHouseLodge.objects.prefetch_related(*GUEST_HOUSE_PREFETCH).get(pk=place.pk)
        return GuestHouseLodgeSerializer(guest_house, context={"for_owner": True}).data

    @action(detail=True, methods=["post"], url_path="set-name")
    def set_name(self, request, pk=None):
        guest_house = self.get_object()
        if guest_house.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the guest house owner can name it."}, status=status.HTTP_403_FORBIDDEN)
        name = " ".join(str(request.data.get("name") or "").split())
        if not name or len(name) > 200:
            return Response({"detail": "Enter a name of up to 200 characters."}, status=status.HTTP_400_BAD_REQUEST)
        guest_house.name = name
        guest_house.save(update_fields=["name"])
        return Response(self.place_data(guest_house))

    @action(detail=True, methods=["post"], url_path="set-location")
    def set_location(self, request, pk=None):
        guest_house = self.get_object()
        if guest_house.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the guest house owner can set its location."}, status=status.HTTP_403_FORBIDDEN)
        lat = request.data.get("latitude")
        lng = request.data.get("longitude")
        if lat is None or lng is None:
            return Response({"detail": "latitude and longitude are required."}, status=status.HTTP_400_BAD_REQUEST)
        guest_house.latitude = lat
        guest_house.longitude = lng
        guest_house.save(update_fields=["latitude", "longitude"])
        return Response({"id": str(guest_house.id), "latitude": str(guest_house.latitude), "longitude": str(guest_house.longitude)})

    # ------------------------------------------------------------ booking-site calendars (iCal)

    def _own_house(self, request):
        guest_house = self.get_object()
        if guest_house.owner_id != request.user.id:
            return guest_house, Response({"detail": "Only the guest house owner can manage its booking sites."}, status=status.HTTP_403_FORBIDDEN)
        return guest_house, None

    @staticmethod
    def _channel_row(request, listing):
        feed = request.build_absolute_uri(f"/api/calendar/guest-houses/{listing.id}/{listing.export_token}.ics")
        return {
            "channel": listing.channel, "channel_name": listing.get_channel_display(), "calendar_url": listing.calendar_url,
            "feed_url": feed, "last_synced_at": listing.last_synced_at, "last_error": listing.last_error,
            "conflict_nights": [d for d in listing.conflict_nights.split(",") if d],
        }

    @action(detail=True, methods=["get"], url_path="channels")
    def channels(self, request, pk=None):
        """The booking sites this guest house is connected to, with the private Oaziland calendar link each one
        should subscribe to."""
        guest_house, denied = self._own_house(request)
        if denied:
            return denied
        listings = guest_house.channel_listings.filter(is_active=True).exclude(calendar_url="")
        return Response([self._channel_row(request, listing) for listing in listings])

    @action(detail=True, methods=["post"], url_path="connect-channel")
    def connect_channel(self, request, pk=None):
        """{channel, calendar_url}: connects (or re-connects) a booking site by its calendar link and reads it now."""
        from .calendar_sync import sync_channel_calendar
        from .ical import CalendarFetchError, validate_calendar_url
        from .models import ChannelListing

        guest_house, denied = self._own_house(request)
        if denied:
            return denied
        channel = str(request.data.get("channel") or "")
        try:
            url = validate_calendar_url(channel, str(request.data.get("calendar_url") or ""))
        except CalendarFetchError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        listing, _ = ChannelListing.objects.get_or_create(guest_house=guest_house, channel=channel)
        listing.calendar_url, listing.is_active = url, True
        listing.save(update_fields=["calendar_url", "is_active"])
        result = sync_channel_calendar(listing)
        if not result["ok"]:
            # Keep the connection so the owner can retry, but make clear nothing was imported yet.
            return Response({"detail": result["error"], "channel": self._channel_row(request, listing)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"result": result, "channel": self._channel_row(request, listing)}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="sync-channel")
    def sync_channel(self, request, pk=None):
        from .calendar_sync import sync_channel_calendar
        from .models import ChannelListing

        guest_house, denied = self._own_house(request)
        if denied:
            return denied
        listing = ChannelListing.objects.filter(guest_house=guest_house, channel=str(request.data.get("channel") or ""), is_active=True).exclude(calendar_url="").first()
        if listing is None:
            return Response({"detail": "That booking site isn't connected."}, status=status.HTTP_404_NOT_FOUND)
        result = sync_channel_calendar(listing)
        return Response({"result": result, "channel": self._channel_row(request, listing)}, status=status.HTTP_200_OK if result["ok"] else status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="rotate-channel-link")
    def rotate_channel_link(self, request, pk=None):
        """Gives a booking site a new private Oaziland calendar link; the old one stops working at once. For when the
        link was shared or leaked. The site has to be given the new link."""
        from .models import ChannelListing, new_export_token

        guest_house, denied = self._own_house(request)
        if denied:
            return denied
        listing = ChannelListing.objects.filter(guest_house=guest_house, channel=str(request.data.get("channel") or ""), is_active=True).exclude(calendar_url="").first()
        if listing is None:
            return Response({"detail": "That booking site isn't connected."}, status=status.HTTP_404_NOT_FOUND)
        listing.export_token = new_export_token()
        listing.save(update_fields=["export_token"])
        return Response(self._channel_row(request, listing), status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="disconnect-channel")
    def disconnect_channel(self, request, pk=None):
        from .calendar_sync import disconnect_channel
        from .models import ChannelListing

        guest_house, denied = self._own_house(request)
        if denied:
            return denied
        listing = ChannelListing.objects.filter(guest_house=guest_house, channel=str(request.data.get("channel") or ""), is_active=True).first()
        if listing is None:
            return Response({"detail": "That booking site isn't connected."}, status=status.HTTP_404_NOT_FOUND)
        disconnect_channel(listing)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="my-dashboard")
    def my_dashboard(self, request):
        """A real gap this closes: get_host_dashboard_summary()
        already aggregated across every guest house a host owns, but
        nothing ever exposed it â€” same class of gap as the landlord
        portfolio/technician/agent dashboards."""
        return Response(get_host_dashboard_summary(request.user))

    @action(detail=True, methods=["post"], url_path="add-photo")
    def add_photo(self, request, pk=None):
        guest_house = self.get_object()
        if guest_house.owner_id != request.user.id:
            return Response({"detail": "Only the guest house's own owner can add photos to it."}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required â€” upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        is_first = not guest_house.asset_photos.exists()
        photo = PropertyAssetPhoto.objects.create(property_asset=guest_house, url=url, media_type=media_type, is_primary=is_first)
        return Response({"id": photo.id, "url": photo.url, "media_type": photo.media_type, "is_primary": photo.is_primary}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-photo")
    def remove_photo(self, request, pk=None):
        guest_house = self.get_object()
        if guest_house.owner_id != request.user.id:
            return Response({"detail": "Only the guest house's own owner can remove its photos."}, status=status.HTTP_403_FORBIDDEN)
        photo_id = request.data.get("photo_id")
        deleted_count, _ = PropertyAssetPhoto.objects.filter(property_asset=guest_house, id=photo_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Photo not found on this guest house."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


from django.http import HttpResponse, HttpResponseNotFound
from rest_framework.decorators import api_view, permission_classes as drf_permission_classes


@api_view(["GET"])
@drf_permission_classes([permissions.AllowAny])
def channel_calendar_feed(request, listing_id, token):
    """The private iCal feed a booking site subscribes to. Anyone holding the link can read it, so it carries no
    guest details, only which nights are taken; the owner can rotate it from the booking-sites panel."""
    import secrets

    from .calendar_sync import render_feed
    from .models import ChannelListing

    listing = ChannelListing.objects.filter(pk=listing_id, is_active=True).select_related("guest_house").first()
    if listing is None or not secrets.compare_digest(listing.export_token, token):
        return HttpResponseNotFound("Not found")
    response = HttpResponse(render_feed(listing), content_type="text/calendar; charset=utf-8")
    response["Cache-Control"] = "private, max-age=300"
    return response