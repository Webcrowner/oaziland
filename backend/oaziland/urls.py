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

from identity.views import RegisterView, MyProfileView
from geo.views import QuarterViewSet
from property.views import ListingViewSet
from transactions.views import BookingViewSet
from social.views import SocialAccountLinkViewSet
from compliance.views import ConsentRecordViewSet, DataExportRequestViewSet, PolicyDocumentViewSet

router = DefaultRouter()
router.register(r"quarters", QuarterViewSet, basename="quarter")
router.register(r"listings", ListingViewSet, basename="listing")
router.register(r"bookings", BookingViewSet, basename="booking")
router.register(r"social-accounts", SocialAccountLinkViewSet, basename="social-account")
router.register(r"consent", ConsentRecordViewSet, basename="consent")
router.register(r"data-exports", DataExportRequestViewSet, basename="data-export")
router.register(r"policy-documents", PolicyDocumentViewSet, basename="policy-document")

urlpatterns = [
    path('admin/', admin.site.urls),

    # Authentication
    path('api/auth/register/', RegisterView.as_view(), name='register'),
    path('api/auth/login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/login/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/me/', MyProfileView.as_view(), name='my_profile'),

    # Model-backed API (Listing, Quarter, Booking — Prompt 16's core pass)
    path('api/', include(router.urls)),

    # Interactive API documentation — the acceptance criteria's
    # explicit requirement: "open the Swagger documentation yourself."
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
