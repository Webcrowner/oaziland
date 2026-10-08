from rest_framework import serializers
from .models import (
    WarehouseListing, StoreListing, BusinessListing, CarListing, VehicleSpec, MarketplaceMedia, RideBooking, RideMessage, ListingCondition,
    RideCategory, TransportType, Vehicle, DriverProfile,
)


class MarketplaceMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarketplaceMedia
        fields = ["id", "media_type", "file_url", "order"]


class BaseMarketplaceListingSerializer(serializers.ModelSerializer):
    """The shared fields every category serializer extends — mirrors
    MarketplaceListingBase itself, the same multi-table-inheritance
    shape the models already use."""
    lister_name = serializers.CharField(source="lister_user.full_name", read_only=True)
    quarter_name = serializers.CharField(source="quarter.name", read_only=True, default=None)
    media = MarketplaceMediaSerializer(many=True, read_only=True)

    class Meta:
        fields = [
            "id", "lister_user", "lister_name", "lister_role", "title", "description",
            "price_basis", "price_xaf", "quarter", "quarter_name", "latitude", "longitude",
            "availability_status", "created_at", "media",
        ]
        read_only_fields = ["lister_user", "lister_role", "availability_status", "created_at"]
        extra_kwargs = {"latitude": {"min_value": -90, "max_value": 90}, "longitude": {"min_value": -180, "max_value": 180}}


class WarehouseListingSerializer(BaseMarketplaceListingSerializer):
    class Meta(BaseMarketplaceListingSerializer.Meta):
        model = WarehouseListing
        fields = BaseMarketplaceListingSerializer.Meta.fields + ["size_sqm"]


class StoreListingSerializer(BaseMarketplaceListingSerializer):
    class Meta(BaseMarketplaceListingSerializer.Meta):
        model = StoreListing
        fields = BaseMarketplaceListingSerializer.Meta.fields + ["size_sqm", "frontage_meters"]


class BusinessListingSerializer(BaseMarketplaceListingSerializer):
    class Meta(BaseMarketplaceListingSerializer.Meta):
        model = BusinessListing
        fields = BaseMarketplaceListingSerializer.Meta.fields + [
            "size_sqm", "seating_capacity", "includes_goodwill", "includes_inventory", "annual_revenue_xaf",
        ]


class VehicleSpecSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleSpec
        fields = ["make", "model", "year", "mileage_km", "engine_size_cc"]


class CarListingSerializer(BaseMarketplaceListingSerializer):
    vehicle_spec = VehicleSpecSerializer()

    class Meta(BaseMarketplaceListingSerializer.Meta):
        model = CarListing
        fields = BaseMarketplaceListingSerializer.Meta.fields + ["vehicle_spec"]

    def create(self, validated_data):
        vehicle_spec_data = validated_data.pop("vehicle_spec")
        car_listing = CarListing.objects.create(**validated_data)
        VehicleSpec.objects.create(car_listing=car_listing, **vehicle_spec_data)
        return car_listing


class RideBookingSerializer(serializers.ModelSerializer):
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)
    driver_name = serializers.CharField(source="driver.full_name", read_only=True, default=None)

    class Meta:
        model = RideBooking
        fields = [
            "id", "rider", "rider_name", "driver", "driver_name", "vehicle",
            "pickup_description", "pickup_latitude", "pickup_longitude",
            "dropoff_description", "dropoff_latitude", "dropoff_longitude",
            "fare_estimate_xaf", "status", "ride_category", "transport_type", "has_luggage", "cargo_description",
            "requested_at", "completed_at",
        ]
        read_only_fields = ["rider", "driver", "vehicle", "fare_estimate_xaf", "status", "requested_at", "completed_at"]


class RideRequestSerializer(serializers.Serializer):
    """Write-only input — fare_estimate_xaf is CALCULATED server-side
    from distance and ride_category via estimate_ride_fare(), never
    trusted from the client (a real person could otherwise just claim
    any fare). cargo_description is only meaningful when
    transport_type is CARGO — validated together below."""
    pickup_description = serializers.CharField()
    dropoff_description = serializers.CharField()
    distance_km = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=0)
    pickup_latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    pickup_longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    dropoff_latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    dropoff_longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    ride_category = serializers.ChoiceField(choices=RideCategory.choices, default=RideCategory.STANDARD)
    transport_type = serializers.ChoiceField(choices=TransportType.choices, default=TransportType.PASSENGER)
    has_luggage = serializers.BooleanField(default=False)
    cargo_description = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, data):
        if data["transport_type"] == TransportType.CARGO and not data.get("cargo_description"):
            raise serializers.ValidationError({"cargo_description": "Please describe what's being moved for a cargo request."})
        return data


class DriverRegistrationSerializer(serializers.Serializer):
    """Write-only input for the real gap this closes: previously any
    signed-in user could accept a ride with zero registration."""
    license_number = serializers.CharField()


class RideMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.full_name", read_only=True)

    class Meta:
        model = RideMessage
        fields = ["id", "ride", "sender", "sender_name", "text", "created_at"]
        read_only_fields = ["ride", "sender", "created_at"]


class VehicleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicle
        fields = ["id", "vehicle_category", "make", "model", "plate_number", "created_at"]
        read_only_fields = ["created_at"]


class DriverProfileSerializer(serializers.ModelSerializer):
    # The admin driver-verification queue needs to know WHO it's
    # reviewing and with WHAT vehicles, not just an opaque profile id.
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    vehicles = VehicleSerializer(many=True, read_only=True)

    class Meta:
        model = DriverProfile
        fields = ["id", "user_name", "license_number", "is_verified", "vehicles", "created_at"]
        read_only_fields = ["is_verified", "created_at"]


class CompleteRideSerializer(serializers.Serializer):
    phone_number = serializers.CharField()


class ListingConditionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingCondition
        fields = ["id", "target_content_type", "target_id", "structured_conditions", "free_text_clause", "created_at"]
        read_only_fields = ["id", "created_at"]


class AttachConditionSerializer(serializers.Serializer):
    """Write-only input — target_content_type/target_id identify
    WHICH listing this attaches to (property.Listing or any
    marketplace subclass, per the model's own generic design),
    structured_conditions is a real dict (min_lease_months,
    deposit_required, pet_policy, etc.), free_text_clause covers
    anything the fixed keys don't."""
    target_content_type = serializers.CharField()
    target_id = serializers.UUIDField()
    structured_conditions = serializers.JSONField(required=False, default=dict)
    free_text_clause = serializers.CharField(required=False, allow_blank=True, default="")
