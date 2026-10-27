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
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from identity.views import (
    RegisterView, MyProfileView, MfaSetupView, MfaVerifyView, MyMfaStatusView, MyReferralCodeView,
    MyKycView, ChangePasswordView, PasswordResetRequestView, PasswordResetConfirmView, LoginView, RefreshView,
    AdminKYCReviewViewSet, UserPublicIndexView, DevRoleSwitchView,
)
from geo.views import QuarterViewSet, AreaSuggestionView
from property.views import ListingViewSet, HouseViewSet, ShopViewSet, MyLandlordPortfolioView, MyListingsView
from land.views import LandViewSet
from transactions.views import BookingViewSet, payment_webhook_view
from social.views import (
    SocialAccountLinkViewSet, TestimonialsView, ConversationViewSet, MyPresenceSettingsView,
    PresenceHeartbeatView, PresenceOfflineView,
    MyFavoriteListingsView, ToggleFavoriteListingView, PostViewSet, CommentViewSet, RateUserView,
    MyRatingsView, ReviewViewSet, FollowView, MyReferralsView,
)
from trust_safety.views import (
    AdminConsoleSummaryView,
    AdminVerificationRequestViewSet,
    AdminContentReportViewSet,
    AdminDisputeCaseViewSet,
    AdminUserManagementViewSet,
    FileContentReportView,
)
from compliance.views import ConsentRecordViewSet, DataExportRequestViewSet, PolicyDocumentViewSet
from hotels.views import HotelViewSet, ReservationViewSet
from events.views import VenueViewSet, EventBookingViewSet
from student_hostels.views import (
    StudentHostelViewSet, MyRoomAllocationViewSet, AdminWelfareAlertViewSet, MyHostelWaitlistView, AdminRoomAllocationViewSet,
    MyParentAccessGrantsView, ParentPortalView, MyGuardianAccessesView,
)
from guest_houses.views import GuestHouseLodgeViewSet
from discovery.views import WantedListingViewSet, SavedSearchViewSet, MyComparisonView, ListingWaitlistView
from discovery.home_stats import HomeStatsView
from notifications.views import MyNotificationViewSet, AdminGreetingSettingsView, ListingShareMessageView
from monetization.views import (
    MyCreatorPremiumView, MyWalletView, WithdrawWalletView, RechargeWalletView, SendGiftView, MyGiftsView,
    ConvertGiftsView, BoostPriceQuoteView, PurchaseCampaignBoostView, MyAdCampaignsView,
)
from uploads.views import MediaUploadView
from finance.views import PropertyValuationView, AffordabilityEstimateView, MyEarningsReportView, CurrencyConversionView
from flyers.views import FlyerViewSet
from property_management.views import (
    MaintenanceRequestViewSet, TenantScreeningRequestViewSet, AgentSafetyCheckInViewSet, LeaseViewSet, OpenDisputeView,
    DisputeMessagesView,
)
from marketplace.views import (
    WarehouseListingViewSet, StoreListingViewSet, BusinessListingViewSet, CarListingViewSet, GoodsListingViewSet, RideViewSet, ListingConditionView, MarketplaceOrderViewSet,
    MyDriverProfileView, MyDriverLocationView, MyVehicleViewSet, AdminDriverViewSet, MyEmergencyContactView, AdminSosRideViewSet,
)
from services.views import (
    ServiceRequestViewSet, FindTechniciansView, TechnicianDirectoryView, MyTechnicianDocumentsView, MyTechnicianDashboardView, MyTechnicianProfileView, AdminTechnicianViewSet,
    MyTechnicianLocationPingView, MyTechnicianAvailabilityView, FacilityManagementContractViewSet, ProjectManagementCaseViewSet,
    AdminServiceDisputeViewSet,
)
from catalogue.views import PartnerServiceCategoryViewSet, RequestPartnerServiceView, MyPartnerServiceRequestsView
from engagement.views import ContactMessageView, MyBadgesView, MySupportTicketsView, SupportTicketDetailView, AnonymousChatbotView, PublicFaqListView, AdminFaqViewSet, BlockUserView, MyBlockedUsersView
from careers.views import TrainingProgramViewSet, MyEnrollmentViewSet, JobPostingViewSet, MyJobApplicationViewSet
from agency.views import (
    AgentPublicProfileView, AgencyPublicProfileView, MyAgentDashboardView, MyAgencyDashboardView, AgentDirectoryView,
    AgencyDirectoryView, AgencyAddAgentView, AgencyRemoveAgentView,
)

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
router.register(r"goods", GoodsListingViewSet, basename="goods")
router.register(r"marketplace-orders", MarketplaceOrderViewSet, basename="marketplace-order")
router.register(r"rides", RideViewSet, basename="ride")
router.register(r"my-vehicles", MyVehicleViewSet, basename="my-vehicle")
router.register(r"admin/drivers", AdminDriverViewSet, basename="admin-driver")
router.register(r"admin/sos-rides", AdminSosRideViewSet, basename="admin-sos-ride")
router.register(r"admin/technicians", AdminTechnicianViewSet, basename="admin-technician")
router.register(r"admin/service-disputes", AdminServiceDisputeViewSet, basename="admin-service-dispute")
router.register(r"service-requests", ServiceRequestViewSet, basename="service-request")
router.register(r"facility-contracts", FacilityManagementContractViewSet, basename="facility-contract")
router.register(r"project-cases", ProjectManagementCaseViewSet, basename="project-case")
router.register(r"comments", CommentViewSet, basename="comment")
router.register(r"reviews", ReviewViewSet, basename="review")
router.register(r"admin/verification-requests", AdminVerificationRequestViewSet, basename="admin-verification-request")
router.register(r"admin/content-reports", AdminContentReportViewSet, basename="admin-content-report")
router.register(r"admin/dispute-cases", AdminDisputeCaseViewSet, basename="admin-dispute-case")
router.register(r"admin/users", AdminUserManagementViewSet, basename="admin-user")
router.register(r"admin/welfare-alerts", AdminWelfareAlertViewSet, basename="admin-welfare-alert")
router.register(r"admin/room-allocations", AdminRoomAllocationViewSet, basename="admin-room-allocation")
router.register(r"admin/kyc-reviews", AdminKYCReviewViewSet, basename="admin-kyc-review")
router.register(r"admin/faqs", AdminFaqViewSet, basename="admin-faq")
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
from careers.course_views import ManageCourseViewSet, ModuleEditorViewSet, LessonEditorViewSet, QuestionEditorViewSet  # noqa: E402
router.register(r"manage/courses", ManageCourseViewSet, basename="manage-course")
router.register(r"manage/modules", ModuleEditorViewSet, basename="manage-module")
router.register(r"manage/lessons", LessonEditorViewSet, basename="manage-lesson")
router.register(r"manage/questions", QuestionEditorViewSet, basename="manage-question")
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
    path('api/auth/login/', LoginView.as_view(), name='token_obtain_pair'),
    path('api/auth/login/refresh/', RefreshView.as_view(), name='token_refresh'),
    path('api/auth/me/', MyProfileView.as_view(), name='my_profile'),
    path('api/area-suggestions/', AreaSuggestionView.as_view(), name='area-suggestions'),
    path('api/auth/dev-switch-role/', DevRoleSwitchView.as_view(), name='dev-switch-role'),
    path('api/auth/mfa/setup/', MfaSetupView.as_view(), name='mfa-setup'),
    path('api/auth/mfa/verify/', MfaVerifyView.as_view(), name='mfa-verify'),
    path('api/auth/mfa/status/', MyMfaStatusView.as_view(), name='mfa-status'),
    path('api/auth/my-referral-code/', MyReferralCodeView.as_view(), name='my-referral-code'),
    path('api/auth/kyc/', MyKycView.as_view(), name='my-kyc'),
    path('api/auth/change-password/', ChangePasswordView.as_view(), name='change-password'),
    path('api/auth/password-reset/request/', PasswordResetRequestView.as_view(), name='password-reset-request'),
    path('api/auth/password-reset/confirm/', PasswordResetConfirmView.as_view(), name='password-reset-confirm'),
    path('api/my-presence-settings/', MyPresenceSettingsView.as_view(), name='my-presence-settings'),
    path('api/presence/heartbeat/', PresenceHeartbeatView.as_view(), name='presence-heartbeat'),
    path('api/presence/offline/', PresenceOfflineView.as_view(), name='presence-offline'),
    path('api/admin/console-summary/', AdminConsoleSummaryView.as_view(), name='admin-console-summary'),
    path('api/my-favorites/', MyFavoriteListingsView.as_view(), name='my-favorites'),
    path('api/listings/<uuid:listing_id>/toggle-favorite/', ToggleFavoriteListingView.as_view(), name='toggle-favorite'),
    path('api/my-comparison/', MyComparisonView.as_view(), name='my-comparison'),
    path('api/my-creator-premium/', MyCreatorPremiumView.as_view(), name='my-creator-premium'),
    path('api/wallet/', MyWalletView.as_view(), name='my-wallet'),
    path('api/wallet/withdraw/', WithdrawWalletView.as_view(), name='wallet-withdraw'),
    path('api/wallet/recharge/', RechargeWalletView.as_view(), name='wallet-recharge'),
    path('api/gifts/send/', SendGiftView.as_view(), name='gift-send'),
    path('api/gifts/mine/', MyGiftsView.as_view(), name='gift-mine'),
    path('api/gifts/convert/', ConvertGiftsView.as_view(), name='gift-convert'),
    path('api/ad-campaigns/quote/', BoostPriceQuoteView.as_view(), name='ad-campaign-quote'),
    path('api/ad-campaigns/purchase/', PurchaseCampaignBoostView.as_view(), name='ad-campaign-purchase'),
    path('api/my-ad-campaigns/', MyAdCampaignsView.as_view(), name='my-ad-campaigns'),
    path('api/media/upload/', MediaUploadView.as_view(), name='media-upload'),
    path('api/valuations/', PropertyValuationView.as_view(), name='property-valuation'),
    path('api/affordability/', AffordabilityEstimateView.as_view(), name='affordability-estimate'),
    path('api/my-earnings-report/', MyEarningsReportView.as_view(), name='my-earnings-report'),
    path('api/currency-conversion/', CurrencyConversionView.as_view(), name='currency-conversion'),
    path('api/partner-services/request/', RequestPartnerServiceView.as_view(), name='partner-service-request'),
    path('api/my-partner-service-requests/', MyPartnerServiceRequestsView.as_view(), name='my-partner-service-requests'),
    path('api/bookings/<uuid:booking_id>/open-dispute/', OpenDisputeView.as_view(), name='open-dispute'),
    path('api/disputes/<uuid:dispute_id>/messages/', DisputeMessagesView.as_view(), name='dispute-messages'),
    path('api/technicians/', TechnicianDirectoryView.as_view(), name='technician-directory'),
    path('api/technicians/find/', FindTechniciansView.as_view(), name='find-technicians'),
    path('api/my-technician-dashboard/', MyTechnicianDashboardView.as_view(), name='my-technician-dashboard'),
    path('api/my-technician-profile/', MyTechnicianProfileView.as_view(), name='my-technician-profile'),
    path('api/my-technician-documents/', MyTechnicianDocumentsView.as_view(), name='my-technician-documents'),
    path('api/my-technician-location/', MyTechnicianLocationPingView.as_view(), name='my-technician-location'),
    path('api/my-technician-availability/', MyTechnicianAvailabilityView.as_view(), name='my-technician-availability'),
    path('api/my-listings/', MyListingsView.as_view(), name='my-listings'),
    path('api/my-landlord-portfolio/', MyLandlordPortfolioView.as_view(), name='my-landlord-portfolio'),
    path('api/listing-conditions/', ListingConditionView.as_view(), name='listing-conditions'),
    path('api/ratings/', RateUserView.as_view(), name='rate-user'),
    path('api/users/<uuid:user_id>/follow/', FollowView.as_view(), name='user-follow'),
    path('api/users/<uuid:user_id>/block/', BlockUserView.as_view(), name='user-block'),
    path('api/my-blocked-users/', MyBlockedUsersView.as_view(), name='my-blocked-users'),
    path('api/my-badges/', MyBadgesView.as_view(), name='my-badges'),
    path('api/support-tickets/', MySupportTicketsView.as_view(), name='my-support-tickets'),
    path('api/support-tickets/<uuid:ticket_id>/', SupportTicketDetailView.as_view(), name='support-ticket-detail'),
    path('api/chatbot/ask/', AnonymousChatbotView.as_view(), name='chatbot-ask'),
    path('api/home-stats/', HomeStatsView.as_view(), name='home-stats'),
    path('api/listings/<uuid:listing_id>/join-waitlist/', ListingWaitlistView.as_view(), name='listing-join-waitlist'),
    path('api/my-hostel-waitlist/', MyHostelWaitlistView.as_view(), name='my-hostel-waitlist'),
    path('api/my-parent-access-grants/', MyParentAccessGrantsView.as_view(), name='my-parent-access-grants'),
    path('api/my-guardian-accesses/', MyGuardianAccessesView.as_view(), name='my-guardian-accesses'),
    path('api/parent-portal/<uuid:student_id>/', ParentPortalView.as_view(), name='parent-portal'),
    path('api/my-ratings/', MyRatingsView.as_view(), name='my-ratings'),
    path('api/my-referrals/', MyReferralsView.as_view(), name='my-referrals'),
    path('api/my-driver-profile/', MyDriverProfileView.as_view(), name='my-driver-profile'),
    path('api/my-driver-profile/location/', MyDriverLocationView.as_view(), name='my-driver-location'),
    path('api/my-emergency-contact/', MyEmergencyContactView.as_view(), name='my-emergency-contact'),
    path('api/content-reports/', FileContentReportView.as_view(), name='file-content-report'),
    path('api/admin/greeting-settings/', AdminGreetingSettingsView.as_view(), name='admin-greeting-settings'),
    path('api/listing-share-message/', ListingShareMessageView.as_view(), name='listing-share-message'),

    # Payment provider webhook — a real, publicly-reachable endpoint,
    # not just service-layer logic with nowhere to actually be called from.
    path('api/webhooks/payment/', payment_webhook_view, name='payment-webhook'),

    # Model-backed API (Listing, Quarter, Booking — Prompt 16's core pass)
    path('api/', include(router.urls)),

    # Public User Role Index / Portfolio Hub
    path('api/users/<uuid:user_id>/index/', UserPublicIndexView.as_view(), name='user-public-index'),

    # Agent/agency profiles — public (anyone) and the private dashboard.
    path('api/agents/<uuid:user_id>/profile/', AgentPublicProfileView.as_view(), name='agent-public-profile'),
    path('api/agencies/<int:agency_id>/profile/', AgencyPublicProfileView.as_view(), name='agency-public-profile'),
    path('api/agents/', AgentDirectoryView.as_view(), name='agent-directory'),
    path('api/agencies/', AgencyDirectoryView.as_view(), name='agency-directory'),
    path('api/my-agent-dashboard/', MyAgentDashboardView.as_view(), name='my-agent-dashboard'),
    path('api/my-agency-dashboard/', MyAgencyDashboardView.as_view(), name='my-agency-dashboard'),
    path('api/my-agency-dashboard/add-agent/', AgencyAddAgentView.as_view(), name='agency-add-agent'),
    path('api/my-agency-dashboard/remove-agent/', AgencyRemoveAgentView.as_view(), name='agency-remove-agent'),
    path('api/testimonials/', TestimonialsView.as_view(), name='testimonials'),
    path('api/faqs/', PublicFaqListView.as_view(), name='faqs'),
    path('api/contact/', ContactMessageView.as_view(), name='contact'),

    # Interactive API documentation — the acceptance criteria's
    # explicit requirement: "open the Swagger documentation yourself."
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
