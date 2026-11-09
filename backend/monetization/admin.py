from oaziland.admin_base import register

from .models import PlatformFeePolicy, SubscriptionTier, Wallet, WalletTransaction, WithdrawalRequest

register(PlatformFeePolicy, list_display=("category", "fee_percent"))
register(Wallet, read_only=True, list_display=("owner", "balance_xaf"), search_fields=("owner__username", "owner__phone"))
register(WalletTransaction, read_only=True, list_display=("wallet__owner__username", "transaction_type", "amount_xaf", "platform_fee_xaf", "related_reference", "created_at"),
         list_filter=("transaction_type",), search_fields=("wallet__owner__username", "related_reference"))
register(WithdrawalRequest, read_only=True, list_display=("wallet__owner__username", "amount_xaf", "fee_xaf", "provider", "status", "requested_at", "resolved_at"),
         list_filter=("status", "provider"), search_fields=("wallet__owner__username", "payout_reference"),
         masked_fields=("phone_number",), ordering=("-requested_at",))
register(SubscriptionTier, read_only=True, list_display=("subscriber", "tier", "monthly_price_xaf", "max_active_listings", "renews_at"),
         list_filter=("tier",), search_fields=("subscriber__username",))
