"""
services.views — the real gap this closes: the full technician
dispatch lifecycle (find_available_technicians, create/accept/start/
complete_service_request_with_payment) and the real technician
dashboard summary all had substantial, working logic with zero way to
reach any of it.
"""
from django.http import Http404
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from identity.models import TechnicianProfile
from .models import ServiceRequest, ServiceRequestStatus, FacilityManagementContract, ProjectManagementCase
from .serializers import (
    ServiceRequestSerializer, CompleteServiceRequestSerializer, FindTechniciansSerializer,
    TechnicianProfileSerializer, TechnicianRegistrationSerializer, ServiceRequestPhotoSerializer,
    ServiceRequestPhotoUploadSerializer, TechnicianAvailabilitySlotSerializer, SetTechnicianAvailabilitySerializer,
    TechnicianLocationPingSerializer, FacilityManagementContractSerializer, LogFacilityVisitSerializer,
    FacilityVisitLogSerializer, ProjectManagementCaseSerializer, AddProjectMilestoneSerializer,
    ProjectMilestoneSerializer, LinkProjectTechnicianSerializer, CompleteProjectMilestoneSerializer,
    ProposeQuoteSerializer, EnRouteSerializer, DisputeServiceRequestSerializer, RateTechnicianSerializer,
    TechnicianDocumentsSerializer, RescheduleServiceRequestSerializer, ServiceRequestMessageSerializer,
)
from .services import (
    release_service_request, mark_en_route, propose_quote, approve_quote, dispute_service_request, rate_technician,
    reschedule_service_request, post_service_request_message,
    TechnicianSpecialtyMismatchError, ServiceRequestStateError, InvalidQuoteError, AlreadyRegisteredTechnicianError,
    create_service_request, accept_service_request, start_service, complete_service_request_with_payment,
    find_available_technicians, get_technician_dashboard_summary, register_as_technician, InvalidSpecialtyError,
    NotARegisteredTechnicianError, TechnicianNotVerifiedError, cancel_service_request, ServiceRequestAlreadyAcceptedError,
    add_service_request_photo, NotPartyToServiceRequestError, submit_technician_location_ping,
    get_technician_availability, set_technician_availability, list_facility_contracts_for_user, log_facility_visit,
    NotAuthorizedForFacilityContractError, list_project_cases_for_user, link_technician_to_project,
    add_project_milestone, complete_project_milestone, NotAuthorizedForProjectCaseError,
)
from oaziland.permissions import IsKycVerified, IsAdminRole


