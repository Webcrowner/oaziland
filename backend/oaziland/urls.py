"""
URL configuration for oaziland project.

Prompt 16: the REST API layer. A DRF router handles the model-backed
viewsets (Listing, Quarter, Booking...); JWT and interactive API docs
are wired directly here.
"""
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from identity.views import RegisterView, MyProfileView, MfaSetupView, MfaVerifyView, MyMfaStatusView
from geo.views import QuarterViewSet
from property.views import ListingViewSet
from transactions.views import BookingViewSet, payment_webhook_view
from social.views import SocialAccountLinkViewSet, TestimonialsView
from compliance.views import ConsentRecordViewSet, DataExportRequestViewSet, PolicyDocumentViewSet
from hotels.views import HotelViewSet, ReservationViewSet
from events.views import VenueViewSet, EventBookingViewSet
from student_hostels.views import StudentHostelViewSet, MyRoomAllocationViewSet
from guest_houses.views import GuestHouseLodgeViewSet
from discovery.views import WantedListingViewSet
from catalogue.views import PartnerServiceCategoryViewSet
from engagement.views import ContactMessageView
from agency.views import AgentPublicProfileView, AgencyPublicProfileView, MyAgentDashboardView, AgentDirectoryView, AgencyDirectoryView

router = DefaultRouter()
router.register(r"quarters", QuarterViewSet, basename="quarter")
router.register(r"listings", ListingViewSet, basename="listing")
router.register(r"bookings", BookingViewSet, basename="booking")
router.register(r"social-accounts", SocialAccountLinkViewSet, basename="social-account")
router.register(r"consent", ConsentRecordViewSet, basename="consent")
router.register(r"data-exports", DataExportRequestViewSet, basename="data-export")
router.register(r"policy-documents", PolicyDocumentViewSet, basename="policy-document")
router.register(r"hotels", HotelViewSet, basename="hotel")
router.register(r"reservations", ReservationViewSet, basename="reservation")
router.register(r"venues", VenueViewSet, basename="venue")
router.register(r"event-bookings", EventBookingViewSet, basename="event-booking")
router.register(r"student-hostels", StudentHostelViewSet, basename="student-hostel")
router.register(r"my-room-allocations", MyRoomAllocationViewSet, basename="my-room-allocation")
router.register(r"guest-houses", GuestHouseLodgeViewSet, basename="guest-house")
router.register(r"wanted-listings", WantedListingViewSet, basename="wanted-listing")
router.register(r"service-categories", PartnerServiceCategoryViewSet, basename="service-category")

from django.http import JsonResponse


def health_check(request):
    """A real health check — pings the actual database, not just
    'the process is running.' Railway/Render/Fly.io all expect an
    endpoint like this to know when to route traffic to a new deploy
    and when to restart a failed one."""
    from django.db import connection
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return JsonResponse({"status": "healthy"})
    except Exception as e:
        return JsonResponse({"status": "unhealthy", "detail": str(e)}, status=503)


urlpatterns = [
    path('admin/', admin.site.urls),
    path('health/', health_check, name='health-check'),

    # Authentication
    path('api/auth/register/', RegisterView.as_view(), name='register'),
    path('api/auth/login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/login/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/me/', MyProfileView.as_view(), name='my_profile'),
    path('api/auth/mfa/setup/', MfaSetupView.as_view(), name='mfa-setup'),
    path('api/auth/mfa/verify/', MfaVerifyView.as_view(), name='mfa-verify'),
    path('api/auth/mfa/status/', MyMfaStatusView.as_view(), name='mfa-status'),

    # Payment provider webhook — a real, publicly-reachable endpoint,
    # not just service-layer logic with nowhere to actually be called from.
    path('api/webhooks/payment/', payment_webhook_view, name='payment-webhook'),

    # Model-backed API (Listing, Quarter, Booking — Prompt 16's core pass)
    path('api/', include(router.urls)),

    # Agent/agency profiles — public (anyone) and the private dashboard.
    path('api/agents/<uuid:user_id>/profile/', AgentPublicProfileView.as_view(), name='agent-public-profile'),
    path('api/agencies/<uuid:agency_id>/profile/', AgencyPublicProfileView.as_view(), name='agency-public-profile'),
    path('api/agents/', AgentDirectoryView.as_view(), name='agent-directory'),
    path('api/agencies/', AgencyDirectoryView.as_view(), name='agency-directory'),
    path('api/my-agent-dashboard/', MyAgentDashboardView.as_view(), name='my-agent-dashboard'),
    path('api/testimonials/', TestimonialsView.as_view(), name='testimonials'),
    path('api/contact/', ContactMessageView.as_view(), name='contact'),

    # Interactive API documentation — the acceptance criteria's
    # explicit requirement: "open the Swagger documentation yourself."
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
