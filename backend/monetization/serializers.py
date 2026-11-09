"""
monetization.serializers — serializers for Wallet, Transactions, Mobile
Money Withdrawals, the gift economy, and ad campaign boosting.
"""
from rest_framework import serializers
from django.db.models import Sum
from .models import Wallet, WalletTransaction, WithdrawalRequest, WithdrawalStatus, Gift, GiftType, AdCampaign, AdPlacement, BoostDurationUnit


class WalletTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = WalletTransaction
        fields = [
            "id",
            "transaction_type",
            "amount_xaf",
            "platform_fee_xaf",
            "related_reference",
            "created_at",
        ]


class WithdrawalRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = WithdrawalRequest
        fields = [
            "id",
            "amount_xaf",
            "fee_xaf",
            "status",
            "requested_at",
            "resolved_at",
            "phone_number",
            "provider",
            "rejection_reason",
        ]


class AdminWithdrawalSerializer(serializers.ModelSerializer):
    """What an admin needs to decide on a cash-out: who is asking, where
    the money goes, what it costs, and whether the account looks trustworthy."""
    user = serializers.SerializerMethodField()
    wallet_balance_xaf = serializers.DecimalField(source="wallet.balance_xaf", max_digits=12, decimal_places=2, read_only=True)
    fee_xaf = serializers.SerializerMethodField()
    net_amount_xaf = serializers.SerializerMethodField()
    kyc_status = serializers.SerializerMethodField()
    paid_out_total_xaf = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WithdrawalRequest
        fields = [
            "id", "user", "amount_xaf", "fee_xaf", "net_amount_xaf", "status", "requested_at", "resolved_at",
            "phone_number", "provider", "wallet_balance_xaf", "kyc_status", "paid_out_total_xaf",
            "reviewed_by_name", "rejection_reason", "payout_reference",
        ]
        read_only_fields = fields

    def get_user(self, obj):
        owner = obj.wallet.owner
        return {
            "id": str(owner.id),
            "username": owner.username,
            "name": owner.full_name or owner.username,
            "phone": owner.phone or "",
            "account_status": owner.account_status,
        }

    def _fee(self, obj):
        from .services import _withdrawal_fee
        if obj.status == WithdrawalStatus.PENDING:
            return _withdrawal_fee(obj.amount_xaf)
        return obj.fee_xaf

    def get_fee_xaf(self, obj):
        return str(self._fee(obj))

    def get_net_amount_xaf(self, obj):
        return str(obj.amount_xaf - self._fee(obj))

    def get_kyc_status(self, obj):
        kyc = getattr(obj.wallet.owner, "kyc_profile", None)
        return kyc.kyc_status if kyc else "NONE"

    def get_paid_out_total_xaf(self, obj):
        total = WithdrawalRequest.objects.filter(
            wallet_id=obj.wallet_id, status=WithdrawalStatus.PAID_OUT,
        ).exclude(pk=obj.pk).aggregate(t=Sum("amount_xaf"))["t"]
        return str(total or 0)

    def get_reviewed_by_name(self, obj):
        reviewer = obj.reviewed_by
        return (reviewer.full_name or reviewer.username) if reviewer else ""


class WalletDetailSerializer(serializers.Serializer):
    balance_xaf = serializers.DecimalField(max_digits=12, decimal_places=2)
    kyc_status = serializers.CharField()
    transactions = WalletTransactionSerializer(many=True)
    withdrawals = WithdrawalRequestSerializer(many=True)


class WithdrawInputSerializer(serializers.Serializer):
    amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=100)
    phone_number = serializers.CharField(max_length=50, required=False, allow_blank=True)
    provider = serializers.ChoiceField(choices=["MTN_MOMO", "ORANGE_MONEY"], default="MTN_MOMO")


class WithdrawResponseSerializer(serializers.Serializer):
    detail = serializers.CharField()
    withdrawal_id = serializers.UUIDField()
    amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2)
    status = serializers.CharField()
    balance_xaf = serializers.DecimalField(max_digits=12, decimal_places=2)


class RechargeWalletInputSerializer(serializers.Serializer):
    amount_xaf = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=100)
    phone_number = serializers.CharField(max_length=50)


class SendGiftSerializer(serializers.Serializer):
    recipient = serializers.UUIDField()
    gift_type = serializers.ChoiceField(choices=GiftType.choices)
    post = serializers.UUIDField(required=False, allow_null=True)


class GiftSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.full_name", read_only=True)
    recipient_name = serializers.CharField(source="recipient.full_name", read_only=True)

    class Meta:
        model = Gift
        fields = ["id", "sender", "sender_name", "recipient", "recipient_name", "gift_type", "point_value", "post", "converted_to_wallet", "sent_at"]


class FeePolicyInputSerializer(serializers.Serializer):
    fee_percent = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0)


class BoostPriceInputSerializer(serializers.Serializer):
    placement = serializers.ChoiceField(choices=AdPlacement.choices)
    duration_unit = serializers.ChoiceField(choices=BoostDurationUnit.choices)
    # null removes the option from sale; a blank string must never do that by accident
    price_xaf = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=1, allow_null=True)

    def validate(self, attrs):
        if self.initial_data.get("price_xaf") == "":
            raise serializers.ValidationError({"price_xaf": "Enter a price, or send null to stop offering this option."})
        return attrs


class BoostPriceQuoteSerializer(serializers.Serializer):
    placement = serializers.ChoiceField(choices=AdPlacement.choices)
    duration_unit = serializers.ChoiceField(choices=BoostDurationUnit.choices)
    duration_quantity = serializers.IntegerField(min_value=1)


class PurchaseCampaignBoostSerializer(serializers.Serializer):
    placement = serializers.ChoiceField(choices=AdPlacement.choices)
    duration_unit = serializers.ChoiceField(choices=BoostDurationUnit.choices)
    duration_quantity = serializers.IntegerField(min_value=1)
    phone_number = serializers.CharField(max_length=50)
    target_quarter = serializers.IntegerField(required=False, allow_null=True)
    target_property_type = serializers.CharField(required=False, allow_blank=True, default="")
    target_post = serializers.UUIDField(required=False, allow_null=True)
    target_listing_id = serializers.UUIDField(required=False, allow_null=True)


class AdCampaignSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdCampaign
        fields = [
            "id", "owner", "placement", "duration_unit", "duration_quantity", "budget_xaf",
            "spent_so_far_xaf", "target_quarter", "target_property_type", "starts_at", "ends_at", "status",
        ]
        read_only_fields = fields
