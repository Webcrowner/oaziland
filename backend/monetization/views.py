"""
monetization.views — the real Creator Premium subscription endpoint,
wallet, gifting, and ad campaign boosting.
"""
import logging
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from decimal import Decimal
from oaziland.permissions import IsAdminRole, IsSuperAdmin
from identity.services import get_user_kyc_status
from trust_safety.audit import audit_note
from .models import WithdrawalRequest
from .services import (
    subscribe_to_creator_premium,
    cancel_creator_premium,
    is_premium_creator,
    get_or_create_wallet,
    request_withdrawal,
    KycRequiredForWithdrawal,
    process_withdrawal_payout,
    reject_withdrawal,
    notify_admins_of_withdrawal,
    notify_user_of_withdrawal_outcome,
    _withdrawal_fee,
    recharge_wallet,
    send_gift,
    convert_gifts_to_wallet_balance,
    get_boost_price,
    purchase_campaign_boost,
)
from .serializers import (
    AdminWithdrawalSerializer,
    FeePolicyInputSerializer,
    BoostPriceInputSerializer,
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


logger = logging.getLogger(__name__)


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
            "kyc_status": get_user_kyc_status(request.user),
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
            withdrawal_req = request_withdrawal(
                user=request.user, amount_xaf=amount_xaf, phone_number=phone_number,
                provider=serializer.validated_data["provider"],
            )
        except KycRequiredForWithdrawal as e:
            return Response({"detail": str(e), "code": "KYC_REQUIRED", "kyc_status": e.kyc_status}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        notify_admins_of_withdrawal(withdrawal_req)
        wallet = get_or_create_wallet(request.user)
        fee = _withdrawal_fee(amount_xaf)
        resp_data = {
            "detail": (
                f"Withdrawal request of {amount_xaf} XAF received. After review it will be sent to {phone_number}"
                + (f", minus a {fee} XAF fee." if fee else ".")
            ),
            "withdrawal_id": withdrawal_req.id,
            "amount_xaf": withdrawal_req.amount_xaf,
            "status": withdrawal_req.status,
            "balance_xaf": wallet.balance_xaf,
        }
        return Response(resp_data, status=status.HTTP_202_ACCEPTED)


class AdminWithdrawalViewSet(viewsets.ReadOnlyModelViewSet):
    """Admin review queue for cash-outs: approve (sends the payout) or reject (refunds the wallet)."""
    serializer_class = AdminWithdrawalSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WithdrawalRequest.objects.none()
        qs = WithdrawalRequest.objects.select_related(
            "wallet__owner__kyc_profile", "reviewed_by",
        ).order_by("-requested_at")
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        withdrawal = self.get_object()
        audit_note(request, target_type="withdrawal", target_label=f"{withdrawal.wallet.owner.username} · {withdrawal.amount_xaf} XAF")
        try:
            withdrawal = process_withdrawal_payout(withdrawal_request=withdrawal, reviewer=request.user)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Withdrawal payout failed for %s", withdrawal.pk)
            return Response(
                {"detail": "The payment gateway could not send this payout. It is still pending; try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        notify_user_of_withdrawal_outcome(withdrawal)
        return Response(AdminWithdrawalSerializer(withdrawal).data)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        withdrawal = self.get_object()
        audit_note(request, target_type="withdrawal", target_label=f"{withdrawal.wallet.owner.username} · {withdrawal.amount_xaf} XAF")
        try:
            withdrawal = reject_withdrawal(
                withdrawal_request=withdrawal, reviewer=request.user, reason=request.data.get("reason", ""),
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        notify_user_of_withdrawal_outcome(withdrawal)
        return Response(AdminWithdrawalSerializer(withdrawal).data)


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
        data = {
            "balance_xaf": wallet.balance_xaf,
            "kyc_status": get_user_kyc_status(request.user),
            "transactions": wallet.transactions.order_by("-created_at")[:30],
            "withdrawals": wallet.withdrawal_requests.order_by("-requested_at")[:15],
        }
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
        except ValueError:
            return Response({"detail": "No pricing tier configured for this placement/duration combination yet."}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"total_price_xaf": price})


MAX_FEE_PERCENT = Decimal("50")
MAX_BOOST_PRICE_XAF = Decimal("10000000")


class AdminPricingView(APIView):
    """What the platform charges: the fee on each kind of payment, and the boost price list.
    Full-access administrators only. A boost option with no price is simply not offered."""
    permission_classes = [IsSuperAdmin]

    @staticmethod
    def snapshot():
        from .models import AdPlacement, BoostDurationUnit, BoostPricingTier, PlatformFeePolicy, TransactionCategory

        fees = {p.category: p.fee_percent for p in PlatformFeePolicy.objects.all()}
        prices = {(t.placement, t.duration_unit): t.price_xaf for t in BoostPricingTier.objects.all()}
        return {
            "fees": [
                {"category": c.value, "label": c.label, "fee_percent": str(fees[c.value]) if c.value in fees else None}
                for c in TransactionCategory
            ],
            "boosts": [
                {
                    "placement": p.value, "placement_label": p.label,
                    "duration_unit": u.value, "unit_label": u.label,
                    "price_xaf": str(prices[(p.value, u.value)]) if (p.value, u.value) in prices else None,
                }
                for p in AdPlacement for u in BoostDurationUnit
            ],
            "max_fee_percent": str(MAX_FEE_PERCENT),
            "max_boost_price_xaf": str(MAX_BOOST_PRICE_XAF),
        }

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(self.snapshot())


class AdminFeePolicyView(APIView):
    """PUT {"fee_percent": "5.00"} to set the fee for one payment category. Applies to payments
    confirmed from now on; escrows that already exist keep the fee they were created with."""
    permission_classes = [IsSuperAdmin]

    @extend_schema(request=dict, responses={200: dict, 400: dict, 404: dict})
    def put(self, request, category):
        from .models import PlatformFeePolicy, TransactionCategory

        if category not in TransactionCategory.values:
            return Response({"detail": "Unknown fee category."}, status=status.HTTP_404_NOT_FOUND)
        serializer = FeePolicyInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        percent = serializer.validated_data["fee_percent"]
        if percent > MAX_FEE_PERCENT:
            return Response({"detail": f"A fee cannot be higher than {MAX_FEE_PERCENT}%."}, status=status.HTTP_400_BAD_REQUEST)

        policy = PlatformFeePolicy.objects.filter(category=category).first()
        old = str(policy.fee_percent) if policy else "not set"
        PlatformFeePolicy.objects.update_or_create(category=category, defaults={"fee_percent": percent})
        audit_note(request, target_type="fee_policy", target_label=TransactionCategory(category).label, old_value=old, new_value=str(percent))
        return Response(AdminPricingView.snapshot())


class AdminBoostPriceView(APIView):
    """PUT {"placement", "duration_unit", "price_xaf"} to set the price of one boost option;
    send "price_xaf": null to stop offering it."""
    permission_classes = [IsSuperAdmin]

    @extend_schema(request=dict, responses={200: dict, 400: dict})
    def put(self, request):
        from .models import AdPlacement, BoostDurationUnit, BoostPricingTier

        serializer = BoostPriceInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        price = data.get("price_xaf")
        if price is not None and price > MAX_BOOST_PRICE_XAF:
            return Response({"detail": f"A boost price cannot be higher than {MAX_BOOST_PRICE_XAF:,.0f} XAF."}, status=status.HTTP_400_BAD_REQUEST)

        tier = BoostPricingTier.objects.filter(placement=data["placement"], duration_unit=data["duration_unit"]).first()
        old = str(tier.price_xaf) if tier else "not offered"
        label = f"{AdPlacement(data['placement']).label} / {BoostDurationUnit(data['duration_unit']).label}"
        if price is None:
            BoostPricingTier.objects.filter(placement=data["placement"], duration_unit=data["duration_unit"]).delete()
        else:
            BoostPricingTier.objects.update_or_create(
                placement=data["placement"], duration_unit=data["duration_unit"], defaults={"price_xaf": price},
            )
        audit_note(request, target_type="boost_price", target_label=label, old_value=old, new_value="not offered" if price is None else str(price))
        return Response(AdminPricingView.snapshot())


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
