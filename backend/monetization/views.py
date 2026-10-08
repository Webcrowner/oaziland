"""
monetization.views — the real Creator Premium subscription endpoint,
wallet, gifting, and ad campaign boosting.
"""
from rest_framework import permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from decimal import Decimal
from .services import (
    subscribe_to_creator_premium,
    cancel_creator_premium,
    is_premium_creator,
    get_or_create_wallet,
    request_withdrawal,
    process_withdrawal_payout,
    recharge_wallet,
    send_gift,
    convert_gifts_to_wallet_balance,
    get_boost_price,
    purchase_campaign_boost,
)
from .serializers import (
    WalletDetailSerializer,
    WithdrawInputSerializer,
    WithdrawResponseSerializer,
    RechargeWalletInputSerializer,
    SendGiftSerializer,
    GiftSerializer,
    BoostPriceQuoteSerializer,
    PurchaseCampaignBoostSerializer,
    AdCampaignSerializer,
)


class MyWalletView(APIView):
    """View wallet balance, recent earnings, transactions, and cash-out requests."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: WalletDetailSerializer})
    def get(self, request):
        wallet = get_or_create_wallet(request.user)
        transactions = wallet.transactions.order_by("-created_at")[:30]
        withdrawals = wallet.withdrawal_requests.order_by("-requested_at")[:15]
        data = {
            "balance_xaf": wallet.balance_xaf,
            "transactions": transactions,
            "withdrawals": withdrawals,
        }
        return Response(WalletDetailSerializer(data).data)


class WithdrawWalletView(APIView):
    """Disburse wallet earnings directly to MTN Mobile Money or Orange Money."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        request=WithdrawInputSerializer,
        responses={200: WithdrawResponseSerializer, 400: dict},
    )
    def post(self, request):
        serializer = WithdrawInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        amount_xaf = serializer.validated_data["amount_xaf"]
        phone_number = (
            serializer.validated_data.get("phone_number")
            or getattr(request.user, "phone", None)
            or ""
        )
        if not phone_number:
            return Response(
                {"detail": "A valid Cameroon phone number (+237 6XXXXXXXX) is required for payout."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            withdrawal_req = request_withdrawal(user=request.user, amount_xaf=amount_xaf)
            process_withdrawal_payout(withdrawal_request=withdrawal_req, phone_number=phone_number)
            wallet = get_or_create_wallet(request.user)
            resp_data = {
                "detail": f"Successfully disbursed {amount_xaf} XAF to {phone_number}.",
                "withdrawal_id": withdrawal_req.id,
                "amount_xaf": withdrawal_req.amount_xaf,
                "status": withdrawal_req.status,
                "balance_xaf": wallet.balance_xaf,
            }
            return Response(resp_data, status=status.HTTP_200_OK)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class MyCreatorPremiumView(APIView):
    """A small, low-cost subscription — reuses the SAME PaymentGateway
    interface as every other payment on the platform, no separate
    checkout pathway."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response({"is_premium": is_premium_creator(request.user)})

    @extend_schema(request=dict, responses={200: dict, 400: dict})
    def post(self, request):
        from payments.gateways import get_active_gateway
        phone_number = request.data.get("phone_number")
        if not phone_number:
            return Response({"detail": "phone_number is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            subscribe_to_creator_premium(user=request.user, payment_gateway=get_active_gateway(), phone_number=phone_number)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"is_premium": True})

    @extend_schema(responses={200: dict})
    def delete(self, request):
        cancel_creator_premium(request.user)
        return Response({"detail": "Subscription cancelled — perks remain active until the current period ends."})


class RechargeWalletView(APIView):
    """The real gap this closes: recharge_wallet() was fully built and
    tested, but nothing let a real user top up their own wallet —
    only withdrawal was ever reachable."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=RechargeWalletInputSerializer, responses={200: WalletDetailSerializer, 400: dict})
    def post(self, request):
        from payments.gateways import get_active_gateway
        input_serializer = RechargeWalletInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            wallet = recharge_wallet(
                user=request.user, amount_xaf=input_serializer.validated_data["amount_xaf"],
                payment_gateway=get_active_gateway(), phone_number=input_serializer.validated_data["phone_number"],
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        data = {"balance_xaf": wallet.balance_xaf, "transactions": wallet.transactions.order_by("-created_at")[:30], "withdrawals": wallet.withdrawal_requests.order_by("-requested_at")[:15]}
        return Response(WalletDetailSerializer(data).data)


class SendGiftView(APIView):
    """The real gap this closes: send_gift()/convert_gifts_to_wallet_
    balance() (the TikTok-style gift economy) were fully built and
    tested, but the entire feature had zero reachable endpoint."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=SendGiftSerializer, responses={201: GiftSerializer, 400: dict, 404: dict})
    def post(self, request):
        from identity.models import User
        from social.models import Post

        input_serializer = SendGiftSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        recipient = User.objects.filter(id=data["recipient"]).first()
        if recipient is None:
            return Response({"detail": "Recipient not found."}, status=status.HTTP_404_NOT_FOUND)
        if recipient.id == request.user.id:
            return Response({"detail": "You cannot send a gift to yourself."}, status=status.HTTP_400_BAD_REQUEST)

        post = None
        if data.get("post"):
            post = Post.objects.filter(id=data["post"]).first()
            if post is None:
                return Response({"detail": "Post not found."}, status=status.HTTP_404_NOT_FOUND)

        gift = send_gift(sender=request.user, recipient=recipient, gift_type=data["gift_type"], post=post)
        return Response(GiftSerializer(gift).data, status=status.HTTP_201_CREATED)


class MyGiftsView(APIView):
    """Gifts a user has received, plus a running total of un-converted
    points — the real information needed to decide when to cash out."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        gifts = request.user.gifts_received.order_by("-sent_at")[:50]
        unconverted_points = sum(g.point_value for g in request.user.gifts_received.filter(converted_to_wallet=False))
        return Response({"unconverted_points": unconverted_points, "results": GiftSerializer(gifts, many=True).data})


class ConvertGiftsView(APIView):
    """Cashes out every un-converted gift a user has received into real
    wallet balance, applying the platform's GIFT_CONVERSION fee."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: dict})
    def post(self, request):
        net_xaf = convert_gifts_to_wallet_balance(user=request.user)
        wallet = get_or_create_wallet(request.user)
        return Response({"converted_xaf": net_xaf, "balance_xaf": wallet.balance_xaf})


class BoostPriceQuoteView(APIView):
    """Lets an advertiser see the price BEFORE paying — get_boost_price()
    existed, tested, but nothing exposed a real quote."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=BoostPriceQuoteSerializer, responses={200: dict, 400: dict})
    def post(self, request):
        input_serializer = BoostPriceQuoteSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        try:
            price = get_boost_price(placement=data["placement"], duration_unit=data["duration_unit"], duration_quantity=data["duration_quantity"])
        except Exception:
            return Response({"detail": "No pricing tier configured for this placement/duration combination yet."}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"total_price_xaf": price})


class PurchaseCampaignBoostView(APIView):
    """The real gap this closes: purchase_campaign_boost() (Facebook-
    style ad boosting, charged through the same payment gateway as
    every other payment) was fully built and tested, but nothing ever
    let a real advertiser reach it."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=PurchaseCampaignBoostSerializer, responses={201: AdCampaignSerializer, 400: dict})
    def post(self, request):
        from payments.gateways import get_active_gateway
        from geo.models import Quarter
        from social.models import Post

        input_serializer = PurchaseCampaignBoostSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        target_quarter = None
        if data.get("target_quarter"):
            target_quarter = Quarter.objects.filter(id=data["target_quarter"]).first()
        target_post = None
        if data.get("target_post"):
            target_post = Post.objects.filter(id=data["target_post"]).first()

        try:
            campaign, platform_fee = purchase_campaign_boost(
                owner=request.user, placement=data["placement"], duration_unit=data["duration_unit"],
                duration_quantity=data["duration_quantity"], payment_gateway=get_active_gateway(),
                phone_number=data["phone_number"], target_quarter=target_quarter,
                target_property_type=data.get("target_property_type", ""),
                target_post=target_post, target_listing_id=data.get("target_listing_id"),
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(AdCampaignSerializer(campaign).data, status=status.HTTP_201_CREATED)


class MyAdCampaignsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .models import AdCampaign
        campaigns = AdCampaign.objects.filter(owner=request.user).order_by("-starts_at")
        return Response({"count": campaigns.count(), "results": AdCampaignSerializer(campaigns, many=True).data})
