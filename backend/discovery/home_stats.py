"""Public aggregate counts for the home page, computed from live data only."""
from datetime import timedelta

from django.db.models import Count, Max, Min, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, views
from rest_framework.response import Response

from events.models import Venue
from hotels.models import Hotel
from marketplace.models import DriverProfile
from property.models import GuestHouseLodge, Listing, ListingStatus, ListingType
from student_hostels.models import StudentHostel


class PopularQuarterSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    area = serializers.CharField()
    listing_count = serializers.IntegerField()
    min_rent_xaf = serializers.DecimalField(max_digits=14, decimal_places=2, allow_null=True)
    max_rent_xaf = serializers.DecimalField(max_digits=14, decimal_places=2, allow_null=True)


class HomeStatsSerializer(serializers.Serializer):
    published_listings = serializers.IntegerField()
    rent_listings = serializers.IntegerField()
    sale_listings = serializers.IntegerField()
    new_listings_24h = serializers.IntegerField()
    hotels = serializers.IntegerField()
    venues = serializers.IntegerField()
    guest_houses = serializers.IntegerField()
    student_hostels = serializers.IntegerField()
    drivers = serializers.IntegerField()
    popular_quarters = PopularQuarterSerializer(many=True)


class HomeStatsView(views.APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: HomeStatsSerializer})
    def get(self, request):
        published = Listing.objects.filter(status=ListingStatus.PUBLISHED)
        day_ago = timezone.now() - timedelta(days=1)

        quarter_rows = (
            published
            .values(
                "property_asset__quarter", "property_asset__quarter__name",
                "property_asset__quarter__village_or_district__name",
            )
            .annotate(
                listing_count=Count("id"),
                min_rent=Min("price_xaf", filter=Q(listing_type=ListingType.RENT)),
                max_rent=Max("price_xaf", filter=Q(listing_type=ListingType.RENT)),
            )
            .order_by("-listing_count", "property_asset__quarter__name")[:8]
        )

        return Response({
            "published_listings": published.count(),
            "rent_listings": published.filter(listing_type=ListingType.RENT).count(),
            "sale_listings": published.filter(listing_type=ListingType.SALE).count(),
            "new_listings_24h": published.filter(published_at__gte=day_ago).count(),
            "hotels": Hotel.objects.filter(verified=True).count(),
            "venues": Venue.objects.filter(verified=True).count(),
            "guest_houses": GuestHouseLodge.objects.count(),
            "student_hostels": StudentHostel.objects.count(),
            "drivers": DriverProfile.objects.filter(is_verified=True).count(),
            "popular_quarters": [
                {
                    "id": str(row["property_asset__quarter"]),
                    "name": row["property_asset__quarter__name"],
                    "area": row["property_asset__quarter__village_or_district__name"],
                    "listing_count": row["listing_count"],
                    "min_rent_xaf": row["min_rent"],
                    "max_rent_xaf": row["max_rent"],
                }
                for row in quarter_rows
            ],
        })
