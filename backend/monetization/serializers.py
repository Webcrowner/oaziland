"""
monetization.serializers — serializers for Wallet, Transactions, Mobile
Money Withdrawals, the gift economy, and ad campaign boosting.
"""
from rest_framework import serializers
from .models import Wallet, WalletTransaction, WithdrawalRequest, Gift, GiftType, AdCampaign, AdPlacement, BoostDurationUnit


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
            "status",
            "requested_at",
            "resolved_at",
        ]


class WalletDetailSerializer(serializers.Serializer):
    balance_xaf = serializers.DecimalField(max_digits=12, decimal_places=2)
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
