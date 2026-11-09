from rest_framework import serializers
from decimal import Decimal
from typing import Optional
from .models import (
    WarehouseListing, StoreListing, BusinessListing, CarListing, GoodsListing, VehicleSpec, MarketplaceMedia, RideBooking, RideMessage, ListingCondition,
    RideCategory, TransportType, Vehicle, DriverProfile, AvailabilityStatus, MarketplaceOrder, RideEmergencyContact, LuggageSize, CarBlockedPeriod,
)

MAX_LUGGAGE_PHOTOS = 3


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
    # Only present when the list was searched "near" a point; otherwise null.
    distance_km = serializers.SerializerMethodField()
    expires_at = serializers.SerializerMethodField()
    is_expired = serializers.SerializerMethodField()

    def get_expires_at(self, obj) -> str:
        from .engagement import expires_at
        return expires_at(obj).isoformat()

    def get_is_expired(self, obj) -> bool:
        from .engagement import is_expired
        return is_expired(obj)

    def get_distance_km(self, obj) -> Optional[float]:
        distance = getattr(obj, "distance_km", None)
        return None if distance is None else round(float(distance), 1)

    class Meta:
        fields = [
            "id", "lister_user", "lister_name", "lister_role", "title", "description",
            "price_basis", "price_xaf", "security_deposit_xaf", "quarter", "quarter_name", "latitude", "longitude",
            "availability_status", "removed_by_moderation", "created_at", "media", "distance_km", "expires_at", "is_expired",
        ]
        read_only_fields = ["lister_user", "lister_role", "availability_status", "removed_by_moderation", "created_at"]
        extra_kwargs = {
            "price_xaf": {"min_value": Decimal("0.01")},
            "security_deposit_xaf": {"min_value": Decimal("0")},
            "latitude": {"min_value": -90, "max_value": 90},
            "longitude": {"min_value": -180, "max_value": 180},
        }

    def validate(self, attrs):
        from .services import RENTAL_PRICE_BASES
        basis = attrs.get("price_basis", getattr(self.instance, "price_basis", None))
        deposit = attrs.get("security_deposit_xaf", getattr(self.instance, "security_deposit_xaf", Decimal("0")))
        if deposit and deposit > 0 and basis not in RENTAL_PRICE_BASES:
            raise serializers.ValidationError({"security_deposit_xaf": "A security deposit only applies to rentals."})
        return attrs


class WarehouseListingSerializer(BaseMarketplaceListingSerializer):
    class Meta(BaseMarketplaceListingSerializer.Meta):
        model = WarehouseListing
        fields = BaseMarketplaceListingSerializer.Meta.fields + ["size_sqm"]
        extra_kwargs = {
            **BaseMarketplaceListingSerializer.Meta.extra_kwargs,
            "size_sqm": {"min_value": Decimal("0.01")},
        }


class StoreListingSerializer(BaseMarketplaceListingSerializer):
    class Meta(BaseMarketplaceListingSerializer.Meta):
        model = StoreListing
        fields = BaseMarketplaceListingSerializer.Meta.fields + ["size_sqm", "frontage_meters"]
        extra_kwargs = {
            **BaseMarketplaceListingSerializer.Meta.extra_kwargs,
            "size_sqm": {"min_value": Decimal("0.01")},
            "frontage_meters": {"min_value": Decimal("0.01")},
        }


class BusinessListingSerializer(BaseMarketplaceListingSerializer):
    class Meta(BaseMarketplaceListingSerializer.Meta):
        model = BusinessListing
        fields = BaseMarketplaceListingSerializer.Meta.fields + [
            "size_sqm", "seating_capacity", "includes_goodwill", "includes_inventory", "annual_revenue_xaf",
        ]
        extra_kwargs = {
            **BaseMarketplaceListingSerializer.Meta.extra_kwargs,
            "size_sqm": {"min_value": Decimal("0.01")},
            "annual_revenue_xaf": {"min_value": Decimal("0")},
        }


class VehicleSpecSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleSpec
        fields = [
            "make", "model", "year", "mileage_km", "engine_size_cc", "trim", "body_type", "fuel_type", "transmission",
            "drivetrain", "exterior_color", "interior_color", "doors", "seats", "vehicle_condition", "customs_cleared",
            "registration_in_seller_name", "previous_owners", "accident_free", "service_history", "features", "vin",
        ]
        extra_kwargs = {
            "year": {"min_value": 1886},
            "engine_size_cc": {"min_value": 1, "max_value": 20000},
            "mileage_km": {"max_value": 3_000_000},
            "doors": {"min_value": 1, "max_value": 6},
            "seats": {"min_value": 1, "max_value": 80},
            "previous_owners": {"min_value": 0, "max_value": 30},
        }

    def validate_year(self, value):
        from django.utils import timezone
        if value > timezone.localdate().year + 1:
            raise serializers.ValidationError("Enter a real model year.")
        return value

    def validate_features(self, value):
        from .models import CAR_FEATURES
        if not isinstance(value, list) or any(item not in CAR_FEATURES for item in value):
            raise serializers.ValidationError(f"Choose features from: {', '.join(CAR_FEATURES)}.")
        return list(dict.fromkeys(value))

    def validate_vin(self, value):
        import re
        value = value.strip().upper()
        # Imported Japanese cars carry short chassis numbers (e.g. GRX130-6012345) rather than 17-character VINs.
        if value and not re.fullmatch(r"[A-Z0-9-]{6,17}", value):
            raise serializers.ValidationError("Enter the chassis number: 6 to 17 letters, digits or dashes.")
        return value

    def to_representation(self, instance):
        from .car_rentals import mask_vin
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        is_lister = bool(user and user.is_authenticated and instance.car_listing.lister_user_id == user.id)
        data["vin_last6"] = mask_vin(instance.vin)
        if not is_lister:
            data["vin"] = ""
        return data


class CarListingSerializer(BaseMarketplaceListingSerializer):
    vehicle_spec = VehicleSpecSerializer()

    RENTAL_FIELDS = [
        "driver_option", "driver_fee_per_day_xaf", "weekly_discount_pct", "monthly_discount_pct", "min_rental_days",
        "max_rental_days", "daily_km_limit", "extra_km_fee_xaf", "fuel_policy", "min_driver_age", "min_licence_years",
        "insurance_included", "delivery_available", "delivery_fee_xaf", "out_of_town_allowed", "instant_book",
    ]

    class Meta(BaseMarketplaceListingSerializer.Meta):
        model = CarListing
        fields = BaseMarketplaceListingSerializer.Meta.fields + [
            "vehicle_spec", "price_negotiable", "driver_option", "driver_fee_per_day_xaf", "weekly_discount_pct",
            "monthly_discount_pct", "min_rental_days", "max_rental_days", "daily_km_limit", "extra_km_fee_xaf",
            "fuel_policy", "min_driver_age", "min_licence_years", "insurance_included", "delivery_available",
            "delivery_fee_xaf", "out_of_town_allowed", "instant_book",
        ]
        extra_kwargs = {
            **BaseMarketplaceListingSerializer.Meta.extra_kwargs,
            "driver_fee_per_day_xaf": {"min_value": Decimal("0")},
            "weekly_discount_pct": {"min_value": 0, "max_value": 60},
            "monthly_discount_pct": {"min_value": 0, "max_value": 75},
            "min_rental_days": {"min_value": 1, "max_value": 365},
            "max_rental_days": {"min_value": 1, "max_value": 365},
            "daily_km_limit": {"min_value": 10, "max_value": 5000},
            "extra_km_fee_xaf": {"min_value": Decimal("0")},
            "min_driver_age": {"min_value": 18, "max_value": 75},
            "min_licence_years": {"min_value": 0, "max_value": 40},
            "delivery_fee_xaf": {"min_value": Decimal("0")},
        }

    def validate(self, attrs):
        from .car_rentals import DAILY_BASIS
        from .models import DriverOption
        attrs = super().validate(attrs)

        def current(field, default=None):
            return attrs.get(field, getattr(self.instance, field, default))

        basis = current("price_basis")
        if basis not in ("SALE", DAILY_BASIS):
            raise serializers.ValidationError({"price_basis": "A car is either for sale or for rent by the day."})
        if basis == "SALE":
            # Rental terms mean nothing on a sale, so a car switched to a sale drops them.
            for field in self.RENTAL_FIELDS:
                attrs.pop(field, None)
            return attrs
        attrs["price_negotiable"] = False
        low, high = current("min_rental_days", 1), current("max_rental_days")
        if high is not None and high < low:
            raise serializers.ValidationError({"max_rental_days": "The longest rental can't be shorter than the shortest."})
        if current("driver_option", DriverOption.SELF_DRIVE) == DriverOption.SELF_DRIVE and current("driver_fee_per_day_xaf", 0):
            attrs["driver_fee_per_day_xaf"] = Decimal("0")
        if not current("delivery_available", False) and current("delivery_fee_xaf", 0):
            attrs["delivery_fee_xaf"] = Decimal("0")
        if current("daily_km_limit") is None and current("extra_km_fee_xaf") is not None:
            attrs["extra_km_fee_xaf"] = None
        return attrs

    def create(self, validated_data):
        vehicle_spec_data = validated_data.pop("vehicle_spec")
        car_listing = CarListing.objects.create(**validated_data)
        VehicleSpec.objects.create(car_listing=car_listing, **vehicle_spec_data)
        return car_listing

    def update(self, instance, validated_data):
        # Nested writes are not automatic in DRF, so the vehicle details are applied by hand.
        vehicle_spec_data = validated_data.pop("vehicle_spec", None)
        instance = super().update(instance, validated_data)
        if vehicle_spec_data:
            for field, value in vehicle_spec_data.items():
                setattr(instance.vehicle_spec, field, value)
            instance.vehicle_spec.save()
        return instance


class CarBlockedPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model = CarBlockedPeriod
        fields = ["id", "starts_on", "ends_on", "note", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        from datetime import timedelta
        from django.utils import timezone
        if attrs["ends_on"] <= attrs["starts_on"]:
            raise serializers.ValidationError({"ends_on": "The last day must come after the first day."})
        if attrs["ends_on"] <= timezone.localdate():
            raise serializers.ValidationError({"ends_on": "That period is already over."})
        if attrs["ends_on"] - attrs["starts_on"] > timedelta(days=366):
            raise serializers.ValidationError({"ends_on": "Block at most a year at a time."})
        return attrs


class CarRentalQuoteSerializer(serializers.Serializer):
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    with_driver = serializers.BooleanField(required=False, default=False)
    delivery = serializers.BooleanField(required=False, default=False)


class GoodsListingSerializer(BaseMarketplaceListingSerializer):
    class Meta(BaseMarketplaceListingSerializer.Meta):
        model = GoodsListing
        fields = BaseMarketplaceListingSerializer.Meta.fields + ["item_category", "condition", "quantity"]
        extra_kwargs = {
            **BaseMarketplaceListingSerializer.Meta.extra_kwargs,
            "price_basis": {"required": False, "default": "SALE"},
            "quantity": {"min_value": 1, "max_value": 100000},
        }

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.get("price_basis", "SALE") != "SALE":
            raise serializers.ValidationError({"price_basis": "Goods can only be listed for sale."})
        return attrs


class AddMediaSerializer(serializers.Serializer):
    url = serializers.URLField(max_length=200)
    media_type = serializers.ChoiceField(choices=MarketplaceMedia.MediaType.choices, default=MarketplaceMedia.MediaType.PHOTO)


class SetAvailabilitySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=AvailabilityStatus.choices)


class RideVehicleSerializer(serializers.ModelSerializer):
    """What a rider needs to recognise the car or moto that turns up."""
    class Meta:
        model = Vehicle
        fields = ["vehicle_category", "make", "model", "plate_number"]


