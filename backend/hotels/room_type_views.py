"""
hotels.room_type_views — the room-type endpoints shared by hotels and guest houses (both book rooms through the
same engine, hotels.room_types): the owner sets up room types, rooms and photos; anyone checks what's free and
what a stay costs.

A viewset using this mixin provides get_object() for the place and place_data(place) for what the owner sees after
a change.
"""
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response


def room_type_error(exc):
    from .room_types import RoomTypeUnavailableError
    code = status.HTTP_409_CONFLICT if isinstance(exc, RoomTypeUnavailableError) else status.HTTP_400_BAD_REQUEST
    return Response({"detail": str(exc)}, status=code)


class MineListMixin:
    """`GET .../?mine=1` lists every place the signed-in user owns (including ones not yet verified or taken down),
    unpaginated, so an owner's dashboard never misses a place that would fall past the first page of public
    results. Signed-out callers get an empty list. The viewset provides mine_queryset(user)."""

    def wants_mine(self) -> bool:
        return self.action == "list" and str(self.request.query_params.get("mine", "")).lower() in ("1", "true")

    def mine_queryset(self, user):
        raise NotImplementedError

    def get_queryset(self):
        if not getattr(self, "swagger_fake_view", False) and self.wants_mine():
            user = self.request.user
            if not user.is_authenticated:
                return self.mine_queryset(None).none()
            return self.mine_queryset(user)
        return super().get_queryset()

    def paginate_queryset(self, queryset):
        if self.wants_mine():
            return None
        return super().paginate_queryset(queryset)


class RoomTypeActionsMixin:
    def place_data(self, place) -> dict:
        raise NotImplementedError

    def _owner_act(self, request, work):
        """Runs `work(place, data)` for the place's owner (or an admin), returning the place as its owner sees it."""
        from .room_types import RoomTypeError

        place = self.get_object()
        if place.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the owner can manage these rooms."}, status=status.HTTP_403_FORBIDDEN)
        try:
            work(place, request.data)
        except RoomTypeError as exc:
            return room_type_error(exc)
        return Response(self.place_data(type(place).objects.get(pk=place.pk)))

    @action(detail=True, methods=["post"], url_path="room-types")
    def room_types(self, request, pk=None):
        """Create a room type, or update one (send its "room_type" id). "room_count" sets how many rooms it has."""
        from .room_types import room_type_for, save_room_type

        def work(place, data):
            existing = room_type_for(place, data.get("room_type")) if data.get("room_type") else None
            save_room_type(place, data, existing)
        return self._owner_act(request, work)

    @action(detail=True, methods=["post"], url_path="room-type-visibility")
    def room_type_visibility(self, request, pk=None):
        from .room_types import room_type_for, set_room_type_active
        return self._owner_act(request, lambda place, data: set_room_type_active(
            room_type_for(place, data.get("room_type")), data.get("is_active") in (True, "true", "1", 1),
        ))

    @action(detail=True, methods=["post"], url_path="delete-room-type")
    def delete_room_type(self, request, pk=None):
        from .room_types import delete_room_type, room_type_for
        return self._owner_act(request, lambda place, data: delete_room_type(room_type_for(place, data.get("room_type"))))

    @action(detail=True, methods=["post"], url_path="room-type-photos")
    def room_type_photos(self, request, pk=None):
        """Add a photo (upload it to /api/media/upload/ first and send its "url"), or remove one ("remove": photo id)."""
        from .room_types import add_room_type_photo, remove_room_type_photo, room_type_for

        def work(place, data):
            room_type = room_type_for(place, data.get("room_type"))
            if data.get("remove") not in (None, ""):
                remove_room_type_photo(room_type, data.get("remove"))
            else:
                add_room_type_photo(room_type, data.get("url"))
        return self._owner_act(request, work)

    @action(detail=True, methods=["get"], url_path="availability", permission_classes=[permissions.AllowAny])
    def availability(self, request, pk=None):
        """For ?check_in=YYYY-MM-DD&check_out=YYYY-MM-DD: each room type on offer, the rooms free on every night of
        the stay, and the price the guest would pay for it (the same price the reservation will charge)."""
        from .room_types import RoomTypeError, parse_stay, stay_options

        place = self.get_object()
        try:
            check_in, check_out = parse_stay(request.query_params.get("check_in"), request.query_params.get("check_out"))
        except RoomTypeError as exc:
            return room_type_error(exc)
        return Response({
            "check_in": check_in.isoformat(), "check_out": check_out.isoformat(),
            "room_types": stay_options(place, check_in, check_out),
        })
