"""Cart, coupon and shop storefront endpoints (see cart.py, promotions.py, shops.py)."""
import logging

from django.core.exceptions import ValidationError
from django.http import Http404
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from oaziland.permissions import IsKycVerified
from . import cart as cart_service
from . import promotions, shops
from .models import GoodsListing, MarketplaceCoupon, ShopProfile
from .services import OrderError, ListingNotAvailableError

logger = logging.getLogger(__name__)


class CartItemInputSerializer(serializers.Serializer):
    listing_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=1000, default=1)
    variant_id = serializers.UUIDField(required=False, allow_null=True)


class CartGroupInputSerializer(serializers.Serializer):
    seller_id = serializers.UUIDField()
    delivery_method = serializers.ChoiceField(choices=["PICKUP", "SELLER", "COURIER"], required=False, allow_blank=True, default="")
    delivery_address = serializers.CharField(required=False, allow_blank=True, max_length=300, default="")
    coupon_code = serializers.CharField(required=False, allow_blank=True, max_length=30, default="")


class CartCheckoutSerializer(CartGroupInputSerializer):
    phone_number = serializers.CharField()


class CouponCheckSerializer(serializers.Serializer):
    listing_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=1000, default=1)
    code = serializers.CharField(max_length=30)


def _order_error(e):
    status_code = status.HTTP_409_CONFLICT if isinstance(e, ListingNotAvailableError) else status.HTTP_400_BAD_REQUEST
    return Response({"detail": str(e)}, status=status_code)


class CartView(APIView):
    """The caller's cart, grouped by seller (one checkout and one payment per seller)."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(cart_service.cart_for(request.user))


class CartItemsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=CartItemInputSerializer, responses={200: dict, 400: dict, 404: dict, 409: dict})
    def post(self, request):
        """Adds a goods listing, or sets its quantity when it is already in the cart."""
        data = CartItemInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        listing = GoodsListing.objects.filter(pk=data.validated_data["listing_id"]).first()
        if listing is None:
            return Response({"detail": "That listing was not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            cart_service.set_item(
                user=request.user, listing=listing, quantity=data.validated_data["quantity"], variant_id=data.validated_data.get("variant_id"),
            )
        except OrderError as e:
            return _order_error(e)
        return Response(cart_service.cart_for(request.user))


class CartItemView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: dict})
    def delete(self, request, listing_id):
        """Removes the line; for an item with options pass ?variant_id= to remove that version."""
        variant_id = request.query_params.get("variant_id") or None
        try:
            cart_service.remove_item(user=request.user, listing_id=listing_id, variant_id=variant_id)
        except (ValueError, ValidationError):
            return Response({"detail": "Invalid option."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(cart_service.cart_for(request.user))


class CartQuoteView(APIView):
    """What checking out with one seller would charge, with a coupon applied if one is given."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=CartGroupInputSerializer, responses={200: dict, 400: dict, 409: dict})
    def post(self, request):
        data = CartGroupInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        try:
            return Response(cart_service.quote_group(
                buyer=request.user, seller_id=v["seller_id"], delivery={"method": v["delivery_method"], "address": v["delivery_address"]},
                coupon_code=v["coupon_code"],
            ))
        except OrderError as e:
            return _order_error(e)