class RideBookingSerializer(serializers.ModelSerializer):
    rider_name = serializers.CharField(source="rider.full_name", read_only=True)
    driver_name = serializers.CharField(source="driver.full_name", read_only=True, default=None)
    vehicle_details = RideVehicleSerializer(source="vehicle", read_only=True)
    distance_km = serializers.SerializerMethodField()

    class Meta:
        model = RideBooking
        fields = [
            "id", "rider", "rider_name", "driver", "driver_name", "vehicle", "vehicle_details",
            "pickup_description", "pickup_latitude", "pickup_longitude",
            "dropoff_description", "dropoff_latitude", "dropoff_longitude",
            "fare_estimate_xaf", "distance_km", "status", "ride_category", "transport_type", "has_luggage",
            "luggage_count", "luggage_size", "luggage_photo_urls", "cargo_description",
            "requested_at", "completed_at", "sos_raised_at",
        ]
        read_only_fields = ["rider", "driver", "vehicle", "fare_estimate_xaf", "distance_km", "status", "requested_at", "completed_at", "sos_raised_at"]

    def get_distance_km(self, obj) -> str:
        if obj.distance_km is not None:
            return str(obj.distance_km)
        from .services import infer_ride_distance_km
        return str(infer_ride_distance_km(
            fare_estimate_xaf=obj.fare_estimate_xaf,
            ride_category=obj.ride_category,
            pickup_coords=(obj.pickup_latitude, obj.pickup_longitude),
            dropoff_coords=(obj.dropoff_latitude, obj.dropoff_longitude),
        ))


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
    luggage_count = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=20)
    luggage_size = serializers.ChoiceField(choices=LuggageSize.choices, required=False, allow_blank=True, default="")
    luggage_photo_urls = serializers.ListField(
        child=serializers.URLField(max_length=500), required=False, default=list, max_length=MAX_LUGGAGE_PHOTOS,
    )
    cargo_description = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, data):
        if data["transport_type"] == TransportType.CARGO and not data.get("cargo_description"):
            raise serializers.ValidationError({"cargo_description": "Please describe what's being moved for a cargo request."})
        if not data["has_luggage"]:
            # Luggage details only mean something when there is luggage.
            data["luggage_count"], data["luggage_size"], data["luggage_photo_urls"] = None, "", []
        else:
            from uploads.services import is_platform_media_url
            if any(not is_platform_media_url(url) for url in data.get("luggage_photo_urls", [])):
                raise serializers.ValidationError({"luggage_photo_urls": "Upload the luggage photos through Oaziland."})
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
        fields = ["id", "user_name", "license_number", "is_verified", "is_online", "last_seen_at", "vehicles", "created_at"]
        read_only_fields = ["is_verified", "is_online", "last_seen_at", "created_at"]


class DriverLocationSerializer(serializers.Serializer):
    """A driver's position update and/or going online/offline."""
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, min_value=-90, max_value=90)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, min_value=-180, max_value=180)
    is_online = serializers.BooleanField(required=False)

    def validate(self, data):
        if ("latitude" in data) != ("longitude" in data):
            raise serializers.ValidationError("Send latitude and longitude together.")
        if not data:
            raise serializers.ValidationError("Send a position or an online state.")
        return data


class EmergencyContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = RideEmergencyContact
        fields = ["name", "phone"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter the contact's name.")
        return value

    def validate_phone(self, value):
        value = value.strip()
        digits = [c for c in value if c.isdigit()]
        if not (8 <= len(digits) <= 15) or any(c not in "+0123456789 -" for c in value):
            raise serializers.ValidationError("Enter a valid phone number, for example +237 6XX XXX XXX.")
        return value


def _person(user) -> Optional[dict]:
    if user is None:
        return None
    return {"id": str(user.id), "name": user.full_name or user.username, "phone": user.phone}


class AdminSosRideSerializer(serializers.ModelSerializer):
    """What an admin needs to act on an SOS: who raised it, where, the people and the car involved, and who to call."""
    raised_by = serializers.SerializerMethodField()
    raised_by_contact = serializers.SerializerMethodField()
    rider = serializers.SerializerMethodField()
    driver = serializers.SerializerMethodField()
    vehicle_details = RideVehicleSerializer(source="vehicle", read_only=True)

    class Meta:
        model = RideBooking
        fields = [
            "id", "status", "pickup_description", "dropoff_description", "vehicle_details", "rider", "driver",
            "raised_by", "raised_by_contact", "sos_raised_at", "sos_latitude", "sos_longitude", "sos_note", "sos_resolved_at",
        ]
        read_only_fields = fields

    def get_raised_by(self, ride) -> Optional[dict]:
        return _person(ride.sos_raised_by)

    def get_raised_by_contact(self, ride) -> Optional[dict]:
        contact = getattr(ride.sos_raised_by, "ride_emergency_contact", None) if ride.sos_raised_by else None
        return {"name": contact.name, "phone": contact.phone} if contact else None

    def get_rider(self, ride) -> Optional[dict]:
        return _person(ride.rider)

    def get_driver(self, ride) -> Optional[dict]:
        return _person(ride.driver)


class EmergencyContactStatusSerializer(EmergencyContactSerializer):
    """The contact plus whether texting really works on this server, so the app can warn the user while they set it up."""
    sms_delivery_live = serializers.BooleanField(read_only=True)

    class Meta(EmergencyContactSerializer.Meta):
        fields = ["name", "phone", "sms_delivery_live"]


class RideSosSerializer(serializers.Serializer):
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True, min_value=-180, max_value=180)
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)


