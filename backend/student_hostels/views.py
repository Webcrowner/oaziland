"""
student_hostels.views — hostel search/browse (public), real creation,
and a student's own room allocations. Room allocation itself stays
admin/warden-initiated (allocate_room already enforces priority
ordering) rather than a self-service create-your-own-allocation
endpoint, so that part is deliberately read-only from a student's side.

StudentHostelViewSet is no longer ReadOnlyModelViewSet — the real gap
this closes: no real owner could ever list their own hostel. Reuses
the existing create_student_hostel() service function rather than
reimplementing the owner_profile/PropertyAsset.owner sync it already
handles correctly.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from oaziland.permissions import IsAdminRole, IsKycVerified
from property.models import PropertyAssetPhoto
from .models import StudentHostel, RoomAllocation, WelfareAlert, ParentGuardianAccess
from .serializers import (
    StudentHostelSerializer,
    StudentHostelCreateSerializer,
    RoomAllocationSerializer,
    WelfareAlertSerializer,
    HostelWaitlistJoinSerializer,
    WaitlistSerializer,
    GrantParentAccessSerializer,
    ParentGuardianAccessSerializer,
    SemesterSerializer,
)
from .services import (
    create_student_hostel, join_hostel_waitlist, end_room_allocation, grant_parent_guardian_access,
    revoke_parent_guardian_access, get_parent_visible_data, AccessDeniedError,
)


class StudentHostelViewSet(viewsets.ModelViewSet):
    # WHY no prefetch_related("units") here: that relation returns base
    # Unit rows (see StudentHostelSerializer's own docstring for why),
    # not the HostelUnit subclass instances the serializer actually
    # needs — the serializer queries HostelUnit directly instead.
    serializer_class = StudentHostelSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_permissions(self):
        # Listing a hostel (a real financial/legal commitment) needs
        # real identity verification, same as property/hotel/venue
        # listings — browsing stays completely open to anyone.
        if self.action == "create":
            return [IsKycVerified()]
        return super().get_permissions()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return StudentHostel.objects.none()
        return StudentHostel.objects.select_related("owner__agent_profile").prefetch_related("asset_photos").order_by("-created_at")

    @extend_schema(request=StudentHostelCreateSerializer, responses={201: StudentHostelSerializer})
    def create(self, request, *args, **kwargs):
        from student_hostels.models import OwnerProfile, OwnerType
        from geo.models import Quarter

        input_serializer = StudentHostelCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        quarter = Quarter.objects.filter(id=data["quarter"]).first()
        if quarter is None:
            return Response({"detail": "That neighborhood was not found."}, status=status.HTTP_400_BAD_REQUEST)

        # Same real auto-provisioning pattern already used for
        # marketplace listings — a first-time hostel owner shouldn't
        # need a separate manual setup step first.
        owner_profile, _ = OwnerProfile.objects.get_or_create(account_user=request.user, defaults={"owner_type": OwnerType.LANDLORD})
        hostel = create_student_hostel(
            owner_profile=owner_profile,
            quarter=quarter,
            property_type=data["property_type"],
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
        )
        return Response(StudentHostelSerializer(hostel).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="set-location")
    def set_location(self, request, pk=None):
        hostel = self.get_object()
        if hostel.owner_id != request.user.id and not hasattr(request.user, "admin_profile"):
            return Response({"detail": "Only the hostel's owner can set its location."}, status=status.HTTP_403_FORBIDDEN)
        lat = request.data.get("latitude")
        lng = request.data.get("longitude")
        if lat is None or lng is None:
            return Response({"detail": "latitude and longitude are required."}, status=status.HTTP_400_BAD_REQUEST)
        hostel.latitude = lat
        hostel.longitude = lng
        hostel.save(update_fields=["latitude", "longitude"])
        return Response({"id": str(hostel.id), "latitude": str(hostel.latitude), "longitude": str(hostel.longitude)})

    @action(detail=True, methods=["post"], url_path="add-photo")
    def add_photo(self, request, pk=None):
        hostel = self.get_object()
        if hostel.owner_id != request.user.id:
            return Response({"detail": "Only the hostel's own owner can add photos to it."}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url")
        if not url:
            return Response({"detail": "url is required — upload the file to /api/media/upload/ first."}, status=status.HTTP_400_BAD_REQUEST)
        media_type = request.data.get("media_type", "PHOTO")
        is_first = not hostel.asset_photos.exists()
        photo = PropertyAssetPhoto.objects.create(property_asset=hostel, url=url, media_type=media_type, is_primary=is_first)
        return Response({"id": photo.id, "url": photo.url, "media_type": photo.media_type, "is_primary": photo.is_primary}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove-photo")
    def remove_photo(self, request, pk=None):
        hostel = self.get_object()
        if hostel.owner_id != request.user.id:
            return Response({"detail": "Only the hostel's own owner can remove its photos."}, status=status.HTTP_403_FORBIDDEN)
        photo_id = request.data.get("photo_id")
        deleted_count, _ = PropertyAssetPhoto.objects.filter(property_asset=hostel, id=photo_id).delete()
        if deleted_count == 0:
            return Response({"detail": "Photo not found on this hostel."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def semesters(self, request, pk=None):
        """The real gap this closes: joining the hostel waitlist needed
        a real Semester id, but nothing ever let a student browse which
        semesters actually apply to THIS hostel's partner institution(s)
        — a raw numeric id was the only way in. Public, same as
        browsing the hostel itself."""
        from .models import Semester
        hostel = self.get_object()
        institution_ids = hostel.institution_partnerships.values_list("id", flat=True)
        semesters = Semester.objects.filter(institution_id__in=institution_ids).order_by("-start_date")
        return Response(SemesterSerializer(semesters, many=True).data)


class MyRoomAllocationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RoomAllocationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return RoomAllocation.objects.none()
        return RoomAllocation.objects.filter(student=self.request.user).order_by("-allocated_at")


class MyHostelWaitlistView(APIView):
    """The real gap this closes: rank_waitlist_for_unit_type()/
    process_waitlist_for_freed_unit() (Prompt 11's 'join a waitlist,
    get auto-notified or auto-allocated when a matching unit frees up')
    were fully built, but nothing ever let a student actually join one."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=HostelWaitlistJoinSerializer, responses={201: WaitlistSerializer, 404: dict})
    def post(self, request):
        input_serializer = HostelWaitlistJoinSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        hostel = StudentHostel.objects.filter(id=data["hostel"]).first()
        if hostel is None:
            return Response({"detail": "That hostel was not found."}, status=status.HTTP_404_NOT_FOUND)
        from .models import Semester
        semester = Semester.objects.filter(id=data["semester"]).first()
        if semester is None:
            return Response({"detail": "That semester was not found."}, status=status.HTTP_404_NOT_FOUND)

        entry = join_hostel_waitlist(student=request.user, hostel=hostel, desired_unit_type=data["desired_unit_type"], semester=semester)
        return Response(WaitlistSerializer(entry).data, status=status.HTTP_201_CREATED)


class AdminWelfareAlertViewSet(viewsets.ModelViewSet):
    """Admin-controlled Welfare Alert Queue per Pre-Development Spec §8.4 and RBAC Matrix.
    Admins can review student welfare alerts (payment distress, safety risks, medical incidents),
    log actions, and mark them resolved."""
    serializer_class = WelfareAlertSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WelfareAlert.objects.none()
        return WelfareAlert.objects.select_related("student", "raised_by").order_by("-created_at")

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        from django.utils import timezone
        alert = self.get_object()
        alert.resolved_at = timezone.now()
        alert.save(update_fields=["resolved_at"])
        return Response(WelfareAlertSerializer(alert).data, status=status.HTTP_200_OK)


class AdminRoomAllocationViewSet(viewsets.ReadOnlyModelViewSet):
    """The other half of the hostel waitlist gap: ending an allocation
    (semester-end, early checkout) had NO endpoint at all, so a freed
    unit could never actually trigger process_waitlist_for_freed_unit()
    — the auto-reallocation engine was permanently unreachable. Mirrors
    AdminWelfareAlertViewSet/AdminTechnicianViewSet's admin-controlled
    pattern exactly; room allocation stays deliberately not
    self-service (see MyRoomAllocationViewSet's own docstring)."""
    serializer_class = RoomAllocationSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return RoomAllocation.objects.none()
        from .models import RoomAllocationStatus
        return RoomAllocation.objects.filter(status=RoomAllocationStatus.ACTIVE).select_related("student", "unit", "semester")

    @action(detail=True, methods=["post"], url_path="end")
    def end(self, request, pk=None):
        allocation = self.get_object()
        end_room_allocation(allocation)
        return Response(RoomAllocationSerializer(allocation).data)


class MyParentAccessGrantsView(APIView):
    """The real gap this closes: ParentGuardianAccess could only ever
    be created directly in the database — a student had no way to
    actually grant a parent visibility, or revoke it later."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: ParentGuardianAccessSerializer(many=True)})
    def get(self, request):
        # WHY guardian_accesses (not guardian_access_grants): this view
        # is student-facing (see post()/delete() below, both scoped to
        # request.user as the student) — guardian_access_grants is the
        # OTHER direction (grants where request.user is the PARENT).
        grants = request.user.guardian_accesses.order_by("-consented_at")
        return Response(ParentGuardianAccessSerializer(grants, many=True).data)

    @extend_schema(request=GrantParentAccessSerializer, responses={201: ParentGuardianAccessSerializer, 404: dict})
    def post(self, request):
        from identity.models import User
        input_serializer = GrantParentAccessSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        parent_user = User.objects.filter(id=input_serializer.validated_data["parent_user_id"]).first()
        if parent_user is None:
            return Response({"detail": "That user was not found."}, status=status.HTTP_404_NOT_FOUND)
        grant = grant_parent_guardian_access(
            student=request.user, parent_user=parent_user,
            also_notify_institution=input_serializer.validated_data["also_notify_institution"],
        )
        return Response(ParentGuardianAccessSerializer(grant).data, status=status.HTTP_201_CREATED)

    @extend_schema(responses={200: dict, 403: dict, 404: dict})
    def delete(self, request):
        grant_id = request.query_params.get("grant_id")
        grant = ParentGuardianAccess.objects.filter(id=grant_id).first()
        if grant is None:
            return Response({"detail": "That access grant was not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            revoke_parent_guardian_access(grant=grant, actor=request.user)
        except AccessDeniedError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"detail": "Access revoked."})


class MyGuardianAccessesView(APIView):
    """The other, PARENT-facing side of MyParentAccessGrantsView (which
    is student-facing) — the real gap this closes: a parent had no way
    to discover WHICH students had granted them access at all; the
    only way to reach ParentPortalView was already knowing a student's
    raw user id."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: ParentGuardianAccessSerializer(many=True)})
    def get(self, request):
        grants = request.user.guardian_access_grants.filter(revoked_at__isnull=True).order_by("-consented_at")
        return Response(ParentGuardianAccessSerializer(grants, many=True).data)


class ParentPortalView(APIView):
    """The real gap this closes: get_parent_visible_data() (the strict,
    consent-gated, billing-and-welfare-status-ONLY read-only view for a
    parent) was fully built and tested, but nothing ever exposed it —
    a real parent account could never actually see anything."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict, 403: dict, 404: dict})
    def get(self, request, student_id):
        from identity.models import User
        student = User.objects.filter(id=student_id).first()
        if student is None:
            return Response({"detail": "That student was not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            data = get_parent_visible_data(parent_user=request.user, student=student)
        except AccessDeniedError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(data)