class CartCheckoutView(APIView):
    """Pays for everything the caller has from one seller with one Mobile Money payment (202 until the provider confirms)."""
    permission_classes = [IsKycVerified]

    @extend_schema(request=CartCheckoutSerializer, responses={202: dict, 400: dict, 409: dict, 503: dict})
    def post(self, request):
        from payments.gateways import get_active_gateway
        from .serializers import MarketplaceOrderSerializer
        from .views import _infrastructure_errors
        data = CartCheckoutSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        try:
            orders = cart_service.place_cart_checkout(
                buyer=request.user, seller_id=v["seller_id"], payment_gateway=get_active_gateway(), phone_number=v["phone_number"],
                delivery={"method": v["delivery_method"], "address": v["delivery_address"]}, coupon_code=v["coupon_code"],
            )
        except OrderError as e:
            return _order_error(e)
        except (RuntimeError, NotImplementedError, ValueError, *_infrastructure_errors()):
            logger.exception("Marketplace payment infrastructure is unavailable.")
            return Response({"detail": "Payments are temporarily unavailable. Please try again later."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({
            "checkout_id": str(orders[0].checkout_id),
            "total_xaf": cart_service._xaf(sum(order.amount_xaf for order in orders)),
            "orders": MarketplaceOrderSerializer(orders, many=True, context={"request": request}).data,
        }, status=status.HTTP_202_ACCEPTED)


# ---------------------------------------------------------------------------
# Coupons
# ---------------------------------------------------------------------------
class CouponSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarketplaceCoupon
        fields = ["id", "code", "kind", "value", "min_order_xaf", "max_uses", "uses", "starts_at", "expires_at", "is_active", "created_at"]
        read_only_fields = ["id", "uses", "created_at"]

    def validate_code(self, value):
        code = promotions.normalize_code(value)
        if not 3 <= len(code) <= 30 or not code.replace("-", "").replace("_", "").isalnum():
            raise serializers.ValidationError("Use 3 to 30 letters, numbers, dashes or underscores.")
        taken = MarketplaceCoupon.objects.filter(seller=self.context["request"].user, code=code)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("You already have a coupon with this code.")
        return code

    def validate(self, attrs):
        def current(field, default=None):
            return attrs[field] if field in attrs else getattr(self.instance, field, default)

        kind, value = current("kind"), current("value")
        if value is not None and kind == "PERCENT" and not 1 <= value <= promotions.MAX_PERCENT:
            raise serializers.ValidationError({"value": f"A percentage must be between 1 and {promotions.MAX_PERCENT}."})
        if value is not None and kind == "FIXED" and value <= 0:
            raise serializers.ValidationError({"value": "Enter an amount above 0."})
        starts, ends = current("starts_at"), current("expires_at")
        if starts and ends and starts >= ends:
            raise serializers.ValidationError({"expires_at": "The coupon must expire after it starts."})
        return attrs


class CouponViewSet(viewsets.ModelViewSet):
    """The seller's own discount codes. Codes are the seller's to create, switch off and delete."""
    serializer_class = CouponSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return MarketplaceCoupon.objects.none()
        return MarketplaceCoupon.objects.filter(seller=self.request.user)

    def perform_create(self, serializer):
        serializer.save(seller=self.request.user)


class CouponCheckView(APIView):
    """Does this seller's code work for this item and quantity, and what does it take off?"""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=CouponCheckSerializer, responses={200: dict, 404: dict})
    def post(self, request):
        data = CouponCheckSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        listing = GoodsListing.objects.filter(pk=v["listing_id"]).first()
        if listing is None:
            return Response({"detail": "That listing was not found."}, status=status.HTTP_404_NOT_FOUND)
        subtotal = listing.current_price_xaf() * v["quantity"]
        try:
            coupon, discount = promotions.checked_coupon(seller_id=listing.lister_user_id, code=v["code"], buyer=request.user, subtotal=subtotal)
        except promotions.CouponError as e:
            return Response({"valid": False, "message": str(e), "discount_xaf": "0"})
        return Response({"valid": True, "message": "", "discount_xaf": str(discount), "code": coupon.code})


# ---------------------------------------------------------------------------
# Shop storefront
# ---------------------------------------------------------------------------
class ShopProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopProfile
        fields = [
            "name", "tagline", "description", "logo_url", "banner_url", "shipping_policy", "return_policy", "announcement",
            "on_vacation", "vacation_message", "vacation_until",
        ]


class ShopPublicView(APIView):
    """A seller's public shop page data: profile, policies, vacation state, followers and the seller trust summary."""
    permission_classes = [permissions.AllowAny]
    throttle_scope = "marketplace_browse"
    throttle_classes = [ScopedRateThrottle]

    @extend_schema(responses={200: dict, 404: dict})
    def get(self, request, user_id):
        from identity.models import User
        user = User.objects.filter(pk=user_id, is_active=True).first()
        if user is None:
            raise Http404
        return Response(shops.storefront(user, request.user))


class MyShopView(APIView):
    """The owner's shop settings: banner, logo, policies, announcement and vacation mode."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: ShopProfileSerializer})
    def get(self, request):
        return Response(ShopProfileSerializer(shops.profile_of(request.user)).data)

    @extend_schema(request=ShopProfileSerializer, responses={200: ShopProfileSerializer, 400: dict})
    def put(self, request):
        profile = ShopProfile.objects.filter(user=request.user).first()
        serializer = ShopProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(user=request.user)
        return Response(serializer.data)