class CompleteRideSerializer(serializers.Serializer):
    phone_number = serializers.CharField()


class ListingConditionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingCondition
        fields = ["id", "target_content_type", "target_id", "structured_conditions", "free_text_clause", "created_at"]
        read_only_fields = ["id", "created_at"]


CONDITION_TARGETS = [
    "property.Listing", "marketplace.WarehouseListing", "marketplace.StoreListing",
    "marketplace.BusinessListing", "marketplace.CarListing", "marketplace.GoodsListing",
]
CONDITION_BOOLEANS = ("deposit_required", "driver_required", "insurance_required", "viewing_appointment_only", "no_subletting")
CONDITION_INTEGER_LIMITS = {"min_lease_months": (1, 120), "mileage_cap_km": (0, 1_000_000)}
CONDITION_TEXT_LIMITS = {"pet_policy": 50}
MAX_CONDITION_CLAUSE_LENGTH = 2000


def validate_structured_conditions(value):
    """Only the documented condition keys, each with the right type, so filters and detail pages can trust them."""
    if not isinstance(value, dict):
        raise serializers.ValidationError("Conditions must be an object.")
    cleaned = {}
    for key, item in value.items():
        if key in CONDITION_BOOLEANS:
            if not isinstance(item, bool):
                raise serializers.ValidationError({key: "Must be true or false."})
        elif key in CONDITION_INTEGER_LIMITS:
            low, high = CONDITION_INTEGER_LIMITS[key]
            if isinstance(item, bool) or not isinstance(item, int) or not low <= item <= high:
                raise serializers.ValidationError({key: f"Enter a whole number from {low} to {high}."})
        elif key in CONDITION_TEXT_LIMITS:
            if not isinstance(item, str) or not item.strip() or len(item) > CONDITION_TEXT_LIMITS[key]:
                raise serializers.ValidationError({key: f"Enter up to {CONDITION_TEXT_LIMITS[key]} characters."})
            item = item.strip()
        else:
            raise serializers.ValidationError({key: "This condition is not supported."})
        cleaned[key] = item
    return cleaned


class AttachConditionSerializer(serializers.Serializer):
    """Write-only input — target_content_type/target_id identify
    WHICH listing this sets conditions on (property.Listing or one of
    the marketplace categories), structured_conditions is a validated dict
    (min_lease_months, deposit_required, pet_policy, etc.), free_text_clause
    covers anything the fixed keys don't."""
    target_content_type = serializers.ChoiceField(choices=CONDITION_TARGETS)
    target_id = serializers.UUIDField()
    structured_conditions = serializers.JSONField(required=False, default=dict)
    free_text_clause = serializers.CharField(required=False, allow_blank=True, default="", max_length=MAX_CONDITION_CLAUSE_LENGTH)

    def validate_structured_conditions(self, value):
        return validate_structured_conditions(value)


class PlaceOrderSerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=["warehouses", "stores", "businesses", "cars", "goods"])
    listing_id = serializers.UUIDField()
    phone_number = serializers.CharField()
    # A car rented by the day: the days chosen and the extras.
    start_date = serializers.DateField(required=False)
    end_date = serializers.DateField(required=False)
    with_driver = serializers.BooleanField(required=False, default=False)
    delivery = serializers.BooleanField(required=False, default=False)


class OrderDisputeSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=5, max_length=2000)


