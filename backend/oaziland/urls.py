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

from identity.views import RegisterView, MyProfileView, MfaSetupView, MfaVerifyView, MyMfaStatusView, MyReferralCodeView
from geo.views import QuarterViewSet
from property.views import ListingViewSet, HouseViewSet, ShopViewSet
from land.views import LandViewSet
from transactions.views import BookingViewSet, payment_webhook_view
from social.views import SocialAccountLinkViewSet, TestimonialsView, ConversationViewSet, MyPresenceSettingsView, MyFavoriteListingsView, ToggleFavoriteListingView, PostViewSet, CommentViewSet
from trust_safety.views import AdminConsoleSummaryView, AdminVerificationRequestViewSet, AdminContentReportViewSet, AdminDisputeCaseViewSet
from compliance.views import ConsentRecordViewSet, DataExportRequestViewSet, PolicyDocumentViewSet
from hotels.views import HotelViewSet, ReservationViewSet
from events.views import VenueViewSet, EventBookingViewSet
from student_hostels.views import StudentHostelViewSet, MyRoomAllocationViewSet
from guest_houses.views import GuestHouseLodgeViewSet
from discovery.views import WantedListingViewSet, SavedSearchViewSet, MyComparisonView
from notifications.views import MyNotificationViewSet
from monetization.views import MyCreatorPremiumView
from uploads.views import MediaUploadView
from finance.views import PropertyValuationView, AffordabilityEstimateView
from flyers.views import FlyerViewSet
from property_management.views import (
    MaintenanceRequestViewSet, TenantScreeningRequestViewSet, AgentSafetyCheckInViewSet, LeaseViewSet, OpenDisputeView,
)
from marketplace.views import (
    WarehouseListingViewSet, StoreListingViewSet, BusinessListingViewSet, CarListingViewSet, RideViewSet, ListingConditionView,
)
from services.views import ServiceRequestViewSet, FindTechniciansView, MyTechnicianDashboardView
from catalogue.views import PartnerServiceCategoryViewSet
from engagement.views import ContactMessageView
from careers.views import TrainingProgramViewSet, MyEnrollmentViewSet, JobPostingViewSet, MyJobApplicationViewSet
from agency.views import AgentPublicProfileView, AgencyPublicProfileView, MyAgentDashboardView, AgentDirectoryView, AgencyDirectoryView

router = DefaultRouter()
router.register(r"quarters", QuarterViewSet, basename="quarter")
router.register(r"listings", ListingViewSet, basename="listing")
router.register(r"houses", HouseViewSet, basename="house")
router.register(r"shops", ShopViewSet, basename="shop")
router.register(r"lands", LandViewSet, basename="land")
router.register(r"conversations", ConversationViewSet, basename="conversation")
router.register(r"posts", PostViewSet, basename="post")
router.register(r"flyers", FlyerViewSet, basename="flyer")
router.register(r"maintenance-requests", MaintenanceRequestViewSet, basename="maintenance-request")
router.register(r"tenant-screenings", TenantScreeningRequestViewSet, basename="tenant-screening")
router.register(r"safety-check-ins", AgentSafetyCheckInViewSet, basename="safety-check-in")
router.register(r"leases", LeaseViewSet, basename="lease")
router.register(r"warehouses", WarehouseListingViewSet, basename="warehouse")
router.register(r"stores", StoreListingViewSet, basename="store")
router.register(r"businesses", BusinessListingViewSet, basename="business")
router.register(r"cars", CarListingViewSet, basename="car")
router.register(r"rides", RideViewSet, basename="ride")
router.register(r"service-requests", ServiceRequestViewSet, basename="service-request")
router.register(r"comments", CommentViewSet, basename="comment")
router.register(r"admin/verification-requests", AdminVerificationRequestViewSet, basename="admin-verification-request")
router.register(r"admin/content-reports", AdminContentReportViewSet, basename="admin-content-report")
router.register(r"admin/dispute-cases", AdminDisputeCaseViewSet, basename="admin-dispute-case")
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
router.register(r"trainings", TrainingProgramViewSet, basename="training")
router.register(r"my-enrollments", MyEnrollmentViewSet, basename="my-enrollment")
router.register(r"jobs", JobPostingViewSet, basename="job")
router.register(r"my-job-applications", MyJobApplicationViewSet, basename="my-job-application")
router.register(r"saved-searches", SavedSearchViewSet, basename="saved-search")
router.register(r"my-notifications", MyNotificationViewSet, basename="my-notification")

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
    path('api/auth/my-referral-code/', MyReferralCodeView.as_view(), name='my-referral-code'),
    path('api/my-presence-settings/', MyPresenceSettingsView.as_view(), name='my-presence-settings'),
    path('api/admin/console-summary/', AdminConsoleSummaryView.as_view(), name='admin-console-summary'),
    path('api/my-favorites/', MyFavoriteListingsView.as_view(), name='my-favorites'),
    path('api/listings/<uuid:listing_id>/toggle-favorite/', ToggleFavoriteListingView.as_view(), name='toggle-favorite'),
    path('api/my-comparison/', MyComparisonView.as_view(), name='my-comparison'),
    path('api/my-creator-premium/', MyCreatorPremiumView.as_view(), name='my-creator-premium'),
    path('api/media/upload/', MediaUploadView.as_view(), name='media-upload'),
    path('api/valuations/', PropertyValuationView.as_view(), name='property-valuation'),
    path('api/affordability/', AffordabilityEstimateView.as_view(), name='affordability-estimate'),
    path('api/bookings/<uuid:booking_id>/open-dispute/', OpenDisputeView.as_view(), name='open-dispute'),
    path('api/technicians/find/', FindTechniciansView.as_view(), name='find-technicians'),
    path('api/my-technician-dashboard/', MyTechnicianDashboardView.as_view(), name='my-technician-dashboard'),
    path('api/listing-conditions/', ListingConditionView.as_view(), name='listing-conditions'),

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