class ServiceRequestViewSet(viewsets.ModelViewSet):
    """create requires login; list is scoped to the requester's own
    requests plus any open, unclaimed request (so a technician can
    actually discover work to accept) — but detail actions
    (accept/start/complete) deliberately use an UNSCOPED queryset with
    their own explicit real permission checks instead. WHY: the exact
    bug already found and fixed in marketplace's ride-hailing
    ViewSet — scoping detail actions the same restrictive way as list
    would silently turn a deliberate 403 into an uninformative 404,
    since get_object() would filter the row out before the explicit
    check ever ran. Applied here from the start, not found by a
    failing test this time."""
    serializer_class = ServiceRequestSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        # Requesting a technician is a real checkout — payment settles
        # through the same escrow flow as any other booking — so it
        # needs the same identity verification gate.
        if self.action == "create":
            return [IsKycVerified()]
        return super().get_permissions()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ServiceRequest.objects.none()
        from django.db.models import Q
        if self.action == "list":
            user = self.request.user
            visible = Q(requester=user) | Q(technician=user)
            # The open job board is only for verified technicians, and only for their own specialties.
            profile = getattr(user, "technician_profile", None)
            if profile is not None and profile.is_verified and profile.specialties:
                visible |= Q(status=ServiceRequestStatus.REQUESTED, category__in=profile.specialties)
            return (
                ServiceRequest.objects.filter(visible).distinct()
                .select_related("requester", "technician", "quarter").prefetch_related("photos")
                .order_by("-requested_at")
            )
        return ServiceRequest.objects.select_related("requester", "technician", "quarter").prefetch_related("photos")

    def retrieve(self, request, *args, **kwargs):
        # Detail GET stays hidden from outsiders (404, so existence isn't leaked).
        service_request = self.get_object()
        user = request.user
        profile = getattr(user, "technician_profile", None)
        is_party = user.id in (service_request.requester_id, service_request.technician_id)
        on_board = (
            profile is not None and profile.is_verified and service_request.status == ServiceRequestStatus.REQUESTED
            and service_request.category in (profile.specialties or [])
        )
        if not (is_party or on_board):
            raise Http404
        return Response(self.get_serializer(service_request).data)

    def perform_create(self, serializer):
        service_request = create_service_request(
            requester=self.request.user, category=serializer.validated_data["category"],
            description=serializer.validated_data.get("description", ""),
            quarter=serializer.validated_data.get("quarter"), priority=serializer.validated_data.get("priority"),
            latitude=serializer.validated_data.get("latitude"),
            scheduled_for=serializer.validated_data.get("scheduled_for"),
            longitude=serializer.validated_data.get("longitude"),
        )
        serializer.instance = service_request

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        service_request = self.get_object()
        try:
            accept_service_request(service_request=service_request, technician=request.user)
        except (NotARegisteredTechnicianError, TechnicianNotVerifiedError, TechnicianSpecialtyMismatchError, NotPartyToServiceRequestError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except ServiceRequestStateError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(service_request).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """The real gap this closes: a requester had no way to back out
        of a request before a technician accepted it."""
        service_request = self.get_object()
        if service_request.requester_id != request.user.id:
            return Response({"detail": "Only the request's own requester can cancel it."}, status=status.HTTP_403_FORBIDDEN)
        try:
            cancel_service_request(service_request=service_request)
        except ServiceRequestAlreadyAcceptedError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(service_request).data)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        service_request = self.get_object()
        if service_request.technician_id != request.user.id:
            return Response({"detail": "Only the request's own technician can start it."}, status=status.HTTP_403_FORBIDDEN)
        if service_request.status not in (ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.EN_ROUTE):
            return Response({"detail": "This request must be accepted before it can start."}, status=status.HTTP_400_BAD_REQUEST)
        if not service_request.quote_approved:
            return Response({"detail": "The requester must approve your quote before work can start."}, status=status.HTTP_400_BAD_REQUEST)
        start_service(service_request)
        return Response(self.get_serializer(service_request).data)

    @action(detail=True, methods=["post"])
    @extend_schema(request=CompleteServiceRequestSerializer, responses={200: ServiceRequestSerializer, 400: dict})
    def complete(self, request, pk=None):
        """Only the request's own requester pays for it — settling
        through the real payment gateway, exactly like every other
        real payment on the platform. Reuses transactions.views'
        FakeRedisLock exactly, the same already-documented placeholder
        every other booking flow (including marketplace's rides)
        already relies on."""
        from transactions.views import FakeRedisLock
        from payments.gateways import get_active_gateway

        service_request = self.get_object()
        if service_request.requester_id != request.user.id:
            return Response({"detail": "Only the request's own requester can complete payment for it."}, status=status.HTTP_403_FORBIDDEN)
        if service_request.status != ServiceRequestStatus.IN_PROGRESS:
            return Response({"detail": "This request must be in progress before it can be completed."}, status=status.HTTP_400_BAD_REQUEST)

        input_serializer = CompleteServiceRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        if not service_request.quote_approved or service_request.quoted_amount_xaf is None:
            return Response({"detail": "There is no approved quote for this job."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            complete_service_request_with_payment(
                service_request=service_request, amount_xaf=service_request.quoted_amount_xaf,
                lock_client=FakeRedisLock(), payment_gateway=get_active_gateway(),
                phone_number=input_serializer.validated_data["phone_number"],
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(service_request).data)

    @action(detail=True, methods=["post"], url_path="upload-photo")
    @extend_schema(request=ServiceRequestPhotoUploadSerializer, responses={201: ServiceRequestPhotoSerializer, 403: dict})
    def upload_photo(self, request, pk=None):
        """Real before/after job documentation — closes the gap where
        ServiceRequestPhoto existed and was serialized read-only, but
        nothing ever let the requester or technician actually attach
        one."""
        service_request = self.get_object()
        input_serializer = ServiceRequestPhotoUploadSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            photo = add_service_request_photo(
                service_request=service_request, actor=request.user,
                photo_type=input_serializer.validated_data["photo_type"],
                file_url=input_serializer.validated_data["file_url"],
            )
        except NotPartyToServiceRequestError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(ServiceRequestPhotoSerializer(photo).data, status=status.HTTP_201_CREATED)

    def _run(self, request, func, **kwargs):
        # Shared error mapping for the lifecycle actions below.
        service_request = self.get_object()
        try:
            func(service_request=service_request, **kwargs)
        except NotPartyToServiceRequestError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except (ServiceRequestStateError, InvalidQuoteError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        service_request.refresh_from_db()
        return Response(self.get_serializer(service_request).data)

    @action(detail=True, methods=["post"])
    @extend_schema(request=None, responses={200: ServiceRequestSerializer, 400: dict, 403: dict})
    def release(self, request, pk=None):
        """Technician backs out before work starts; the job returns to the board."""
        return self._run(request, release_service_request, technician=request.user)

    @action(detail=True, methods=["post"], url_path="en-route")
    @extend_schema(request=EnRouteSerializer, responses={200: ServiceRequestSerializer, 400: dict, 403: dict})
    def en_route(self, request, pk=None):
        input_serializer = EnRouteSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        return self._run(
            request, mark_en_route, technician=request.user,
            latitude=input_serializer.validated_data.get("latitude"), longitude=input_serializer.validated_data.get("longitude"),
        )

    @action(detail=True, methods=["post"])
    @extend_schema(request=ProposeQuoteSerializer, responses={200: ServiceRequestSerializer, 400: dict, 403: dict})
    def quote(self, request, pk=None):
        input_serializer = ProposeQuoteSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        return self._run(
            request, propose_quote, technician=request.user,
            amount_xaf=data.get("amount_xaf"), labor_xaf=data.get("labor_xaf"), materials_xaf=data.get("materials_xaf"),
        )

    @action(detail=True, methods=["post"], url_path="approve-quote")
    @extend_schema(request=None, responses={200: ServiceRequestSerializer, 400: dict, 403: dict})
    def approve_quote(self, request, pk=None):
        return self._run(request, approve_quote, requester=request.user)

    @action(detail=True, methods=["post"])
    @extend_schema(request=DisputeServiceRequestSerializer, responses={200: ServiceRequestSerializer, 400: dict, 403: dict})
    def dispute(self, request, pk=None):
        input_serializer = DisputeServiceRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        return self._run(request, dispute_service_request, actor=request.user, reason=input_serializer.validated_data["reason"])

    @action(detail=True, methods=["post"])
    @extend_schema(request=RescheduleServiceRequestSerializer, responses={200: ServiceRequestSerializer, 400: dict, 403: dict})
    def reschedule(self, request, pk=None):
        input_serializer = RescheduleServiceRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        return self._run(request, reschedule_service_request, actor=request.user, scheduled_for=input_serializer.validated_data["scheduled_for"])

    @extend_schema(methods=["GET"], responses={200: ServiceRequestMessageSerializer(many=True)})
    @extend_schema(methods=["POST"], request=ServiceRequestMessageSerializer, responses={201: ServiceRequestMessageSerializer, 403: dict})
    @action(detail=True, methods=["get", "post"])
    def messages(self, request, pk=None):
        """In-job chat, visible to the two parties only (404 for anyone else)."""
        service_request = self.get_object()
        if request.user.id not in (service_request.requester_id, service_request.technician_id):
            raise Http404
        if request.method == "GET":
            thread = service_request.messages.select_related("sender")
            return Response(ServiceRequestMessageSerializer(thread, many=True).data)
        input_serializer = ServiceRequestMessageSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        message = post_service_request_message(service_request=service_request, sender=request.user, text=input_serializer.validated_data["text"])
        return Response(ServiceRequestMessageSerializer(message).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    @extend_schema(responses={200: dict, 403: dict, 404: dict})
    def receipt(self, request, pk=None):
        """Itemized receipt for a completed job, visible to its two parties only."""
        service_request = self.get_object()
        if request.user.id not in (service_request.requester_id, service_request.technician_id):
            raise Http404
        if service_request.status != ServiceRequestStatus.COMPLETED or service_request.booking_id is None:
            return Response({"detail": "A receipt is available once the job is completed and paid."}, status=status.HTTP_404_NOT_FOUND)
        escrow = getattr(service_request.booking, "escrow", None)
        return Response({
            "receipt_number": str(service_request.booking.id),
            "category": service_request.get_category_display(),
            "category_code": service_request.category,
            "description": service_request.description,
            "requester_name": service_request.requester.full_name or service_request.requester.username,
            "technician_name": service_request.technician.full_name or service_request.technician.username if service_request.technician else None,
            "completed_at": service_request.completed_at,
            "labor_xaf": service_request.quoted_labor_xaf,
            "materials_xaf": service_request.quoted_materials_xaf,
            "total_xaf": service_request.quoted_amount_xaf,
            "platform_fee_xaf": escrow.platform_fee_xaf if escrow else None,
            "technician_payout_xaf": escrow.payee_amount_xaf if escrow else None,
        })

    @action(detail=True, methods=["post"])
    @extend_schema(request=RateTechnicianSerializer, responses={200: ServiceRequestSerializer, 400: dict, 403: dict})
    def rate(self, request, pk=None):
        input_serializer = RateTechnicianSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        return self._run(request, rate_technician, requester=request.user, score=input_serializer.validated_data["score"])


class TechnicianDirectoryView(APIView):
    """Public list of admin-verified technicians, filterable by specialty,
    so a homeowner can browse before posting a request."""
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from django.db.models import Count, Q
        specialty = request.query_params.get("specialty")
        profiles = (
            TechnicianProfile.objects.filter(is_verified=True).select_related("user", "coverage_quarter")
            .annotate(completed_jobs=Count("user__service_requests_received", filter=Q(user__service_requests_received__status=ServiceRequestStatus.COMPLETED)))
            .order_by("-avg_rating", "-completed_jobs")
        )
        # Specialties are filtered in Python: JSONField __contains isn't supported on every DB backend.
        if specialty:
            profiles = [p for p in profiles if specialty in (p.specialties or [])]
        return Response([
            {
                "user_id": str(p.user_id), "name": p.user.full_name or p.user.username,
                "profile_image_url": p.user.profile_image_url, "specialties": p.specialties,
                "portfolio_urls": p.portfolio_urls,
                "quarter_name": p.coverage_quarter.name if p.coverage_quarter else None,
                "avg_rating": float(p.avg_rating), "completed_jobs": p.completed_jobs,
            }
            for p in list(profiles)[:100]
        ])


class FindTechniciansView(APIView):
    """A real gap this closes: find_available_technicians() already
    matched by specialty AND real proximity (reusing the same
    haversine distance math as 'properties near me'), but nothing
    ever exposed it."""
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=FindTechniciansSerializer, responses={200: dict})
    def post(self, request):
        input_serializer = FindTechniciansSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        matches = find_available_technicians(
            category=data["category"], latitude=data["latitude"], longitude=data["longitude"], radius_km=data["radius_km"],
        )
        return Response([
            {"technician_id": str(profile.user_id), "technician_name": profile.user.full_name, "distance_km": float(distance)}
            for profile, distance in matches
        ])


class MyTechnicianDashboardView(APIView):
    """A real gap this closes: get_technician_dashboard_summary()
    already computed real job counts, wallet balance, and a real
    period-over-period jobs trend, but nothing ever exposed it."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(get_technician_dashboard_summary(request.user))


class MyTechnicianProfileView(APIView):
    """The real gap this closes: previously ANY authenticated user
    could accept a service request and become its technician — no
    registration, no vetting, at all (the exact bug already found and
    fixed for OaziGo drivers). Real self-service registration; unlike
    Hotel/Venue/Driver there's no verified flag on TechnicianProfile
    itself, matching the model's own real fields."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: TechnicianProfileSerializer, 404: dict})
    def get(self, request):
        if not hasattr(request.user, "technician_profile"):
            return Response({"detail": "You have not registered as a technician yet."}, status=status.HTTP_404_NOT_FOUND)
        return Response(TechnicianProfileSerializer(request.user.technician_profile).data)

    @extend_schema(request=TechnicianRegistrationSerializer, responses={201: TechnicianProfileSerializer})
    def post(self, request):
        input_serializer = TechnicianRegistrationSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            technician_profile = register_as_technician(
                user=request.user, specialties=input_serializer.validated_data["specialties"],
                coverage_quarter_id=input_serializer.validated_data.get("coverage_quarter"),
            )
        except InvalidSpecialtyError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except AlreadyRegisteredTechnicianError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TechnicianProfileSerializer(technician_profile).data, status=status.HTTP_201_CREATED)


class MyTechnicianDocumentsView(APIView):
    """A technician's own credential documents (reviewed by admins) and
    public portfolio photos; both are full-replace lists of upload URLs."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=TechnicianDocumentsSerializer, responses={200: TechnicianProfileSerializer, 403: dict})
    def put(self, request):
        profile = getattr(request.user, "technician_profile", None)
        if profile is None:
            return Response({"detail": "You have not registered as a technician yet."}, status=status.HTTP_403_FORBIDDEN)
        input_serializer = TechnicianDocumentsSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        profile.credential_urls = input_serializer.validated_data["credential_urls"]
        profile.portfolio_urls = input_serializer.validated_data["portfolio_urls"]
        profile.save(update_fields=["credential_urls", "portfolio_urls"])
        return Response(TechnicianProfileSerializer(profile).data)


class AdminTechnicianViewSet(viewsets.ReadOnlyModelViewSet):
    """The other half of the technician vetting gap: previously there was
    no way for an admin to see or verify a pending technician registration
    at all — mirrors AdminDriverViewSet exactly."""
    serializer_class = TechnicianProfileSerializer
    permission_classes = [IsAdminRole]
    queryset = TechnicianProfile.objects.filter(is_verified=False).order_by("-created_at")

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        technician_profile = self.get_object()
        if not technician_profile.credential_urls:
            return Response({"detail": "This technician has not uploaded any credential documents yet."}, status=status.HTTP_400_BAD_REQUEST)
        technician_profile.is_verified = True
        technician_profile.save(update_fields=["is_verified"])
        return Response(TechnicianProfileSerializer(technician_profile).data)


class MyTechnicianLocationPingView(APIView):
    """The real gap this closes: find_available_technicians() has
    always required a TechnicianLocationPing to exist, but nothing ever
    let a technician submit one — 'find nearby technicians' was
    permanently empty in practice. A technician's own app calls this
    periodically (or once per session) so their real location is on
    record for matching."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=TechnicianLocationPingSerializer, responses={201: dict, 403: dict})
    def post(self, request):
        if not hasattr(request.user, "technician_profile"):
            return Response({"detail": "You have not registered as a technician yet."}, status=status.HTTP_403_FORBIDDEN)
        input_serializer = TechnicianLocationPingSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        ping = submit_technician_location_ping(
            technician=request.user, latitude=input_serializer.validated_data["latitude"],
            longitude=input_serializer.validated_data["longitude"],
        )
        return Response({"latitude": str(ping.latitude), "longitude": str(ping.longitude), "recorded_at": ping.recorded_at}, status=status.HTTP_201_CREATED)


class MyTechnicianAvailabilityView(APIView):
    """The real gap this closes: TechnicianAvailabilitySlot was a real,
    saved model that find_available_technicians() never actually
    checked, and nothing let a technician manage their own weekly
    schedule anyway."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: TechnicianAvailabilitySlotSerializer(many=True)})
    def get(self, request):
        slots = get_technician_availability(request.user)
        return Response(TechnicianAvailabilitySlotSerializer(slots, many=True).data)

    @extend_schema(request=SetTechnicianAvailabilitySerializer, responses={200: TechnicianAvailabilitySlotSerializer(many=True), 403: dict})
    def put(self, request):
        if not hasattr(request.user, "technician_profile"):
            return Response({"detail": "You have not registered as a technician yet."}, status=status.HTTP_403_FORBIDDEN)
        input_serializer = SetTechnicianAvailabilitySerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        set_technician_availability(technician=request.user, slots=input_serializer.validated_data["slots"])
        slots = get_technician_availability(request.user)
        return Response(TechnicianAvailabilitySlotSerializer(slots, many=True).data)


class FacilityManagementContractViewSet(viewsets.ModelViewSet):
    """docs/01 §2.4's FacilityManagementContract — previously modeled
    nowhere at all. Scoped to the contract's own owner, assigned
    technician, or an agent on the assigned agency's roster."""
    serializer_class = FacilityManagementContractSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return FacilityManagementContract.objects.none()
        # Only "list" is scoped — detail actions (retrieve/log_visit) use
        # the unscoped queryset with their own explicit checks below, the
        # same fix already applied to ServiceRequestViewSet: scoping
        # get_object() this restrictively would silently turn a
        # deliberate 403 into an uninformative 404.
        if self.action == "list":
            return list_facility_contracts_for_user(self.request.user)
        return FacilityManagementContract.objects.all()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def retrieve(self, request, *args, **kwargs):
        contract = self.get_object()
        if not list_facility_contracts_for_user(request.user).filter(id=contract.id).exists():
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(contract).data)

    @action(detail=True, methods=["post"], url_path="log-visit")
    @extend_schema(request=LogFacilityVisitSerializer, responses={201: FacilityVisitLogSerializer, 403: dict})
    def log_visit(self, request, pk=None):
        contract = self.get_object()
        input_serializer = LogFacilityVisitSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            visit = log_facility_visit(
                contract=contract, actor=request.user,
                notes=input_serializer.validated_data["notes"], photo_url=input_serializer.validated_data["photo_url"],
            )
        except NotAuthorizedForFacilityContractError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(FacilityVisitLogSerializer(visit).data, status=status.HTTP_201_CREATED)


class ProjectManagementCaseViewSet(viewsets.ModelViewSet):
    """docs/01 §2.4's ProjectManagementCase — previously modeled nowhere
    at all. Scoped to the project's own owner or any technician linked
    to it."""
    serializer_class = ProjectManagementCaseSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ProjectManagementCase.objects.none()
        # Same fix as FacilityManagementContractViewSet: only "list" is
        # scoped, so link_technician/add_milestone/complete_milestone's
        # own explicit ownership checks can return a real 403 instead of
        # get_object() silently turning it into a 404 first.
        if self.action == "list":
            return list_project_cases_for_user(self.request.user)
        return ProjectManagementCase.objects.all()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def retrieve(self, request, *args, **kwargs):
        case = self.get_object()
        if not list_project_cases_for_user(request.user).filter(id=case.id).exists():
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(case).data)

    @action(detail=True, methods=["post"], url_path="add-milestone")
    @extend_schema(request=AddProjectMilestoneSerializer, responses={201: ProjectMilestoneSerializer, 403: dict})
    def add_milestone(self, request, pk=None):
        case = self.get_object()
        input_serializer = AddProjectMilestoneSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            milestone = add_project_milestone(case=case, actor=request.user, **input_serializer.validated_data)
        except NotAuthorizedForProjectCaseError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(ProjectMilestoneSerializer(milestone).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="complete-milestone")
    @extend_schema(request=CompleteProjectMilestoneSerializer, responses={200: ProjectMilestoneSerializer, 403: dict, 404: dict})
    def complete_milestone(self, request, pk=None):
        case = self.get_object()
        input_serializer = CompleteProjectMilestoneSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        milestone = case.milestones.filter(id=input_serializer.validated_data["milestone_id"]).first()
        if milestone is None:
            return Response({"detail": "Milestone not found on this project."}, status=status.HTTP_404_NOT_FOUND)
        try:
            complete_project_milestone(milestone=milestone, actor=request.user)
        except NotAuthorizedForProjectCaseError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(ProjectMilestoneSerializer(milestone).data)

    @action(detail=True, methods=["post"], url_path="link-technician")
    @extend_schema(request=LinkProjectTechnicianSerializer, responses={200: ProjectManagementCaseSerializer, 403: dict})
    def link_technician(self, request, pk=None):
        case = self.get_object()
        input_serializer = LinkProjectTechnicianSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        from identity.models import User
        technician = User.objects.filter(id=input_serializer.validated_data["technician"]).first()
        if technician is None:
            return Response({"detail": "No such user."}, status=status.HTTP_404_NOT_FOUND)
        try:
            link_technician_to_project(case=case, actor=request.user, technician=technician)
        except NotAuthorizedForProjectCaseError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        return Response(ProjectManagementCaseSerializer(case).data)