class MarketplaceOrderSerializer(serializers.ModelSerializer):
    listing_id = serializers.UUIDField(source="listing.id", read_only=True)
    listing_title = serializers.CharField(source="listing.title", read_only=True)
    category = serializers.SerializerMethodField()
    buyer_name = serializers.SerializerMethodField()
    seller = serializers.UUIDField(source="listing.lister_user_id", read_only=True)
    seller_name = serializers.SerializerMethodField()
    auto_release_at = serializers.SerializerMethodField()
    seller_deadline = serializers.SerializerMethodField()
    total_xaf = serializers.SerializerMethodField()
    deposit_return_by = serializers.SerializerMethodField()
    free_cancellation_until = serializers.SerializerMethodField()
    approval_deadline = serializers.SerializerMethodField()

    class Meta:
        model = MarketplaceOrder
        fields = [
            "id", "listing_id", "listing_title", "category", "buyer", "buyer_name", "seller", "seller_name", "amount_xaf",
            "status", "handed_over_at", "completed_at", "created_at", "auto_release_at", "seller_deadline",
            "deposit_xaf", "deposit_status", "deposit_settled_at", "deposit_return_by", "total_xaf",
            "rental_starts_on", "rental_ends_on", "booked_dates", "rental_days", "with_driver", "delivery_requested",
            "price_breakdown", "free_cancellation_until", "needs_approval", "owner_approved_at", "approval_deadline",
        ]
        read_only_fields = fields

    # People who never filled in a name are shown by username instead of as a blank.
    def get_buyer_name(self, obj) -> str:
        return obj.buyer.full_name or obj.buyer.username

    def get_seller_name(self, obj) -> str:
        seller = obj.listing.lister_user
        return seller.full_name or seller.username

    def get_total_xaf(self, obj) -> str:
        # What the buyer is charged: the price plus any rental deposit.
        return str(obj.amount_xaf + obj.deposit_xaf)

    def get_deposit_return_by(self, obj) -> str:
        # The day the deposit goes back to the renter on its own if the seller has not claimed it.
        from datetime import timedelta
        from .services import DEPOSIT_RETURN_GRACE_DAYS
        if obj.deposit_status != "HELD" or obj.rental_ends_on is None:
            return None
        return (obj.rental_ends_on + timedelta(days=DEPOSIT_RETURN_GRACE_DAYS)).isoformat()

    def get_category(self, obj) -> str:
        for name, relation in (
            ("warehouses", "warehouselisting"),
            ("stores", "storelisting"),
            ("businesses", "businesslisting"),
            ("cars", "carlisting"),
            ("goods", "goodslisting"),
        ):
            if getattr(obj.listing, relation, None) is not None:
                return name
        return ""

    def get_auto_release_at(self, obj) -> str:
        # When the payment is released if the buyer stays silent after the handover.
        from datetime import timedelta
        from .services import ORDER_AUTO_RELEASE_HOURS
        if obj.status != "HANDED_OVER" or obj.handed_over_at is None:
            return None
        return (obj.handed_over_at + timedelta(hours=ORDER_AUTO_RELEASE_HOURS)).isoformat()

    def get_approval_deadline(self, obj) -> str:
        # When an unanswered booking request expires and the renter is refunded.
        from .car_rentals import approval_deadline, awaiting_approval
        if obj.status != "PAID" or not awaiting_approval(obj):
            return None
        return approval_deadline(obj).isoformat()

    def get_free_cancellation_until(self, obj) -> str:
        # A car booked for dates can be cancelled for free until this moment.
        from .car_rentals import free_cancellation_until
        moment = free_cancellation_until(obj) if obj.status == "PAID" else None
        return moment.isoformat() if moment else None

    def get_seller_deadline(self, obj) -> str:
        # When the buyer is refunded automatically if the seller never hands over.
        from datetime import timedelta
        from .services import ORDER_SELLER_RESPONSE_DAYS
        if obj.status != "PAID":
            return None
        if obj.booked_dates:
            from .car_rentals import handover_deadline
            return handover_deadline(obj).isoformat()
        return (obj.created_at + timedelta(days=ORDER_SELLER_RESPONSE_DAYS)).isoformat()
